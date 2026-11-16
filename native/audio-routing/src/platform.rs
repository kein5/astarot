//! What an application needs from this computer's audio devices, in one place it can
//! replace: the device lists for the [`DeviceManager`](crate::manager::DeviceManager),
//! the outputs speech can play to, and the devices of the virtual microphone check.
//!
//! [`NativePlatform`] is WASAPI on Windows and PipeWire on Linux (with the `pipewire`
//! feature); anything else lists nothing.

use std::sync::Arc;

use crate::error::Result;
use crate::graph::OutputOption;
use crate::manager::DeviceBackend;
use crate::report::Reporter;
use crate::virtual_mic::CableDevices;

pub trait AudioPlatform: Send + Sync {
    /// The lists and change notifications the device manager reads.
    fn backend(&self, reporter: Arc<dyn Reporter>) -> Arc<dyn DeviceBackend>;
    /// The outputs speech can play to. On Windows, `keep` holds saved choices from other
    /// hosts, listed while a WASAPI device of the same name exists.
    fn outputs(&self, keep: &[String]) -> Result<Vec<OutputOption>>;
    /// The devices of the virtual microphone check; `None` where it is not offered
    /// (Linux makes its own virtual microphone).
    fn cables(&self) -> Option<Arc<dyn CableDevices>>;
    /// Ends what the platform keeps for the whole process (the PipeWire observation).
    fn shutdown(&self) {}
}

/// This computer's devices.
#[derive(Debug, Default, Clone, Copy)]
pub struct NativePlatform;

impl AudioPlatform for NativePlatform {
    fn backend(&self, reporter: Arc<dyn Reporter>) -> Arc<dyn DeviceBackend> {
        crate::manager::platform_backend(reporter)
    }

    fn outputs(&self, keep: &[String]) -> Result<Vec<OutputOption>> {
        #[cfg(windows)]
        {
            crate::wasapi::output::enumerate_outputs(keep)
        }
        #[cfg(all(target_os = "linux", feature = "pipewire"))]
        {
            let _ = keep;
            crate::pipewire::output::enumerate_outputs()
        }
        #[cfg(not(any(windows, all(target_os = "linux", feature = "pipewire"))))]
        {
            let _ = keep;
            Err(crate::error::Error::speech("unsupported_platform"))
        }
    }

    fn cables(&self) -> Option<Arc<dyn CableDevices>> {
        #[cfg(windows)]
        {
            Some(Arc::new(windows_cables::WasapiCables))
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    fn shutdown(&self) {
        #[cfg(all(target_os = "linux", feature = "pipewire"))]
        crate::pipewire::shutdown();
    }
}

#[cfg(windows)]
mod windows_cables {
    //! The check's devices through WASAPI: the cables among the WASAPI outputs and
    //! microphones, the tone through the speech output, the level through a small capture
    //! converted by WASAPI to 48 kHz mono.

    use std::collections::VecDeque;
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    use crate::error::{Error, Result};
    use crate::router::Output;
    use crate::sync::lock;
    use crate::virtual_mic::{pair_cables, CableDevices, CablePair, LevelInput, BLOCK_SECONDS, TONE_RATE};
    use crate::wasapi::capture::{WasapiCapture, RATE};
    use crate::wasapi::output::{enumerate_outputs, WindowsOutput};
    use crate::wasapi::enumerate_endpoints;
    use crate::windows_route::{Capture, CaptureCallbacks};

    pub struct WasapiCables;

    impl CableDevices for WasapiCables {
        fn find_cables(&self) -> Result<Vec<CablePair>> {
            let outputs: Vec<String> = enumerate_outputs(&[])?.into_iter().map(|o| o.id).collect();
            let inputs: Vec<String> = enumerate_endpoints("mic")?.into_iter().map(|row| row.endpoint.name).collect();
            Ok(pair_cables(&outputs, &inputs))
        }

        fn open_output(&self, identity: &str) -> Result<Box<dyn Output>> {
            Ok(Box::new(WindowsOutput::open(identity, TONE_RATE, 1, true)?))
        }

        fn open_input(&self, identity: &str) -> Result<Box<dyn LevelInput>> {
            let shared = Arc::new((Mutex::new(VecDeque::new()), Condvar::new()));
            let audio = shared.clone();
            let mut capture = WasapiCapture::new(
                identity,
                CaptureCallbacks {
                    on_audio: Box::new(move |pcm| {
                        let (buffer, ready) = &*audio;
                        let mut buffer = lock(buffer);
                        buffer.extend(pcm.iter().copied());
                        // Keep at most a second: the reader takes a block every 50 ms.
                        let excess = buffer.len().saturating_sub(RATE as usize * 2);
                        buffer.drain(..excess);
                        ready.notify_all();
                        true
                    }),
                    on_error: Box::new(|_| {}),
                },
            );
            capture.start().map_err(|_| Error::runtime("virtual_mic_recording_unavailable"))?;
            Ok(Box::new(CableInput { capture, shared }))
        }
    }

    struct CableInput {
        capture: WasapiCapture,
        shared: Arc<(Mutex<VecDeque<u8>>, Condvar)>,
    }

    impl LevelInput for CableInput {
        fn read(&mut self) -> Vec<u8> {
            let want = (f64::from(RATE) * BLOCK_SECONDS) as usize * 2;
            let deadline = Instant::now() + Duration::from_secs_f64(BLOCK_SECONDS * 4.0);
            let (buffer, ready) = &*self.shared;
            let mut buffer = lock(buffer);
            while buffer.len() < want {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    break;
                }
                buffer = ready.wait_timeout(buffer, left).unwrap_or_else(|e| e.into_inner()).0;
            }
            let take = buffer.len().min(want);
            buffer.drain(..take).collect()
        }
    }

    impl Drop for CableInput {
        fn drop(&mut self) {
            self.capture.stop();
        }
    }
}
