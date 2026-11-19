//! Speech to one explicit WASAPI render endpoint, in shared mode.
//!
//! Port of `WindowsOutput` in `devices_windows.py`. PortAudio opened the device at the
//! speech rate and, when WASAPI refused it, converted to the mix rate with soxr; mono
//! was widened to stereo because PortAudio's mono path garbled WASAPI playback. Here
//! the stream asks WASAPI itself to convert rate and channels
//! (`AUTOCONVERTPCM | SRC_DEFAULT_QUALITY`), which covers both. The OS default is
//! never used for speech.

use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioClient, IAudioRenderClient, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::CLSCTX_ALL;

use super::{enumerator, friendly_name, named, Com, MtaUsage};
use crate::error::{Error, Result};
use crate::graph::OutputOption;
use crate::naming::{device_host, device_name, output_identity, same_output, WASAPI_HOST};
use crate::router::{Output, PlaybackToken};
use crate::sync::{audio_op_lock, monotonic};
use std::time::Duration;

/// The shared-mode buffer, in 100 ns units (100 ms). Some engines, such as the Steam
/// Streaming devices', take 30 ms at a time and two blocks right after the start; with
/// 60 ms the buffer kept only 20 ms in hand, about one Windows timer tick of the writer.
const BUFFER_DURATION: i64 = 1_000_000;
const DRAIN_DEADLINE: f64 = 2.0;

/// WASAPI outputs, plus saved choices from other hosts while their device exists.
///
/// The Python list showed other PortAudio hosts' entries for saved choices. Those
/// hosts are not opened any more; a saved entry stays listed while a WASAPI device
/// of the same name (MME cuts names at 31 characters) exists, and opens that device.
pub fn enumerate_outputs(keep: &[String]) -> Result<Vec<OutputOption>> {
    let _com = Com::init()?;
    let _lock = audio_op_lock().lock();
    let enumerator = enumerator()?;
    let names: Vec<String> = named(&enumerator, eRender)?.into_iter().map(|(_, name, _)| name).collect();
    let mut result: Vec<OutputOption> = names.iter().map(|name| OutputOption { id: output_identity(WASAPI_HOST, name), label: name.clone() }).collect();
    for saved in keep {
        let Some(host) = device_host(saved).filter(|host| host != WASAPI_HOST) else { continue };
        if names.iter().filter(|name| same_output(saved, name)).count() == 1 {
            result.push(OutputOption { id: saved.clone(), label: format!("{} ({host})", device_name(saved)) });
        }
    }
    Ok(result)
}

/// Identity of the OS default output. For the monitor only: speech never uses a default.
pub fn default_output() -> Result<String> {
    let missing = || Error::speech("output_missing");
    let _com = Com::init().map_err(|_| missing())?;
    let _lock = audio_op_lock().lock();
    let enumerator = enumerator().map_err(|_| missing())?;
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }.map_err(|_| missing())?;
    Ok(output_identity(WASAPI_HOST, &friendly_name(&device).map_err(|_| missing())?))
}

pub struct WindowsOutput {
    client: IAudioClient,
    render: IAudioRenderClient,
    buffer_frames: u32,
    block: usize,
    strict_underflow: bool,
    started: bool,
    /// The output is opened on one thread and often written and dropped on another (the
    /// virtual microphone's check, the queued route): it keeps the apartment alive by itself
    /// instead of holding the opening thread's COM, which would be released on the wrong thread.
    /// Last, so the interfaces above are released while the apartment is still alive.
    _mta: MtaUsage,
}

// The interfaces live in the multithreaded apartment, where any thread of it may
// use them; the output is used by one thread at a time.
unsafe impl Send for WindowsOutput {}

fn lost(_: windows::core::Error) -> Error {
    Error::speech("output_disconnected")
}

impl WindowsOutput {
    /// `strict_underflow`: report a buffer that ran dry (the virtual microphone check's tone
    /// does); speech and a monitor tolerate it, and the engine plays silence until the next
    /// write (decision 62).
    pub fn open(identity: &str, rate: u32, channels: u16, strict_underflow: bool) -> Result<Self> {
        let _com = Com::init()?;
        let mta = MtaUsage::new()?;
        let _lock = audio_op_lock().lock();
        let enumerator = enumerator()?;
        let wasapi = device_host(identity).is_none_or(|host| host == WASAPI_HOST);
        let mut matches: Vec<_> =
            named(&enumerator, eRender)?.into_iter().filter(|(_, name, _)| if wasapi { output_identity(WASAPI_HOST, name) == identity } else { same_output(identity, name) }).collect();
        if matches.len() != 1 {
            return Err(Error::speech("output_missing_or_ambiguous"));
        }
        let (_, _, device) = matches.remove(0);
        let block = 2 * channels as usize;
        let format = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: channels,
            nSamplesPerSec: rate,
            nAvgBytesPerSec: rate * block as u32,
            nBlockAlign: block as u16,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        unsafe {
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|_| Error::speech("output_missing"))?;
            client
                .Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, BUFFER_DURATION, 0, &format, None)
                .map_err(|_| Error::speech("output_format_unsupported"))?;
            let buffer_frames = client.GetBufferSize().map_err(lost)?;
            let render: IAudioRenderClient = client.GetService().map_err(lost)?;
            Ok(Self { client, render, buffer_frames, block, strict_underflow, started: false, _mta: mta })
        }
    }

    fn padding(&self) -> Result<u32> {
        unsafe { self.client.GetCurrentPadding() }.map_err(lost)
    }

    fn start(&mut self) -> Result<()> {
        unsafe { self.client.Start() }.map_err(lost)?;
        self.started = true;
        Ok(())
    }
}

impl Output for WindowsOutput {
    /// The stream starts once its buffer is full (or at `close` for shorter audio). Starting
    /// after the first 10 ms write let the engine drain that write before the next one came,
    /// so a strict output failed at once with `output_underflow` and nothing was heard: every
    /// message to the virtual microphone on Windows in 0.5.0-beta.5.
    fn write(&mut self, pcm: &[u8], token: &dyn PlaybackToken) -> Result<()> {
        token.check()?;
        let mut pending = &pcm[..pcm.len() / self.block * self.block];
        while !pending.is_empty() {
            token.check()?;
            let padding = self.padding()?;
            if self.started && padding == 0 && self.strict_underflow {
                return Err(Error::speech("output_underflow"));
            }
            let room = (self.buffer_frames - padding) as usize;
            if room == 0 {
                if !self.started {
                    self.start()?;
                    continue;
                }
                // Blocks for about the audio's length, as a PortAudio write does.
                token.wait(Duration::from_millis(5));
                continue;
            }
            let frames = room.min(pending.len() / self.block);
            unsafe {
                let target = self.render.GetBuffer(frames as u32).map_err(lost)?;
                std::ptr::copy_nonoverlapping(pending.as_ptr(), target, frames * self.block);
                self.render.ReleaseBuffer(frames as u32, 0).map_err(lost)?;
            }
            pending = &pending[frames * self.block..];
        }
        Ok(())
    }

    fn close(&mut self, drain: bool, token: &dyn PlaybackToken) -> Result<()> {
        // Audio shorter than the buffer has not started yet.
        if drain && !self.started && !token.is_set() && self.padding()? > 0 {
            self.start()?;
        }
        // The last hardware buffer belongs to the driver; an unplug can still cut it.
        if drain && self.started && !token.is_set() {
            let deadline = monotonic() + DRAIN_DEADLINE;
            while self.padding()? > 0 && !token.is_set() && monotonic() < deadline {
                token.wait(Duration::from_millis(5));
            }
        }
        let _lock = audio_op_lock().lock();
        let _ = unsafe { self.client.Stop() };
        Ok(())
    }
}
