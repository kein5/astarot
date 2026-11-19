//! What speech and direct voice need from this computer, in one place tests replace: the
//! speech output, the monitor, the managed route's OS gate, the microphones direct voice can
//! take, its passthrough and the device route of a conversion, and the RVC worker and the
//! downloads of its runtime.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use vrct_audio_routing::graph::Source;
use vrct_audio_routing::monitor::MonitorFactory;
use vrct_audio_routing::router::Output;
use vrct_audio_routing::voice_route::{Gate, GatePair};
use vrct_audio_routing::managed_vc::ManagedVcDevices;
use vrct_audio_routing::windows_route::RouteDevices;
use vrct_audio_routing::{Error, Result};
use vrct_ops::downloads::transport::Transport;
use vrct_voice_conversion::DirectBackend;
use vrct_voice_conversion::runtime::Target;

pub trait VoicePlatform: Send + Sync {
    /// The microphones direct voice can forward or convert (`enumerate_sources`).
    fn direct_sources(&self) -> Result<Vec<Source>>;
    /// The identity of the OS default microphone (Windows): the RVC input's default.
    fn default_microphone(&self) -> Option<String>;
    /// The output speech plays to: a device, or `vrct.managed.tts` on the managed route.
    fn speech_output(&self, device: &str, rate: u32, channels: u16) -> Result<Box<dyn Output>>;
    /// How a monitor (a local copy of the speech) opens its device.
    fn monitor_output(&self) -> MonitorFactory;
    /// The managed route's OS gate (Linux).
    fn gate(&self, app_dir: &Path) -> Arc<dyn Gate>;
    /// The microphone forwarded without conversion: to `output` (Windows) or into the managed
    /// route (Linux).
    fn passthrough(&self, app_dir: &Path, output: Option<&str>) -> std::result::Result<Box<dyn DirectBackend>, String>;
    /// The capture and output devices of a conversion on a device route (Windows).
    fn route_devices(&self) -> Option<Arc<dyn RouteDevices>>;
    /// The capture of a conversion on the managed route and the managed VC input it plays into
    /// (Linux, decision 11). A new one for each conversion: it observes the graph while it lives.
    fn managed_vc_devices(&self) -> Option<Arc<dyn ManagedVcDevices>> {
        None
    }
    /// The RVC worker the app ships (`build/vrct-rvc-worker`).
    fn rvc_worker(&self, app_dir: &Path) -> PathBuf;
    /// How the worker's runtime is downloaded.
    fn runtime_transport(&self) -> Arc<dyn Transport>;
    fn nvidia_driver(&self) -> bool;
    /// The platform a runtime can be set up for.
    fn runtime_target(&self) -> Option<Target>;
    /// What the runtime setup offers in place of the pinned runtime (tests).
    fn runtime_entries(&self) -> Option<Vec<vrct_voice_conversion::runtime::Runtime>> {
        None
    }
}

/// This computer: WASAPI on Windows, PipeWire on Linux with the `pipewire` feature.
pub struct NativeVoice;

/// The managed route's gate where there is none: every inspection fails, so the managed route
/// never claims to be open (a Windows saved setting is moved off it at start).
pub struct NoGate;

impl Gate for NoGate {
    fn inspect_pair(&self) -> Result<GatePair> {
        Err(Error::runtime("managed_endpoint_missing_or_invalid"))
    }
    fn set_muted(&self, _: bool, _: (u64, u64)) -> Result<vrct_audio_routing::graph::GateState> {
        Err(Error::runtime("managed_endpoint_missing_or_invalid"))
    }
    fn set_direct_muted(&self, _: bool, _: (u64, u64)) -> Result<vrct_audio_routing::graph::GateState> {
        Err(Error::runtime("managed_endpoint_missing_or_invalid"))
    }
    fn resume(&self, _: (u64, u64), _: (u64, u64), _: bool) -> Result<GatePair> {
        Err(Error::runtime("managed_endpoint_missing_or_invalid"))
    }
}

impl VoicePlatform for NativeVoice {
    fn direct_sources(&self) -> Result<Vec<Source>> {
        #[cfg(windows)]
        {
            use vrct_audio_routing::graph::SourceId;
            Ok(vrct_audio_routing::wasapi::enumerate_endpoints("mic")?.into_iter().map(|row| Source { id: SourceId::from(&row.endpoint), label: row.label }).collect())
        }
        #[cfg(all(target_os = "linux", feature = "pipewire"))]
        {
            let graph = vrct_audio_routing::pipewire::read_graph_data(true, None).map_err(|_| Error::runtime("source_bridge_graph_unavailable"))?;
            Ok(vrct_audio_routing::graph::sources(&graph))
        }
        #[cfg(not(any(windows, all(target_os = "linux", feature = "pipewire"))))]
        {
            Err(Error::runtime("source_bridge_graph_unavailable"))
        }
    }

    fn default_microphone(&self) -> Option<String> {
        #[cfg(windows)]
        {
            vrct_audio_routing::wasapi::default_endpoint("mic").ok().map(|endpoint| endpoint.name)
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    fn speech_output(&self, device: &str, rate: u32, channels: u16) -> Result<Box<dyn Output>> {
        vrct_audio_routing::router::open_output(device, rate, channels)
    }

    fn monitor_output(&self) -> MonitorFactory {
        Arc::new(vrct_audio_routing::monitor::open_monitor_output)
    }

    fn gate(&self, app_dir: &Path) -> Arc<dyn Gate> {
        #[cfg(all(target_os = "linux", feature = "pipewire"))]
        {
            let helper = crate::resources::locate(app_dir, "build/vrct-voice-gate");
            Arc::new(vrct_audio_routing::pipewire::gate::PipeWireGate::new(helper, vrct_audio_routing::process::ProcessEnv::default()))
        }
        #[cfg(not(all(target_os = "linux", feature = "pipewire")))]
        {
            let _ = app_dir;
            Arc::new(NoGate)
        }
    }

    fn passthrough(&self, app_dir: &Path, output: Option<&str>) -> std::result::Result<Box<dyn DirectBackend>, String> {
        match output {
            Some(output) => {
                let devices = self.route_devices().ok_or("source_bridge_linux_only")?;
                Ok(Box::new(vrct_audio_routing::windows_route::WindowsBridge::new(output, devices, vrct_audio_routing::report::reporter())))
            }
            None => {
                #[cfg(all(target_os = "linux", feature = "pipewire"))]
                {
                    let build = crate::resources::locate(app_dir, "build");
                    let system = vrct_audio_routing::pipewire::bridge::PipeWireBridgeSystem { build, env: vrct_audio_routing::process::ProcessEnv::default() };
                    Ok(Box::new(SourceBridgeBackend(vrct_audio_routing::pipewire::bridge::SourceBridge::new(Arc::new(system)))))
                }
                #[cfg(not(all(target_os = "linux", feature = "pipewire")))]
                {
                    let _ = app_dir;
                    Err("source_bridge_linux_only".into())
                }
            }
        }
    }

    fn route_devices(&self) -> Option<Arc<dyn RouteDevices>> {
        #[cfg(windows)]
        {
            Some(Arc::new(vrct_audio_routing::windows_route::WasapiDevices))
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    fn managed_vc_devices(&self) -> Option<Arc<dyn ManagedVcDevices>> {
        #[cfg(all(target_os = "linux", feature = "pipewire"))]
        {
            Some(Arc::new(vrct_audio_routing::managed_vc::PipeWireVcDevices::new()))
        }
        #[cfg(not(all(target_os = "linux", feature = "pipewire")))]
        {
            None
        }
    }

    fn rvc_worker(&self, app_dir: &Path) -> PathBuf {
        crate::resources::locate(app_dir, &format!("build/{}", vrct_voice_conversion::worker::worker_name()))
    }

    fn runtime_transport(&self) -> Arc<dyn Transport> {
        Arc::new(vrct_ops::downloads::transport::Public {
            timeout: vrct_ops::downloads::transport::TIMEOUT,
            hosts: vrct_voice_conversion::runtime::SOURCE_HOSTS.iter().map(|h| h.to_string()).collect(),
        })
    }

    fn nvidia_driver(&self) -> bool {
        vrct_voice_conversion::runtime::nvidia_driver()
    }

    fn runtime_target(&self) -> Option<Target> {
        Target::current()
    }
}


/// The Linux source bridge as a direct producer.
#[cfg(all(target_os = "linux", feature = "pipewire"))]
struct SourceBridgeBackend(vrct_audio_routing::pipewire::bridge::SourceBridge);

#[cfg(all(target_os = "linux", feature = "pipewire"))]
impl DirectBackend for SourceBridgeBackend {
    fn start(&self, source: vrct_audio_routing::graph::Endpoint) -> std::result::Result<(), String> {
        self.0.start(Some(source), None).map_err(|e| e.code)
    }
    fn stop(&self) {
        self.0.stop()
    }
    fn close(&self, timeout: std::time::Duration) -> bool {
        self.0.close(timeout)
    }
    fn health(&self) -> vrct_voice_conversion::Health {
        let health = self.0.health();
        vrct_voice_conversion::Health { requested: health.requested, active: health.active, pending: health.pending, stopping: health.stopping, error: health.error, ..Default::default() }
    }
    fn set_monitor_muted(&self, _: bool) {}
}
