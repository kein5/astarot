//! OSC towards VRChat: the destination, typing, the switch to VRChat, VRChat's presence and mic
//! mute sync (`setOscIpAddress`, `setOscPort`, `typingMessageBox`, `setEnableVrcMicMuteSync`,
//! `_publishOscQueryReadiness`, `_initOscReceive` and the mute state of `model.py`).
//!
//! Mic mute sync keeps the microphone held back while VRChat's `MuteSelf` is on. A `true` from
//! VRChat holds it at once; a `false` (or an avatar change) is believed only once OSCQuery
//! confirms it, one query at a time. Anything unknown keeps the microphone held back. The core
//! tells the recognition through [`super::super::Services::vrc_mic_mute`].

use super::{Adapters, port_of};
use crate::config::schema::is_valid_port;
use crate::controller::routes::{Builder, OPEN, WAIT};
use crate::controller::{error, ok, ok_true};
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::net::IpAddr;
use std::sync::{Arc, Weak};
use vrct_adapters::osc::{OscArg, OscError, PARAMETER_MUTE_SELF, Target, uses_osc_query};

const AVATAR_CHANGE: &str = "/avatar/change";

/// VRChat's mute as last known, and which query result still counts.
#[derive(Default)]
pub(crate) struct MuteState {
    generation: u64,
    /// `None` until VRChat or OSCQuery said something; `Some(true)` while held back.
    muted: Option<bool>,
    /// Receiving started and the run is not ending (`_osc_query_admission`).
    admitted: bool,
    pending: Option<u64>,
    querying: bool,
    /// What the recognition was last told.
    reported: Option<bool>,
}

pub(super) fn add(b: &mut Builder<'_>) {
    b.with("/run/typing_message_box", WAIT, |core, _| with(core, |a| a.typing()));
    b.with("/run/stop_typing_message_box", WAIT, |core, _| with(core, |a| a.stop_typing()));
    b.with("/set/enable/vrc_mic_mute_sync", OPEN, |core, _| with(core, |a| a.enable_mute_sync()));
    b.with("/set/disable/vrc_mic_mute_sync", OPEN, |core, _| with(core, |a| a.disable_mute_sync()));
    b.with("/set/enable/send_message_to_vrc", OPEN, |core, _| with(core, |a| a.set_send_message_to_vrc(true)));
    b.with("/set/disable/send_message_to_vrc", OPEN, |core, _| with(core, |a| a.set_send_message_to_vrc(false)));
    b.with("/get/data/vrchat_osc_presence", OPEN, |core, _| with(core, |a| ok(a.vrchat_presence())));
    b.with("/set/data/osc_ip_address", OPEN, |core, data| with(core, |a| a.set_osc_ip_address(data)));
    b.with("/set/data/osc_port", OPEN, |core, data| with(core, |a| a.set_osc_port(data)));
}

pub(super) fn with(core: &Arc<crate::controller::Core>, f: impl FnOnce(&Arc<Adapters>) -> Reply) -> Reply {
    match core.adapters() {
        Some(adapters) => f(adapters),
        None => Reply::status(500, "Internal error"),
    }
}

/// `isValidIpAddress`: an IPv4 or IPv6 address (an IPv6 scope is allowed).
fn valid_ip(text: &str) -> bool {
    if text.parse::<IpAddr>().is_ok() {
        return true;
    }
    match text.split_once('%') {
        Some((address, scope)) => !scope.is_empty() && !scope.contains('%') && address.parse::<std::net::Ipv6Addr>().is_ok(),
        None => false,
    }
}

impl Adapters {
    // ---------------------------------------------------------------- destination

    fn set_osc_ip_address(self: &Arc<Self>, data: &Value) -> Reply {
        let _control = self.osc_control.lock().unwrap();
        // Python's ip_address also takes an integer; the handler then fails to open it.
        let Some(ip) = data.as_str().filter(|ip| valid_ip(ip)).map(str::to_string) else {
            let code = if data.is_u64() { "VALIDATION_CANNOT_SET_IP" } else { "VALIDATION_INVALID_IP" };
            return error(code, self.config.get("OSC_IP_ADDRESS"));
        };
        let changed = self.change_destination(|osc| osc.set_ip_address(&ip), &ip, None);
        let reply = match changed {
            Ok(()) => {
                let _ = self.config.set("OSC_IP_ADDRESS", json!(ip));
                ok(self.config.get("OSC_IP_ADDRESS"))
            }
            // The handler already went back to the previous destination.
            Err(_) => error("VALIDATION_CANNOT_SET_IP", self.config.get("OSC_IP_ADDRESS")),
        };
        self.publish_osc_readiness(false);
        reply
    }

    fn set_osc_port(self: &Arc<Self>, data: &Value) -> Reply {
        if !is_valid_port(data) {
            return error("VALIDATION_OSC_PORT_INVALID", self.config.get("OSC_PORT"));
        }
        let port = port_of(data);
        let _control = self.osc_control.lock().unwrap();
        let ip = self.config.get_str("OSC_IP_ADDRESS");
        let reply = match self.change_destination(|osc| osc.set_port(port), &ip, Some(port)) {
            Ok(()) => {
                let _ = self.config.set("OSC_PORT", json!(port));
                ok(self.config.get("OSC_PORT"))
            }
            // Python let the failure raise.
            Err(_) => Reply::status(500, "Internal error"),
        };
        self.publish_osc_readiness(false);
        reply
    }

    /// `model.setOscIpAddress` / `setOscPort`: a pending mute query no longer counts.
    fn change_destination(
        &self,
        change: impl FnOnce(&dyn super::Osc) -> Result<(), OscError>,
        ip: &str,
        port: Option<u16>,
    ) -> Result<(), OscError> {
        if self.shutting_down() {
            return Err(OscError::ShutDown);
        }
        self.with_mute(|state| {
            self.invalidate(state);
        });
        if let Some(osc) = self.osc() {
            return change(osc.as_ref());
        }
        // The saved destination never opened: open the new one.
        let port = port.unwrap_or_else(|| port_of(&self.config.get("OSC_PORT")));
        let osc = (self.services.osc)(ip, port).map_err(OscError::from)?;
        *self.osc.lock().unwrap() = Some(osc);
        Ok(())
    }

    // ---------------------------------------------------------------- typing and sending

    fn typing(&self) -> Reply {
        let mut active = self.typing.lock().unwrap();
        if self.config.get_bool("SEND_MESSAGE_TO_VRC") {
            if self.send_typing(true).is_err() {
                return Reply::status(500, "Internal error");
            }
            *active = true;
        }
        ok_true()
    }

    fn stop_typing(&self) -> Reply {
        let mut active = self.typing.lock().unwrap();
        if self.stop_typing_locked(&mut active).is_err() {
            return Reply::status(500, "Internal error");
        }
        ok_true()
    }

    fn stop_typing_locked(&self, active: &mut bool) -> std::io::Result<()> {
        if *active {
            self.send_typing(false)?;
            *active = false;
        }
        Ok(())
    }

    fn send_typing(&self, typing: bool) -> std::io::Result<()> {
        match self.osc() {
            Some(osc) => osc.send_typing(typing),
            None => Err(std::io::Error::new(std::io::ErrorKind::NotConnected, "no OSC destination")),
        }
    }

    /// Turning sending off also ends the typing indicator, under the typing lock.
    fn set_send_message_to_vrc(&self, on: bool) -> Reply {
        let mut active = self.typing.lock().unwrap();
        if self.config.get_bool("SEND_MESSAGE_TO_VRC") != on {
            let _ = self.config.set("SEND_MESSAGE_TO_VRC", json!(on));
        }
        if !on && self.stop_typing_locked(&mut active).is_err() {
            self.step("OSC: the typing indicator could not be cleared");
        }
        ok(self.config.get("SEND_MESSAGE_TO_VRC"))
    }

    /// `getVrchatOscPresence`: "found", "not_found", or "unknown" when this PC cannot tell.
    fn vrchat_presence(&self) -> Value {
        let presence = self.osc().and_then(|osc| osc.vrchat_presence());
        json!(match presence {
            Some(true) => "found",
            Some(false) => "not_found",
            None => "unknown",
        })
    }

    // ---------------------------------------------------------------- receive and readiness

    /// `_initOscReceive`, on its own thread during start-up.
    pub(super) fn init_osc_receive(self: Arc<Self>) {
        {
            let _control = self.osc_control.lock().unwrap();
            let started = match self.osc() {
                Some(osc) if !self.shutting_down() => {
                    self.with_mute(|state| {
                        state.generation += 1;
                        state.admitted = true;
                    });
                    osc.receive(self.targets())
                }
                Some(_) => Err(OscError::ShutDown),
                None => Err(OscError::Io(std::io::ErrorKind::NotConnected)),
            };
            if started.is_err() {
                self.step("OSC: receive/advertisement setup failed");
            }
            self.publish_osc_readiness(true);
        }
        if self.osc().is_some_and(|osc| osc.query_enabled()) {
            // `_initVrcMicMuteSync`: a saved sync starts held back until VRChat answers.
            let generation = self.with_mute(|state| self.config.get_bool("VRC_MIC_MUTE_SYNC").then(|| self.invalidate(state)));
            if let Some(generation) = generation {
                self.query_mute_now(generation);
            }
        }
    }

    /// The saved destination could not be opened at start-up: the UI hears it on the
    /// destination's endpoint with the address now in use (or still saved, when even this PC
    /// could not be opened), as a refused change would tell it.
    pub(super) fn notify_osc_startup(&self) {
        if self.osc_unopened.swap(false, std::sync::atomic::Ordering::SeqCst) {
            let body = crate::errors::ErrorReply::new("VALIDATION_CANNOT_SET_IP", self.config.get("OSC_IP_ADDRESS")).into_body();
            self.run(400, "/set/data/osc_ip_address", body);
        }
    }

    /// `_publishOscQueryReadiness`: tells the UI whether receiving and OSCQuery run. When they do
    /// not and mute sync was on, the microphone's recognition is turned off first and then sync,
    /// so losing sync never lets a private microphone through.
    pub(super) fn publish_osc_readiness(&self, startup: bool) {
        if self.shutting_down() {
            return;
        }
        if self.osc().is_some_and(|osc| osc.query_enabled()) {
            self.run(200, "/run/enable_osc_query", json!({ "data": true, "disabled_functions": [] }));
            return;
        }
        let remote = !uses_osc_query(&self.config.get_str("OSC_IP_ADDRESS"));
        // Sending to another machine is a choice made in the settings: at start-up, with nothing
        // stopped, the UI gets no warning to show.
        let (warn, stopped) = self.with_mute(|state| {
            if self.config.get_bool("VRC_MIC_MUTE_SYNC") {
                self.invalidate(state);
                (self.services.stop_mic_transcription)();
                self.run(200, "/set/disable/transcription_send", json!(false));
                let _ = self.config.set("VRC_MIC_MUTE_SYNC", json!(false));
                self.invalidate(state);
                self.run(200, "/set/disable/vrc_mic_mute_sync", json!(false));
                (true, true)
            } else {
                (!(startup && remote), false)
            }
        });
        let disabled: Vec<&str> = if warn { vec!["vrc_mic_mute_sync"] } else { Vec::new() };
        self.run(
            200,
            "/run/enable_osc_query",
            json!({
                "data": false,
                "disabled_functions": disabled,
                "reason": if remote { "remote_destination" } else { "setup_failed" },
                "microphone_stopped": stopped,
            }),
        );
    }

    /// What VRChat sends that mute sync listens to.
    fn targets(self: &Arc<Self>) -> Vec<(String, Target)> {
        let mute: Weak<Self> = Arc::downgrade(self);
        let avatar = mute.clone();
        vec![
            (
                PARAMETER_MUTE_SELF.to_string(),
                Arc::new(move |_address: &str, args: &[OscArg]| {
                    if let Some(adapters) = mute.upgrade() {
                        adapters.on_mute_self(args.first());
                    }
                }),
            ),
            (
                AVATAR_CHANGE.to_string(),
                Arc::new(move |_address: &str, _args: &[OscArg]| {
                    if let Some(adapters) = avatar.upgrade() {
                        adapters.on_avatar_change();
                    }
                }),
            ),
        ]
    }

    /// Closes admission and tells OSC to refuse everything, without waiting (`requestOSCShutdown`).
    pub(super) fn request_osc_stop(&self) {
        self.osc_shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
        self.with_mute(|state| {
            state.admitted = false;
            state.generation += 1;
            state.pending = None;
        });
        if let Some(osc) = self.osc() {
            osc.request_stop();
        }
    }

    pub(super) fn stop_osc(&self) {
        if self.osc().is_some_and(|osc| osc.stop().is_err()) {
            self.step("OSC: receive did not stop cleanly");
        }
    }

    // ---------------------------------------------------------------- mic mute sync

    fn enable_mute_sync(self: &Arc<Self>) -> Reply {
        let step = {
            let _control = self.osc_control.lock().unwrap();
            // Setting up receiving may wait on the network: ask before taking the mic lock.
            let ready = self.osc().is_some_and(|osc| osc.query_enabled());
            self.with_mute(|state| {
                if !ready {
                    return Err(error("VRC_MIC_MUTE_SYNC_OSC_DISABLED", self.config.get("VRC_MIC_MUTE_SYNC")));
                }
                if self.config.get_bool("VRC_MIC_MUTE_SYNC") {
                    return Ok(None);
                }
                let _ = self.config.set("VRC_MIC_MUTE_SYNC", json!(true));
                Ok(Some(self.invalidate(state)))
            })
        };
        match step {
            Err(reply) => reply,
            Ok(None) => ok_true(),
            Ok(Some(generation)) => {
                // The query waits outside both locks and applies only if sync is still wanted.
                self.query_mute_now(generation);
                ok(self.config.get("VRC_MIC_MUTE_SYNC"))
            }
        }
    }

    fn disable_mute_sync(&self) -> Reply {
        self.with_mute(|state| {
            if self.config.get_bool("VRC_MIC_MUTE_SYNC") {
                let _ = self.config.set("VRC_MIC_MUTE_SYNC", json!(false));
                self.invalidate(state);
            }
        });
        ok(self.config.get("VRC_MIC_MUTE_SYNC"))
    }

    /// Runs `f` under the mic lock and tells the recognition whether VRChat holds the
    /// microphone back, the first time and whenever that changes (`changeMicTranscriptStatus`).
    fn with_mute<R>(&self, f: impl FnOnce(&mut MuteState) -> R) -> R {
        let mut state = self.mute.lock().unwrap();
        let result = f(&mut state);
        let held = self.held_back(&state);
        if state.reported != Some(held) {
            state.reported = Some(held);
            (self.services.vrc_mic_mute)(held);
        }
        result
    }

    /// Whether mic mute sync holds the microphone's messages back now (the message pipeline).
    pub(crate) fn mic_held_back(&self) -> bool {
        let state = self.mute.lock().unwrap();
        self.held_back(&state)
    }

    /// Sends chatbox text with the notification sound as set (`model.oscSendMessage`). `false`
    /// when `current` said no or nothing could be opened.
    pub(crate) fn send_chatbox(&self, text: &str, current: &dyn Fn() -> bool) -> std::io::Result<bool> {
        if self.shutting_down() {
            return Ok(false);
        }
        let Some(osc) = self.osc() else { return Ok(false) };
        osc.send_message(text, self.config.get_bool("NOTIFICATION_VRC_SFX"), Some(current))
    }

    fn held_back(&self, state: &MuteState) -> bool {
        self.config.get_bool("VRC_MIC_MUTE_SYNC") && state.muted != Some(false)
    }

    /// Whether a query or a message for `generation` may still change the state.
    fn current(&self, state: &MuteState, generation: u64) -> bool {
        state.admitted && !self.shutting_down() && self.config.get_bool("VRC_MIC_MUTE_SYNC") && generation == state.generation
    }

    /// `invalidateMuteSelfStatus`: a query in flight no longer counts, and with sync on the
    /// microphone is held back until VRChat answers again.
    fn invalidate(&self, state: &mut MuteState) -> u64 {
        state.generation += 1;
        state.pending = None;
        if self.config.get_bool("VRC_MIC_MUTE_SYNC") {
            state.muted = Some(true);
        }
        state.generation
    }

    /// Unknown, a timeout and anything but a real `false` hold the microphone back.
    fn apply(state: &mut MuteState, mute: Option<bool>) {
        state.muted = Some(mute != Some(false));
    }

    /// `setMuteSelfStatus(generation)`: asks OSCQuery now and applies the answer if it still counts.
    fn query_mute_now(&self, generation: u64) {
        if !self.with_mute(|state| self.current(state, generation)) {
            return;
        }
        let mute = self.osc().and_then(|osc| osc.mute_self());
        self.with_mute(|state| {
            if self.current(state, generation) {
                Self::apply(state, mute);
            }
        });
    }

    /// `MuteSelf` from VRChat. A `true` holds the microphone back at once; a `false` is checked
    /// with OSCQuery first, so a forged packet cannot open the microphone. Never waits.
    fn on_mute_self(self: &Arc<Self>, value: Option<&OscArg>) {
        self.with_mute(|state| {
            if !self.current(state, state.generation) {
                return;
            }
            match value {
                Some(OscArg::Bool(true)) => {
                    state.generation += 1;
                    state.pending = None;
                    Self::apply(state, Some(true));
                }
                Some(OscArg::Bool(false)) if state.muted != Some(false) => self.request_query(state),
                _ => {}
            }
        });
    }

    /// An avatar loaded: hold back and ask again (VRChat resends its parameters then).
    fn on_avatar_change(self: &Arc<Self>) {
        self.with_mute(|state| {
            if !self.current(state, state.generation) {
                return;
            }
            state.generation += 1;
            Self::apply(state, Some(true));
            self.request_query(state);
        });
    }

    /// One running query and one latest request (`_requestMuteQueryLocked`).
    fn request_query(self: &Arc<Self>, state: &mut MuteState) {
        if !self.current(state, state.generation) {
            return;
        }
        state.pending = Some(state.generation);
        if state.querying {
            return;
        }
        state.querying = true;
        let adapters = Arc::clone(self);
        let generation = state.generation;
        let spawned = std::thread::Builder::new().name("osc_avatar_query".into()).spawn(move || adapters.run_queries(generation));
        if spawned.is_err() {
            state.querying = false;
            state.pending = None;
        }
    }

    fn run_queries(&self, mut generation: u64) {
        loop {
            if self.with_mute(|state| self.current(state, generation)) {
                let mute = self.osc().and_then(|osc| osc.mute_self());
                self.with_mute(|state| {
                    if self.current(state, generation) {
                        if mute != Some(false) {
                            self.step("OSC: unmute not confirmed by OSCQuery; keeping microphone muted");
                        }
                        Self::apply(state, mute);
                    }
                });
            }
            let next = self.with_mute(|state| match state.pending {
                Some(pending) if pending != generation && self.current(state, pending) => Some(pending),
                _ => {
                    state.pending = None;
                    state.querying = false;
                    None
                }
            });
            match next {
                Some(pending) => generation = pending,
                None => return,
            }
        }
    }
}
