//! The device lists of the device manager on Linux.
//!
//! Port of `DeviceManager._linuxMicDevices`: the PipeWire inputs that can be forwarded
//! or converted, under one host named `PipeWire`. There is no PortAudio on Linux, so
//! there are no speaker rows, and changes are found by polling (every two seconds,
//! as before).

use std::sync::Arc;

use crate::graph::{microphone_devices, PIPEWIRE_MIC_HOST};
use crate::manager::{DeviceBackend, Topology, Watch};
use crate::snapshot::{DefaultMic, Host, RawLists};
use crate::tracker::{Flow, MeterFactory, MeterSource};

pub struct PipeWireBackend;

struct NoMeters;

impl MeterFactory for NoMeters {
    fn available(&self) -> bool {
        false
    }
    fn open(&self, _: Flow) -> Option<Box<dyn MeterSource>> {
        None
    }
}

impl DeviceBackend for PipeWireBackend {
    fn enumerate(&self) -> RawLists {
        // An unreadable graph lists nothing, as a missing pw-dump did.
        let Ok(graph) = crate::pipewire::read_graph_data(true, None) else { return RawLists::none() };
        match microphone_devices(&graph) {
            (devices, Some(default)) if !devices.is_empty() => RawLists {
                mic_devices: vec![(PIPEWIRE_MIC_HOST.to_owned(), devices)],
                default_mic_device: DefaultMic { host: Host { index: 0, name: PIPEWIRE_MIC_HOST.to_owned() }, device: default },
                ..RawLists::none()
            },
            _ => RawLists::none(),
        }
    }

    fn watch(&self, _: Arc<dyn Fn(Topology) + Send + Sync>) -> Option<Box<dyn Watch>> {
        None
    }

    fn meters(&self) -> Arc<dyn MeterFactory> {
        Arc::new(NoMeters)
    }
}
