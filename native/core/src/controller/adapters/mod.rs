//! The external adapters wired to their endpoints: OSC and OSCQuery towards VRChat, the
//! WebSocket server, the OBS browser source and the clipboard switch (`native/adapters`).
//!
//! The endpoints keep the rules of `src-python/controller.py` and the parts of `model.py` they
//! call: the same checks, error codes and `data` to roll back to, the same order of stopping
//! and restarting the servers, and the same notices at start-up. The clipboard switch is a
//! plain setting ([`super::routes`]); the copy and paste run with the message pipeline.
//!
//! - [`osc`]: the destination, typing, the switch to VRChat, VRChat's presence, mic mute sync
//!   and the `/run/enable_osc_query` notifications.
//! - [`servers`]: the WebSocket server, its token and certificate, and the OBS page.
//!
//! What reaches the network goes through [`Osc`] (replaceable in [`super::Services`]) and the
//! servers of the adapters crate, which listen on the address the user chose. Log lines are
//! fixed strings: no text, token, path or address goes into the log.

mod osc;
mod servers;

use super::Core;
use super::routes::Builder;
use crate::config::Config;
use crate::dispatch::Output;
use serde_json::Value;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use vrct_adapters::osc::{OscError, OscHandler, Target};

pub(crate) use osc::MuteState;
pub(crate) use servers::{ObsSlot, StartupNotices};

/// How long the shutdown waits for each adapter to stop (`_SHUTDOWN_SERVICE_STOP_TIMEOUT_SEC`).
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// The OSC link to VRChat: sending to the chatbox and, when VRChat is on this PC, receiving its
/// parameters and asking it through OSCQuery. [`OscHandler`] is the real one; tests use a
/// stand-in so that nothing joins mDNS.
pub trait Osc: Send + Sync {
    /// Changes the destination; receiving restarts for it. On failure the old one is kept.
    fn set_ip_address(&self, ip_address: &str) -> Result<(), OscError>;
    fn set_port(&self, port: u16) -> Result<(), OscError>;
    fn send_typing(&self, typing: bool) -> io::Result<()>;
    /// Sends chatbox text; `current` is asked right before sending. True when sent.
    fn send_message(&self, text: &str, notification: bool, current: Option<&dyn Fn() -> bool>) -> io::Result<bool>;
    /// Starts receiving `targets` (and OSCQuery) when the destination is this PC.
    fn receive(&self, targets: Vec<(String, Target)>) -> Result<(), OscError>;
    /// Receiving and OSCQuery run.
    fn query_enabled(&self) -> bool;
    /// Whether a VRChat with OSC on is seen on this PC; `None` when that cannot be known.
    fn vrchat_presence(&self) -> Option<bool>;
    /// `MuteSelf` of the local VRChat, through OSCQuery, within 2 seconds.
    fn mute_self(&self) -> Option<bool>;
    /// Refuses everything from now on, without waiting.
    fn request_stop(&self);
    /// Stops receiving and closes everything, waiting a few seconds at most.
    fn stop(&self) -> Result<(), OscError>;
}

impl Osc for OscHandler {
    fn set_ip_address(&self, ip_address: &str) -> Result<(), OscError> {
        self.set_osc_ip_address(ip_address)
    }

    fn set_port(&self, port: u16) -> Result<(), OscError> {
        self.set_osc_port(port)
    }

    fn send_typing(&self, typing: bool) -> io::Result<()> {
        OscHandler::send_typing(self, typing)
    }

    fn send_message(&self, text: &str, notification: bool, current: Option<&dyn Fn() -> bool>) -> io::Result<bool> {
        OscHandler::send_message(self, text, notification, current)
    }

    fn receive(&self, targets: Vec<(String, Target)>) -> Result<(), OscError> {
        self.set_dict_filter_and_target(targets);
        self.receive_osc_parameters()
    }

    fn query_enabled(&self) -> bool {
        self.is_osc_query_enabled()
    }

    fn vrchat_presence(&self) -> Option<bool> {
        self.local_vrchat_presence()
    }

    fn mute_self(&self) -> Option<bool> {
        self.get_osc_parameter_mute_self()
    }

    fn request_stop(&self) {
        OscHandler::request_stop(self)
    }

    fn stop(&self) -> Result<(), OscError> {
        self.osc_server_stop()
    }
}

/// Opens an OSC link for an address and a port ([`super::Services::osc`]).
pub type OpenOsc = Arc<dyn Fn(&str, u16) -> io::Result<Arc<dyn Osc>> + Send + Sync>;

/// Opens the real OSC link (`OSCHandler(config.OSC_IP_ADDRESS, config.OSC_PORT)`).
pub fn open_osc(ip_address: &str, port: u16) -> io::Result<Arc<dyn Osc>> {
    Ok(Arc::new(OscHandler::new(ip_address, port)?))
}

/// What the adapters keep between requests.
pub(crate) struct Adapters {
    config: Arc<Config>,
    output: Arc<dyn Output>,
    services: super::Services,
    /// `None` when the saved destination could not be opened; a new destination opens it.
    osc: Mutex<Option<Arc<dyn Osc>>>,
    /// `_OSC_CONTROL_LOCK`: the destination, receive start-up and enabling mute sync.
    osc_control: Mutex<()>,
    osc_shutdown: AtomicBool,
    /// `_typing_lock` with `_typing_active`.
    typing: Mutex<bool>,
    /// The mic lock of mute sync, with VRChat's mute as last known.
    mute: Mutex<MuteState>,
    websocket: Mutex<Option<Arc<vrct_adapters::websocket::WebSocketServer>>>,
    obs: Mutex<Option<ObsSlot>>,
    startup: Mutex<StartupNotices>,
}

impl Adapters {
    fn new(core: &Core) -> Arc<Self> {
        let config = Arc::clone(core.config());
        let ip = config.get_str("OSC_IP_ADDRESS");
        let port = config.get("OSC_PORT").as_u64().and_then(|p| u16::try_from(p).ok()).unwrap_or(9000);
        let osc = match (core.services().osc)(&ip, port) {
            Ok(osc) => Some(osc),
            Err(_) => {
                core.step("OSC: the saved destination could not be opened");
                None
            }
        };
        Arc::new(Self {
            config,
            output: Arc::clone(&core.output),
            services: core.services().clone(),
            osc: Mutex::new(osc),
            osc_control: Mutex::new(()),
            osc_shutdown: AtomicBool::new(false),
            typing: Mutex::new(false),
            mute: Mutex::new(MuteState::default()),
            websocket: Mutex::new(None),
            obs: Mutex::new(None),
            startup: Mutex::new(StartupNotices::default()),
        })
    }

    fn step(&self, text: &str) {
        self.output.note(text);
    }

    /// A notification on an endpoint (`controller.run`).
    fn run(&self, status: u16, endpoint: &str, result: Value) {
        self.output.answer(status, Some(endpoint), &result);
    }

    fn osc(&self) -> Option<Arc<dyn Osc>> {
        self.osc.lock().unwrap().clone()
    }

    fn shutting_down(&self) -> bool {
        self.osc_shutdown.load(Ordering::SeqCst)
    }
}

/// Registers the endpoints of the adapters (an entry of `routes::AREAS`).
pub(crate) fn add(b: &mut Builder<'_>) {
    let core = Arc::clone(b.core);
    let adapters = Adapters::new(&core);
    if core.adapters.set(Arc::clone(&adapters)).is_err() {
        return;
    }
    // The adapters crate logs a few fixed lines; they go to this run's log.
    let log = Arc::downgrade(core.log());
    vrct_adapters::log::set_sink(move |line| {
        if let Some(log) = log.upgrade() {
            log.step(line, None);
        }
    });
    osc::add(b);
    servers::add(b);
}

impl Core {
    fn adapters(&self) -> Option<&Arc<Adapters>> {
        self.adapters.get()
    }

    /// Start-up (`Controller.init`): OSC receive starts in the background, then the WebSocket
    /// and OBS servers start from the saved settings, before the settings snapshot.
    pub(crate) fn start_adapters(&self) {
        let Some(adapters) = self.adapters() else { return };
        self.step("Init OSC Receive (Background)");
        let background = Arc::clone(adapters);
        let spawned = std::thread::Builder::new().name("osc_init_receive".into()).spawn(move || background.init_osc_receive());
        if spawned.is_err() {
            self.step("OSC: receive/advertisement setup failed");
        }
        self.step("Init WebSocket Server");
        adapters.start_servers();
    }

    /// The notices of the start-up, once the UI has the settings (after `initialization_complete`).
    pub(crate) fn notify_adapters_started(&self) {
        if let Some(adapters) = self.adapters() {
            adapters.notify_startup();
        }
    }

    /// Stops OSC, then the OBS page, then the WebSocket server (`Controller.shutdown`). Each stop
    /// may take a few seconds at most; one that hangs is left behind.
    pub(crate) fn stop_adapters(&self) {
        let Some(adapters) = self.adapters() else { return };
        adapters.request_osc_stop();
        let osc = Arc::clone(adapters);
        stop_within(adapters, "OSC receive server", move || osc.stop_osc());
        let obs = Arc::clone(adapters);
        stop_within(adapters, "OBS browser source server", move || obs.stop_obs());
        let websocket = Arc::clone(adapters);
        stop_within(adapters, "WebSocket server", move || websocket.stop_websocket());
    }
}

/// `_stopServiceForShutdown`: runs `stop` on its own thread and waits at most [`STOP_TIMEOUT`].
fn stop_within(adapters: &Adapters, label: &'static str, stop: impl FnOnce() + Send + 'static) {
    let (done, finished) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("adapter_stop".into()).spawn(move || {
        stop();
        let _ = done.send(());
    });
    if spawned.is_err() || finished.recv_timeout(STOP_TIMEOUT).is_err() {
        adapters.step(match label {
            "OSC receive server" => "shutdown: the OSC receive server did not stop in time",
            "OBS browser source server" => "shutdown: the OBS browser source server did not stop in time",
            _ => "shutdown: the WebSocket server did not stop in time",
        });
    }
}

/// `int(value)` for a port already checked by `is_valid_port`.
fn port_of(value: &Value) -> u16 {
    value.as_u64().and_then(|p| u16::try_from(p).ok()).unwrap_or(0)
}
