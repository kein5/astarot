//! A conversion on the managed route (Linux; `_PipeWireRoute` of [`process.py`], decision 11 in
//! `docs/voice-stack/core-integration.md`): the microphone it converts is captured from
//! PipeWire, and the converted voice goes into the managed VC input (`vrct.managed.vc`), whose
//! OS gate owns mute. Nothing is written in place of the gate.
//!
//! [`process.py`]: https://github.com/kein5/astarot/blob/v0.5.2/src-python/models/voice_conversion/process.py

use crate::error::Result;
use crate::graph::Endpoint;
use crate::router::Output;
use crate::windows_route::{Capture, CaptureCallbacks};

/// The OS gate of the managed VC input mutes: writes are not silenced here.
pub const GATES_OUTPUT: bool = false;
/// A late block is not dropped: one waiting block more is an overrun.
pub const DROPS_LATE_BLOCKS: bool = false;
/// How long the worker may take to be ready.
pub const READY_TIMEOUT_S: u64 = 60;
/// Blocks that may wait for the worker.
pub const INPUT_BLOCKS: usize = 1;

/// The devices of a conversion on the managed route.
pub trait ManagedVcDevices: Send + Sync {
    /// The managed VC input, while `source` is still the input it was chosen as (`_binding`).
    /// `wait` reads the graph afresh (slow); otherwise the route's own observation of it.
    fn bind(&self, source: &Endpoint, wait: bool) -> Result<Endpoint>;
    /// 48 kHz mono into the managed VC input, held to its identity.
    fn open_output(&self, sink: &Endpoint) -> Result<Box<dyn Output>>;
    /// `source` at 48 kHz mono s16le.
    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture>;
}

/// The managed route's devices through PipeWire. It observes the graph while it lives, so that
/// the binding is checked against a current graph during the conversion.
#[cfg(all(target_os = "linux", feature = "pipewire"))]
pub struct PipeWireVcDevices {
    _observing: Option<crate::graph_source::Subscription>,
}

#[cfg(all(target_os = "linux", feature = "pipewire"))]
impl PipeWireVcDevices {
    pub fn new() -> Self {
        Self { _observing: crate::pipewire::graph_source().subscribe(None).ok() }
    }
}

#[cfg(all(target_os = "linux", feature = "pipewire"))]
impl Default for PipeWireVcDevices {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(all(target_os = "linux", feature = "pipewire"))]
impl ManagedVcDevices for PipeWireVcDevices {
    fn bind(&self, source: &Endpoint, wait: bool) -> Result<Endpoint> {
        let data = crate::pipewire::read_graph_data(wait, None).map_err(|_| crate::Error::runtime("source_bridge_graph_unavailable"))?;
        if crate::graph::select_source(&data, &source.name)? != *source {
            return Err(crate::Error::runtime("vc_source_changed"));
        }
        crate::graph::vc_sink(&data)
    }

    fn open_output(&self, sink: &Endpoint) -> Result<Box<dyn Output>> {
        let output = crate::pipewire::output::PipeWireOutput::open(&sink.name, crate::pipewire::capture::RATE, 1, Some((sink.cookie, sink.serial)), "vrct.vc")?;
        Ok(Box::new(output))
    }

    fn capture(&self, source: &Endpoint, callbacks: CaptureCallbacks) -> Box<dyn Capture> {
        Box::new(crate::pipewire::capture::PipeWireCapture::new(source.clone(), "vrct.vc.capture", callbacks))
    }
}
