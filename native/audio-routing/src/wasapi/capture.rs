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
    let _lock = audio_op_lock().lock();
    let enumerator = enumerator()?;
    let device = find_by_identity(&enumerator, eCapture, identity).map_err(|_| Error::runtime("source_bridge_capture_failed"))?;
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
        started.recv_timeout(Duration::from_secs(5)).unwrap_or(Err(Error::runtime("source_bridge_capture_failed")))
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
