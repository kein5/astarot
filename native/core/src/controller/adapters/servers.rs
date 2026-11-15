//! The WebSocket server and the OBS browser source (`setWebSocketHost`, `setWebSocketPort`,
//! `setWebSocketTls`, `setEnableObsBrowserSource`, ... in `controller.py`, and
//! `startWebSocketServer` and `startObsBrowserSourceServer` in `model.py`).
//!
//! - Both servers listen on `WEBSOCKET_HOST`. A loopback IPv4 address needs nothing more; any
//!   other needs the user's certificate, without which nothing listens there.
//! - The OBS page gets its messages through the WebSocket server, so turning OBS on starts the
//!   WebSocket server too, and turning the WebSocket server off turns OBS off.
//! - A setting changes only once the servers listen on the new value. When they cannot, they
//!   are started again on the saved one; when even that fails they are shown as off.
//! - An error answer carries the saved value as `data`, for the UI to roll back to.

use super::{Adapters, port_of};
use crate::config::schema::{is_valid_port, is_valid_websocket_host};
use crate::controller::routes::{Builder, OPEN};
use crate::controller::settings::python_str;
use crate::controller::{error, ok};
use crate::errors::ErrorReply;
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;
use vrct_adapters::obs::settings::{NumericSetting, RawNumeric, parse_numeric_setting};
use vrct_adapters::obs::{ObsBrowserSourceServer, ObsPageSettings};
use vrct_adapters::tls;
use vrct_adapters::websocket::WebSocketServer;

/// How long a WebSocket start may take before it is given up (`_WEBSOCKET_START_TIMEOUT`).
const WEBSOCKET_START_TIMEOUT: Duration = Duration::from_secs(6);

/// The OBS server with the address it was asked to listen on.
pub(crate) struct ObsSlot {
    host: String,
    port: u16,
    server: Arc<ObsBrowserSourceServer>,
}

/// What the start-up tells the UI after `initialization_complete`.
#[derive(Default)]
pub(crate) struct StartupNotices {
    obs_error: Option<&'static str>,
    host_reset: bool,
}

/// The OBS numeric settings: endpoint, key, error code and the message of the error.
const NUMERIC: [(&str, &str, NumericSetting, &str, &str); 5] = [
    (
        "max_messages",
        "OBS_BROWSER_SOURCE_MAX_MESSAGES",
        NumericSetting::MaxMessages,
        "OBS_BROWSER_SOURCE_MAX_MESSAGES_INVALID",
        "Enter a whole number from 1 to 50",
    ),
    (
        "display_duration",
        "OBS_BROWSER_SOURCE_DISPLAY_DURATION",
        NumericSetting::DisplayDuration,
        "OBS_BROWSER_SOURCE_DISPLAY_DURATION_INVALID",
        "Enter a whole number from 1 to 120",
    ),
    (
        "fadeout_duration",
        "OBS_BROWSER_SOURCE_FADEOUT_DURATION",
        NumericSetting::FadeoutDuration,
        "OBS_BROWSER_SOURCE_FADEOUT_DURATION_INVALID",
        "Enter a whole number from 0 to 120",
    ),
    (
        "font_size",
        "OBS_BROWSER_SOURCE_FONT_SIZE",
        NumericSetting::FontSize,
        "OBS_BROWSER_SOURCE_FONT_SIZE_INVALID",
        "Enter a whole number from 10 to 200",
    ),
    (
        "font_outline_thickness",
        "OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS",
        NumericSetting::FontOutlineThickness,
        "OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS_INVALID",
        "Enter a whole number from 0 to 20",
    ),
];

pub(super) fn add(b: &mut Builder<'_>) {
    use super::osc::with;
    b.with("/set/data/websocket_host", OPEN, |core, data| with(core, |a| a.set_websocket_host(data)));
    b.with("/set/data/websocket_port", OPEN, |core, data| with(core, |a| a.set_websocket_port(data)));
    b.with("/run/regenerate_websocket_auth_token", OPEN, |core, _| with(core, |a| a.regenerate_token()));
    b.with("/set/data/websocket_tls", OPEN, |core, data| with(core, |a| a.set_websocket_tls(data)));
    b.with("/set/enable/websocket_server", OPEN, |core, _| with(core, |a| a.enable_websocket_server()));
    b.with("/set/disable/websocket_server", OPEN, |core, _| with(core, |a| a.disable_websocket_server()));
    b.with("/set/enable/obs_browser_source", OPEN, |core, _| with(core, |a| a.enable_obs()));
    b.with("/set/disable/obs_browser_source", OPEN, |core, _| with(core, |a| a.disable_obs()));
    b.with("/set/data/obs_browser_source_port", OPEN, |core, data| with(core, |a| a.set_obs_port(data)));
    for (name, key, setting, code, message) in NUMERIC {
        b.with(&format!("/set/data/obs_browser_source_{name}"), OPEN, move |core, data| {
            with(core, |a| a.set_obs_number(key, setting, code, message, data))
        });
    }
    b.with("/set/data/obs_browser_source_font_color", OPEN, |core, data| {
        with(core, |a| a.set_obs_color("OBS_BROWSER_SOURCE_FONT_COLOR", "OBS_BROWSER_SOURCE_FONT_COLOR_INVALID", data))
    });
    b.with("/set/data/obs_browser_source_font_outline_color", OPEN, |core, data| {
        with(core, |a| {
            a.set_obs_color("OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR", "OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR_INVALID", data)
        })
    });
}

/// `isAvailableWebSocketServer`: a valid address and port that can be bound right now.
fn available(host: &str, port: &Value) -> bool {
    if !is_valid_websocket_host(&json!(host)) || !is_valid_port(port) {
        return false;
    }
    TcpListener::bind((host, port_of(port))).is_ok()
}

/// `^#[0-9a-fA-F]{6}$` after `str(data).strip()`.
fn hex_color(data: &Value) -> Option<String> {
    let text = python_str(data);
    let color = text.trim();
    let valid = color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|b| b.is_ascii_hexdigit());
    valid.then(|| color.to_ascii_uppercase())
}

impl Adapters {
    fn host(&self) -> String {
        self.config.get_str("WEBSOCKET_HOST")
    }

    fn tls_files(&self) -> (String, String) {
        (self.config.get_str("WEBSOCKET_TLS_CERT_FILE"), self.config.get_str("WEBSOCKET_TLS_KEY_FILE"))
    }

    fn tls_files_value(&self) -> Value {
        let (cert_file, key_file) = self.tls_files();
        json!({ "cert_file": cert_file, "key_file": key_file })
    }

    /// `_tlsReadyFor`: loopback, or a certificate that loads.
    fn tls_ready_for(&self, host: &str) -> bool {
        let (cert, key) = self.tls_files();
        tls::listener_config(host, &cert, &key).is_ok()
    }

    // ---------------------------------------------------------------- the servers

    /// `startWebSocketServer`: true only once this attempt listens; a failed attempt is reaped.
    fn start_websocket(&self, host: &str, port: &Value, files: Option<&(String, String)>) -> bool {
        let (cert, key) = files.cloned().unwrap_or_else(|| self.tls_files());
        let Ok(config) = tls::listener_config(host, &cert, &key) else {
            self.step("Network listener refused: no usable TLS certificate for a non-loopback address");
            return false;
        };
        let Ok(port) = u16::try_from(port.as_u64().unwrap_or(0)) else { return false };
        let (server, run) = {
            let mut slot = self.websocket.lock().unwrap();
            let server = match slot.as_ref() {
                Some(server) if !server.is_stopped() => Arc::clone(server),
                _ => {
                    let token = self.config.get_str("WEBSOCKET_AUTH_TOKEN");
                    // No message handler: the app only pushes, and what clients send is dropped
                    // within the incoming limits.
                    let server = Arc::new(WebSocketServer::new(host, port, Some(token), config));
                    *slot = Some(Arc::clone(&server));
                    server
                }
            };
            match server.begin_start(WEBSOCKET_START_TIMEOUT) {
                Ok(run) => (server, run),
                Err(_) => return false,
            }
        };
        if server.wait_started(&run).is_err() {
            self.step("WebSocket server could not start");
            let mut slot = self.websocket.lock().unwrap();
            if slot.as_ref().is_some_and(|current| Arc::ptr_eq(current, &server) && current.is_stopped()) {
                *slot = None;
            }
            return false;
        }
        let slot = self.websocket.lock().unwrap();
        slot.as_ref().is_some_and(|current| Arc::ptr_eq(current, &server)) && server.is_running()
    }

    /// `stopWebSocketServer`: also cancels a start still binding.
    pub(super) fn stop_websocket(&self) {
        let mut slot = self.websocket.lock().unwrap();
        let Some(server) = slot.as_ref() else { return };
        server.stop();
        if server.is_stopped() {
            *slot = None;
        } else {
            // Keep it so that nothing else binds while it lets go; a later start retries.
            self.step("WebSocket server thread did not terminate properly");
        }
    }

    fn websocket_alive(&self) -> bool {
        self.websocket.lock().unwrap().as_ref().is_some_and(|server| server.is_running())
    }

    /// `startObsBrowserSourceServer`: true only when OBS listens on the requested address.
    fn start_obs(&self, host: &str, port: &Value, files: Option<&(String, String)>) -> bool {
        let (cert, key) = files.cloned().unwrap_or_else(|| self.tls_files());
        let Ok(config) = tls::listener_config(host, &cert, &key) else {
            self.step("Network listener refused: no usable TLS certificate for a non-loopback address");
            return false;
        };
        let Ok(port) = u16::try_from(port.as_u64().unwrap_or(0)) else { return false };
        let mut slot = self.obs.lock().unwrap();
        if slot.as_ref().is_some_and(|obs| obs.server.is_running() && obs.host == host && obs.port == port) {
            return true;
        }
        self.stop_obs_locked(&mut slot);
        if slot.is_some() {
            // The previous server still owns its workers.
            return false;
        }
        let token = self.config.get_str("WEBSOCKET_AUTH_TOKEN");
        let settings = Arc::clone(&self.config);
        let server = Arc::new(ObsBrowserSourceServer::new(host, port, &token, config, move || page_settings(&settings)));
        *slot = Some(ObsSlot { host: host.to_string(), port, server: Arc::clone(&server) });
        match server.start() {
            Ok(()) => server.is_running(),
            Err(_) => {
                self.step("OBS browser source server could not listen");
                self.stop_obs_locked(&mut slot);
                false
            }
        }
    }

    pub(super) fn stop_obs(&self) {
        let mut slot = self.obs.lock().unwrap();
        self.stop_obs_locked(&mut slot);
    }

    fn stop_obs_locked(&self, slot: &mut Option<ObsSlot>) {
        let Some(obs) = slot.as_ref() else { return };
        obs.server.stop();
        if obs.server.is_stopped() {
            *slot = None;
        }
    }

    fn obs_alive(&self) -> bool {
        self.obs.lock().unwrap().as_ref().is_some_and(|obs| obs.server.is_running())
    }

    /// `_restoreWebSocketServer`: back on the saved address, or shown as off (with OBS) when
    /// another program took it in the meantime.
    fn restore_websocket(&self, restore_obs: bool) {
        if self.start_websocket(&self.host(), &self.config.get("WEBSOCKET_PORT"), None) {
            if restore_obs {
                self.restore_obs();
            }
            return;
        }
        self.step("WebSocket server could not be restored on its previous address");
        if self.config.get_bool("OBS_BROWSER_SOURCE") {
            let _ = self.config.set("OBS_BROWSER_SOURCE", json!(false));
            self.stop_obs();
        }
        let _ = self.config.set("WEBSOCKET_SERVER", json!(false));
    }

    /// `_restoreObsBrowserSourceServer`.
    fn restore_obs(&self) {
        if !self.start_obs(&self.host(), &self.config.get("OBS_BROWSER_SOURCE_PORT"), None) {
            self.stop_obs();
            let _ = self.config.set("OBS_BROWSER_SOURCE", json!(false));
        }
    }

    // ---------------------------------------------------------------- start-up

    /// The WebSocket and OBS part of `Controller.init`.
    pub(super) fn start_servers(&self) {
        let mut notices = StartupNotices::default();
        // `_resetWebSocketHostWithoutTls`: a host beyond this PC without a usable certificate
        // goes back to this PC; the UI is told after the start.
        if !self.tls_ready_for(&self.host()) {
            let _ = self.config.set("WEBSOCKET_HOST", json!("127.0.0.1"));
            self.step("WebSocket host moved back to 127.0.0.1: listening beyond this PC needs a TLS certificate");
            notices.host_reset = true;
        }
        // The OBS page receives its messages through the WebSocket server.
        if self.config.get_bool("OBS_BROWSER_SOURCE") && !self.config.get_bool("WEBSOCKET_SERVER") {
            let _ = self.config.set("WEBSOCKET_SERVER", json!(true));
        }
        let host = self.host();
        if self.config.get_bool("WEBSOCKET_SERVER") {
            let port = self.config.get("WEBSOCKET_PORT");
            if !(available(&host, &port) && self.start_websocket(&host, &port, None)) {
                let _ = self.config.set("WEBSOCKET_SERVER", json!(false));
                self.stop_websocket();
                self.step("WebSocket server host or port is not available");
            }
        }
        self.step("Init OBS Browser Source Server");
        if self.config.get_bool("OBS_BROWSER_SOURCE") {
            if !self.config.get_bool("WEBSOCKET_SERVER") {
                let _ = self.config.set("OBS_BROWSER_SOURCE", json!(false));
                self.stop_obs();
                self.step("OBS Browser Source requires WebSocket Server");
            } else {
                let port = self.config.get("OBS_BROWSER_SOURCE_PORT");
                if !available(&host, &port) {
                    notices.obs_error = Some("OBS_BROWSER_SOURCE_PORT_UNAVAILABLE");
                } else if !self.start_obs(&host, &port, None) {
                    notices.obs_error = Some("OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE");
                }
                if notices.obs_error.is_some() {
                    let _ = self.config.set("OBS_BROWSER_SOURCE", json!(false));
                    self.stop_obs();
                    self.step("OBS Browser Source server could not start");
                }
            }
        }
        *self.startup.lock().unwrap() = notices;
    }

    pub(super) fn notify_startup(&self) {
        let notices = std::mem::take(&mut *self.startup.lock().unwrap());
        if let Some(code) = notices.obs_error {
            self.run(400, "/set/enable/obs_browser_source", ErrorReply::new(code, json!(false)).into_body());
        }
        if notices.host_reset {
            let body = ErrorReply::new("WEBSOCKET_HOST_RESET_WITHOUT_TLS", self.config.get("WEBSOCKET_HOST")).into_body();
            self.run(400, "/set/data/websocket_host", body);
        }
    }

    // ---------------------------------------------------------------- WebSocket endpoints

    fn set_websocket_host(&self, data: &Value) -> Reply {
        let current = || self.config.get("WEBSOCKET_HOST");
        // 0.0.0.0 would listen on every interface, a LAN the user may not know of included.
        if !is_valid_websocket_host(data) {
            return error("VALIDATION_INVALID_IP", current());
        }
        let host = data.as_str().unwrap_or_default();
        if !self.tls_ready_for(host) {
            // Beyond this PC only over TLS: the certificate comes first.
            return error("WEBSOCKET_HOST_NEEDS_TLS", current());
        }
        if !self.websocket_alive() {
            // Also cancels a start still binding the previous address.
            self.stop_websocket();
            let _ = self.config.set("WEBSOCKET_HOST", json!(host));
            return ok(current());
        }
        if host == self.host() {
            return ok(current());
        }
        let port = self.config.get("WEBSOCKET_PORT");
        if !available(host, &port) {
            return error("WEBSOCKET_HOST_INVALID", current());
        }
        self.stop_websocket();
        if !self.start_websocket(host, &port, None) {
            self.restore_websocket(false);
            return error("WEBSOCKET_HOST_INVALID", current());
        }
        // The OBS page must be served from the host the WebSocket server now listens on.
        if self.config.get_bool("OBS_BROWSER_SOURCE") {
            self.stop_obs();
            if !self.start_obs(host, &self.config.get("OBS_BROWSER_SOURCE_PORT"), None) {
                self.stop_obs();
                self.stop_websocket();
                self.restore_websocket(true);
                return error("OBS_BROWSER_SOURCE_HOST_UNAVAILABLE", current());
            }
        }
        // Saved only once both listen; the rollback above used the saved address.
        let _ = self.config.set("WEBSOCKET_HOST", json!(host));
        ok(current())
    }

    fn set_websocket_port(&self, data: &Value) -> Reply {
        let current = || self.config.get("WEBSOCKET_PORT");
        if !is_valid_port(data) {
            return error("WEBSOCKET_PORT_INVALID", current());
        }
        if !self.websocket_alive() {
            self.stop_websocket();
            let _ = self.config.set("WEBSOCKET_PORT", data.clone());
            return ok(current());
        }
        if *data == current() {
            return ok(current());
        }
        let host = self.host();
        if !available(&host, data) {
            return error("WEBSOCKET_PORT_UNAVAILABLE", current());
        }
        self.stop_websocket();
        if !self.start_websocket(&host, data, None) {
            self.restore_websocket(false);
            return error("WEBSOCKET_PORT_UNAVAILABLE", current());
        }
        let _ = self.config.set("WEBSOCKET_PORT", data.clone());
        ok(current())
    }

    /// A new token: a leaked URL stops working at once. Connections made with the old token are
    /// closed and the OBS page refuses it. The answer is masked in the log.
    fn regenerate_token(&self) -> Reply {
        let token = crate::config::new_token();
        let _ = self.config.set("WEBSOCKET_AUTH_TOKEN", json!(token));
        if let Some(server) = self.websocket.lock().unwrap().as_ref() {
            let _ = server.set_token(&token);
        }
        if let Some(obs) = self.obs.lock().unwrap().as_ref() {
            let _ = obs.server.set_token(&token);
        }
        self.step("WebSocket token replaced; connections with the old token were closed");
        ok(self.config.get("WEBSOCKET_AUTH_TOKEN"))
    }

    /// `setWebSocketTls`: `{"cert_file", "key_file"}`, saved only when the pair loads. Both empty
    /// clears them, except while the host is beyond this PC. Servers already listening there
    /// restart with the new pair first and go back to the old one on failure.
    fn set_websocket_tls(&self, data: &Value) -> Reply {
        let current = self.tls_files_value();
        let pair = data.as_object().filter(|object| {
            object.len() == 2 && ["cert_file", "key_file"].iter().all(|name| object.get(*name).is_some_and(Value::is_string))
        });
        let Some(pair) = pair else {
            return error("WEBSOCKET_TLS_INVALID", current);
        };
        let files = (
            pair["cert_file"].as_str().unwrap_or_default().trim().to_string(),
            pair["key_file"].as_str().unwrap_or_default().trim().to_string(),
        );
        let host = self.host();
        if files.0.is_empty() && files.1.is_empty() {
            if tls::requires_tls(&host) {
                return error("WEBSOCKET_HOST_NEEDS_TLS", current);
            }
        } else if tls::server_config(&files.0, &files.1).is_err() {
            self.step("WebSocket TLS certificate refused");
            return error("WEBSOCKET_TLS_INVALID", current);
        }
        if json!({ "cert_file": files.0, "key_file": files.1 }) == current {
            return ok(current);
        }
        if tls::requires_tls(&host) && self.websocket_alive() {
            let restart_obs = self.config.get_bool("OBS_BROWSER_SOURCE");
            if restart_obs {
                self.stop_obs();
            }
            self.stop_websocket();
            let mut started = self.start_websocket(&host, &self.config.get("WEBSOCKET_PORT"), Some(&files));
            if started && restart_obs {
                started = self.start_obs(&host, &self.config.get("OBS_BROWSER_SOURCE_PORT"), Some(&files));
            }
            if !started {
                self.stop_obs();
                self.stop_websocket();
                self.restore_websocket(restart_obs);
                return error("WEBSOCKET_SERVER_UNAVAILABLE", current);
            }
        }
        let _ = self.config.set("WEBSOCKET_TLS_CERT_FILE", json!(files.0));
        let _ = self.config.set("WEBSOCKET_TLS_KEY_FILE", json!(files.1));
        ok(self.tls_files_value())
    }

    fn enable_websocket_server(&self) -> Reply {
        if self.config.get_bool("WEBSOCKET_SERVER") {
            return ok(self.config.get("WEBSOCKET_SERVER"));
        }
        let (host, port) = (self.host(), self.config.get("WEBSOCKET_PORT"));
        if available(&host, &port) && self.start_websocket(&host, &port, None) {
            let _ = self.config.set("WEBSOCKET_SERVER", json!(true));
            return ok(self.config.get("WEBSOCKET_SERVER"));
        }
        error("WEBSOCKET_SERVER_UNAVAILABLE", self.config.get("WEBSOCKET_SERVER"))
    }

    fn disable_websocket_server(&self) -> Reply {
        if self.config.get_bool("WEBSOCKET_SERVER") {
            // The OBS page would stay "on" while nothing reaches it.
            if self.config.get_bool("OBS_BROWSER_SOURCE") {
                let _ = self.config.set("OBS_BROWSER_SOURCE", json!(false));
                self.stop_obs();
            }
            let _ = self.config.set("WEBSOCKET_SERVER", json!(false));
        }
        // Also reaches a start still under way.
        self.stop_websocket();
        ok(self.config.get("WEBSOCKET_SERVER"))
    }

    // ---------------------------------------------------------------- OBS endpoints

    /// Turning OBS on starts the WebSocket server when it is off. On failure only what this
    /// request started is stopped; a WebSocket server that already ran keeps running.
    fn enable_obs(&self) -> Reply {
        if self.config.get_bool("OBS_BROWSER_SOURCE") {
            return ok(self.config.get("OBS_BROWSER_SOURCE"));
        }
        let mut started_websocket = false;
        let mut obs_attempted = false;
        let reply = (|| {
            let host = self.host();
            if !self.websocket_alive() {
                let port = self.config.get("WEBSOCKET_PORT");
                if !available(&host, &port) || !self.start_websocket(&host, &port, None) {
                    return error("WEBSOCKET_SERVER_UNAVAILABLE", self.config.get("OBS_BROWSER_SOURCE"));
                }
                started_websocket = true;
            }
            let port = self.config.get("OBS_BROWSER_SOURCE_PORT");
            if !available(&host, &port) {
                return error("OBS_BROWSER_SOURCE_PORT_UNAVAILABLE", self.config.get("OBS_BROWSER_SOURCE"));
            }
            obs_attempted = true;
            if !self.start_obs(&host, &port, None) {
                return error("OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE", self.config.get("OBS_BROWSER_SOURCE"));
            }
            let _ = self.config.set("WEBSOCKET_SERVER", json!(true));
            let _ = self.config.set("OBS_BROWSER_SOURCE", json!(true));
            ok(self.config.get("OBS_BROWSER_SOURCE"))
        })();
        if !self.config.get_bool("OBS_BROWSER_SOURCE") {
            if obs_attempted {
                self.stop_obs();
            }
            if started_websocket {
                self.stop_websocket();
                let _ = self.config.set("WEBSOCKET_SERVER", json!(false));
            }
        }
        reply
    }

    fn disable_obs(&self) -> Reply {
        if self.config.get_bool("OBS_BROWSER_SOURCE") {
            let _ = self.config.set("OBS_BROWSER_SOURCE", json!(false));
            self.stop_obs();
        }
        ok(self.config.get("OBS_BROWSER_SOURCE"))
    }

    fn set_obs_port(&self, data: &Value) -> Reply {
        let current = || self.config.get("OBS_BROWSER_SOURCE_PORT");
        if !is_valid_port(data) {
            return error("OBS_BROWSER_SOURCE_PORT_INVALID", current());
        }
        if !self.obs_alive() {
            let _ = self.config.set("OBS_BROWSER_SOURCE_PORT", data.clone());
            return ok(current());
        }
        if *data == current() {
            return ok(current());
        }
        let host = self.host();
        if !available(&host, data) {
            return error("OBS_BROWSER_SOURCE_PORT_UNAVAILABLE", current());
        }
        self.stop_obs();
        if !self.start_obs(&host, data, None) {
            self.stop_obs();
            self.restore_obs();
            return error("OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE", current());
        }
        let _ = self.config.set("OBS_BROWSER_SOURCE_PORT", data.clone());
        ok(current())
    }

    /// A whole number in its range, or a decimal string of one (the text controls send those).
    fn set_obs_number(&self, key: &str, setting: NumericSetting, code: &'static str, message: &str, data: &Value) -> Reply {
        let raw = match data {
            Value::Number(n) if n.is_i64() => n.as_i64().map(RawNumeric::Int),
            Value::String(text) => Some(RawNumeric::Text(text)),
            _ => None,
        };
        let parsed = raw.and_then(|raw| parse_numeric_setting(setting, raw).ok());
        let stored = parsed.and_then(|value| self.config.set(key, json!(value)).ok());
        if stored.is_none() {
            return Reply::error(ErrorReply::new(code, self.config.get(key)).message(message));
        }
        self.push_obs_settings();
        ok(self.config.get(key))
    }

    fn set_obs_color(&self, key: &str, code: &'static str, data: &Value) -> Reply {
        let stored = hex_color(data).and_then(|color| self.config.set(key, json!(color)).ok());
        if stored.is_none() {
            return error(code, self.config.get(key));
        }
        self.push_obs_settings();
        ok(self.config.get(key))
    }

    /// `_pushObsBrowserSourceSettings`: open OBS pages apply new display settings at once (OBS
    /// keeps the page and would not load it again).
    fn push_obs_settings(&self) {
        if !self.config.get_bool("OBS_BROWSER_SOURCE") || !self.websocket_alive() {
            return;
        }
        let c = &self.config;
        let message = json!({
            "type": "SETTINGS_UPDATED",
            "settings": {
                "maxMessages": c.get("OBS_BROWSER_SOURCE_MAX_MESSAGES"),
                "displayDuration": c.get("OBS_BROWSER_SOURCE_DISPLAY_DURATION"),
                "fadeoutDuration": c.get("OBS_BROWSER_SOURCE_FADEOUT_DURATION"),
                "fontSize": c.get("OBS_BROWSER_SOURCE_FONT_SIZE"),
                "fontColor": c.get("OBS_BROWSER_SOURCE_FONT_COLOR"),
                "outlineThickness": c.get("OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS"),
                "outlineColor": c.get("OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR"),
            },
        });
        let sent = self.websocket.lock().unwrap().as_ref().map(|server| server.send(&message.to_string()));
        if matches!(sent, Some(Err(_))) {
            self.step("OBS settings could not be pushed to the open pages");
        }
    }
}

/// The page's values, read from the settings for each request.
fn page_settings(config: &crate::config::Config) -> ObsPageSettings {
    let fallback = ObsPageSettings::default();
    let number = |key: &str, fallback: i64| config.get(key).as_i64().unwrap_or(fallback);
    ObsPageSettings {
        websocket_port: number("WEBSOCKET_PORT", fallback.websocket_port),
        max_messages: number("OBS_BROWSER_SOURCE_MAX_MESSAGES", fallback.max_messages),
        display_duration: number("OBS_BROWSER_SOURCE_DISPLAY_DURATION", fallback.display_duration),
        fadeout_duration: number("OBS_BROWSER_SOURCE_FADEOUT_DURATION", fallback.fadeout_duration),
        font_size: number("OBS_BROWSER_SOURCE_FONT_SIZE", fallback.font_size),
        font_color: config.get("OBS_BROWSER_SOURCE_FONT_COLOR").as_str().map_or(fallback.font_color, str::to_string),
        font_outline_thickness: number("OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS", fallback.font_outline_thickness),
        font_outline_color: config
            .get("OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR")
            .as_str()
            .map_or(fallback.font_outline_color, str::to_string),
    }
}
