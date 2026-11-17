//! A WASAPI microphone as 48 kHz mono 16-bit PCM, for the direct voice bridge.
//!
//! The Python bridge used the transcription capture (`capture_windows.py`). This is a
//! smaller capture of its own: shared mode, converted by WASAPI to the bridge format,
//! read every 10 ms on its own thread.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use windows::Win32::Media::Audio::{
    eCapture, IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX,
    WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::CLSCTX_ALL;

use super::{enumerator, find_by_identity, Com};
use crate::error::{Error, Result};
use crate::sync::{audio_op_lock, Worker};
use crate::windows_route::{Capture, CaptureCallbacks};

pub const RATE: u32 = 48000;
const BUFFER_DURATION: i64 = 1_000_000; // 100 ms

pub struct WasapiCapture {
    stop: Arc<AtomicBool>,
    worker: Option<Worker>,
    identity: String,
    callbacks: Option<CaptureCallbacks>,
}

impl WasapiCapture {
    /// Capture the microphone whose identity is `identity` once started.
    pub fn new(identity: &str, callbacks: CaptureCallbacks) -> Self {
        Self { stop: Arc::new(AtomicBool::new(false)), worker: None, identity: identity.to_owned(), callbacks: Some(callbacks) }
    }
}

struct Stream {
    client: IAudioClient,
    reader: IAudioCaptureClient,
}

fn open(identity: &str) -> Result<Stream> {
    // As in `open_device`: the shared lock covers finding the device only, since opening the
    // stream can wait for the user to answer Windows' microphone permission.
    let device = {
        let _lock = audio_op_lock().lock();
        let enumerator = enumerator()?;
        find_by_identity(&enumerator, eCapture, identity).map_err(|_| Error::runtime("source_bridge_capture_failed"))?
    };
    let format = WAVEFORMATEX { wFormatTag: WAVE_FORMAT_PCM as u16, nChannels: 1, nSamplesPerSec: RATE, nAvgBytesPerSec: RATE * 2, nBlockAlign: 2, wBitsPerSample: 16, cbSize: 0 };
    let failed = |_| Error::runtime("source_bridge_capture_failed");
    unsafe {
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(failed)?;
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, BUFFER_DURATION, 0, &format, None).map_err(failed)?;
        let reader: IAudioCaptureClient = client.GetService().map_err(failed)?;
        client.Start().map_err(failed)?;
        Ok(Stream { client, reader })
    }
}

fn read(stream: &Stream, on_audio: &mut dyn FnMut(&[u8]) -> bool) -> Result<bool> {
    let failed = |_| Error::runtime("source_bridge_capture_failed");
    unsafe {
        loop {
            let packet = stream.reader.GetNextPacketSize().map_err(failed)?;
            if packet == 0 {
                return Ok(true);
            }
            let mut data = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            stream.reader.GetBuffer(&mut data, &mut frames, &mut flags, None, None).map_err(failed)?;
            let bytes = frames as usize * 2;
            let pcm = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() { vec![0; bytes] } else { std::slice::from_raw_parts(data, bytes).to_vec() };
            stream.reader.ReleaseBuffer(frames).map_err(failed)?;
            if !on_audio(&pcm) {
                return Ok(false);
            }
        }
    }
}

/// Where a recognition capture reads from (`capture_windows.py`, the recorder of
/// `transcription_recorder.py`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceTarget {
    /// A WASAPI endpoint by its native ID (`Device::endpoint_id`).
    EndpointId(String),
    /// A WASAPI endpoint by the identity the realtime settings keep (`endpoint_for`).
    Identity(String),
}

/// The PCM a [`DeviceCapture`] delivers: 16-bit, interleaved, at the device's shared-mode
/// rate and channel count (what PortAudio opened in Python).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceFormat {
    pub rate: u32,
    pub channels: u16,
}

/// A microphone, or a speaker through its loopback, read every 10 ms on its own thread.
/// A loopback delivers nothing while nothing plays; that gap is filled with silence, so a
/// recognition can still hear an utterance end (as `capture_windows.py` did).
pub struct DeviceCapture {
    stop: Arc<AtomicBool>,
    worker: Option<Worker>,
}

/// After this long without a packet a loopback delivers silence.
const SILENCE_AFTER: Duration = Duration::from_millis(60);

/// The longest silence delivered at once. The gap is measured on a clock that keeps running
/// while the computer sleeps, so after a resume it can be hours long; a second is enough for
/// a recognition to hear an utterance end, and the next checks keep adding silence in step.
const MAX_SILENCE: Duration = Duration::from_secs(1);

/// Bytes of 16-bit silence for a `gap` without packets, at most [`MAX_SILENCE`].
fn silence_bytes(gap: Duration, format: DeviceFormat) -> usize {
    let frames = (gap.min(MAX_SILENCE).as_secs_f64() * f64::from(format.rate)) as usize;
    frames * usize::from(format.channels) * 2
}

struct DeviceStream {
    client: IAudioClient,
    reader: IAudioCaptureClient,
    format: DeviceFormat,
}

fn open_device(target: &DeviceTarget, loopback: bool) -> Result<DeviceStream> {
    use windows::core::HSTRING;
    // The shared lock covers finding the device only. Opening the stream can wait for the user
    // to answer Windows' microphone permission; under the lock, the device lists, speech output
    // and every other audio operation would wait as long. WASAPI's own objects are thread safe.
    let device = {
        let _lock = audio_op_lock().lock();
        let enumerator = enumerator()?;
        let missing = |_| Error::runtime("asr_capture_endpoint_missing");
        match target {
            DeviceTarget::EndpointId(id) => unsafe { enumerator.GetDevice(&HSTRING::from(id.as_str())) }.map_err(missing)?,
            DeviceTarget::Identity(identity) => {
                let flow = if loopback { windows::Win32::Media::Audio::eRender } else { eCapture };
                find_by_identity(&enumerator, flow, identity).map_err(|_| Error::runtime("asr_capture_endpoint_missing"))?
            }
        }
    };
    let failed = |_| Error::runtime("asr_capture_stream_create_failed");
    unsafe {
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(failed)?;
        let mix = client.GetMixFormat().map_err(failed)?;
        let (rate, channels) = ((*mix).nSamplesPerSec, (*mix).nChannels.max(1));
        windows::Win32::System::Com::CoTaskMemFree(Some(mix as *const _));
        let format = WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_PCM as u16,
            nChannels: channels,
            nSamplesPerSec: rate,
            nAvgBytesPerSec: rate * 2 * u32::from(channels),
            nBlockAlign: 2 * channels,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        let mut flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        if loopback {
            flags |= windows::Win32::Media::Audio::AUDCLNT_STREAMFLAGS_LOOPBACK;
        }
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, BUFFER_DURATION, 0, &format, None).map_err(failed)?;
        let reader: IAudioCaptureClient = client.GetService().map_err(failed)?;
        client.Start().map_err(failed)?;
        Ok(DeviceStream { client, reader, format: DeviceFormat { rate, channels } })
    }
}

fn read_device(stream: &DeviceStream, on_audio: &mut dyn FnMut(&[u8]) -> bool) -> Result<Option<bool>> {
    let failed = |_| Error::runtime("asr_capture_stream_disconnected");
    let block = usize::from(stream.format.channels) * 2;
    let mut delivered = false;
    unsafe {
        loop {
            let packet = stream.reader.GetNextPacketSize().map_err(failed)?;
            if packet == 0 {
                return Ok(Some(delivered));
            }
            let mut data = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            stream.reader.GetBuffer(&mut data, &mut frames, &mut flags, None, None).map_err(failed)?;
            let bytes = frames as usize * block;
            let pcm = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() { vec![0; bytes] } else { std::slice::from_raw_parts(data, bytes).to_vec() };
            stream.reader.ReleaseBuffer(frames).map_err(failed)?;
            delivered = true;
            if !on_audio(&pcm) {
                return Ok(None);
            }
        }
    }
}

impl DeviceCapture {
    /// Opens `target` (a speaker's loopback when `loopback`) and starts delivering. Waits up
    /// to `open_timeout` for the device: Windows can hold the open until the user answers its
    /// microphone question. `on_audio` returns false to stop; `on_error` gets a fixed code.
    pub fn start(
        target: DeviceTarget,
        loopback: bool,
        open_timeout: Duration,
        mut on_audio: Box<dyn FnMut(&[u8], DeviceFormat) -> bool + Send>,
        mut on_error: Box<dyn FnMut(&str) + Send>,
    ) -> Result<(Self, DeviceFormat)> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let (opened, started) = std::sync::mpsc::channel();
        let worker = Worker::spawn("vrct-asr-capture", move || {
            let Ok(_com) = Com::init() else {
                let _ = opened.send(Err(Error::runtime("asr_capture_failed")));
                return;
            };
            let stream = match open_device(&target, loopback) {
                Ok(stream) => {
                    let _ = opened.send(Ok(stream.format));
                    stream
                }
                Err(error) => {
                    let _ = opened.send(Err(error));
                    return;
                }
            };
            let format = stream.format;
            let mut last = std::time::Instant::now();
            while !flag.load(Ordering::SeqCst) {
                let mut deliver = |pcm: &[u8]| on_audio(pcm, format);
                match read_device(&stream, &mut deliver) {
                    Ok(Some(true)) => last = std::time::Instant::now(),
                    Ok(Some(false)) => {
                        let gap = last.elapsed();
                        if loopback && gap >= SILENCE_AFTER {
                            let silence = vec![0u8; silence_bytes(gap, format)];
                            last = std::time::Instant::now();
                            if !on_audio(&silence, format) {
                                break;
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        if !flag.load(Ordering::SeqCst) {
                            on_error(&error.code);
                        }
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            let _lock = audio_op_lock().lock();
            let _ = unsafe { stream.client.Stop() };
        })
        .map_err(|_| Error::runtime("asr_capture_failed"))?;
        let capture = Self { stop: stop.clone(), worker: Some(worker) };
        match started.recv_timeout(open_timeout) {
            Ok(Ok(format)) => Ok((capture, format)),
            Ok(Err(error)) => Err(error),
            Err(_) => {
                stop.store(true, Ordering::SeqCst);
                Err(Error::runtime("asr_capture_start_timeout"))
            }
        }
    }

    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    /// Stops and waits up to a second; false when the thread is still running.
    pub fn stop(&mut self) -> bool {
        self.request_stop();
        self.worker.take().is_none_or(|worker| worker.join(Duration::from_secs(1)))
    }
}

impl Drop for DeviceCapture {
    fn drop(&mut self) {
        self.request_stop();
    }
}

impl Capture for WasapiCapture {
    fn start(&mut self) -> Result<()> {
        let Some(mut callbacks) = self.callbacks.take() else { return Err(Error::runtime("source_bridge_capture_failed")) };
        let (stop, identity) = (self.stop.clone(), self.identity.clone());
        let (opened, started) = std::sync::mpsc::channel();
        let worker = Worker::spawn("vrct-windows-capture", move || {
            let Ok(_com) = Com::init() else {
                let _ = opened.send(Err(Error::runtime("source_bridge_capture_failed")));
                return;
            };
            let stream = match open(&identity) {
                Ok(stream) => {
                    let _ = opened.send(Ok(()));
                    stream
                }
                Err(error) => {
                    let _ = opened.send(Err(error));
                    return;
                }
            };
            while !stop.load(Ordering::SeqCst) {
                match read(&stream, &mut callbacks.on_audio) {
                    Ok(true) => std::thread::sleep(Duration::from_millis(10)),
                    Ok(false) => break,
                    Err(error) => {
                        (callbacks.on_error)(&error.code);
                        break;
                    }
                }
            }
            let _lock = audio_op_lock().lock();
            let _ = unsafe { stream.client.Stop() };
        })
        .map_err(|_| Error::runtime("source_bridge_capture_failed"))?;
        self.worker = Some(worker);
        started.recv_timeout(Duration::from_secs(5)).unwrap_or_else(|_| {
            // The open is still waiting (a permission question, a driver that does not answer).
            // Tell the thread to close the stream as soon as it opens instead of reading it.
            self.request_stop();
            Err(Error::runtime("source_bridge_capture_failed"))
        })
    }

    fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    fn stop(&mut self) {
        self.request_stop();
        if let Some(worker) = self.worker.take() {
            worker.join(Duration::from_secs(1));
        }
    }
}

impl Drop for WasapiCapture {
    /// A capture dropped without `stop` (a start that failed, a caller that returned early)
    /// must not keep reading the device until the app exits.
    fn drop(&mut self) {
        self.request_stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_after_a_long_gap_is_capped() {
        let format = DeviceFormat { rate: 48000, channels: 2 };
        assert_eq!(silence_bytes(Duration::from_millis(100), format), 4800 * 2 * 2);
        // Eight hours asleep would be 5.5 GB; one second is delivered instead.
        assert_eq!(silence_bytes(Duration::from_secs(8 * 3600), format), 48000 * 2 * 2);
    }
}
