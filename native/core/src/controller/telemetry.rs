//! The usage events: the switch, the notice and what is sent (`controller.py`:
//! `setEnableTelemetry`, `setDisableTelemetry`, `getTelemetryNotice`, `setTelemetryNotice`,
//! `getTelemetryPreview`; `vrct_ops::telemetry`).
//!
//! Nothing is sent before the user has answered the notice: turning the setting on is not
//! consent (SEC-07), and only the answer can start sending for the first time.
//! `VRCT_TELEMETRY=off` turns it off for good and the notice is not asked either.

use super::routes::{Builder, OPEN};
use super::{Core, ok};
use crate::protocol::Reply;
use serde_json::{Value, json};
use std::path::PathBuf;

/// The notice a user answers once before any usage event is sent. Raise it when what is sent
/// changes, so that everyone is told again (`TELEMETRY_NOTICE_VERSION`).
pub const NOTICE_VERSION: i64 = 1;

/// `VRCT_TELEMETRY=off` (any case, spaces around it ignored): the default of
/// [`super::Services::telemetry_forced_off`].
pub(crate) fn forced_off_by(value: Option<&str>) -> bool {
    value.is_some_and(|v| v.trim().eq_ignore_ascii_case("off"))
}

pub(crate) fn forced_off_from_environment() -> bool {
    forced_off_by(std::env::var("VRCT_TELEMETRY").ok().as_deref())
}

impl Core {
    fn telemetry_forced_off(&self) -> bool {
        (self.services().telemetry_forced_off)()
    }

    fn telemetry_notice_answered(&self) -> bool {
        self.config().get("TELEMETRY_NOTICE").as_i64().unwrap_or(0) >= NOTICE_VERSION
    }

    /// `_telemetryAllowed`: the setting is on, the notice answered, and not forced off.
    fn telemetry_allowed(&self) -> bool {
        !self.telemetry_forced_off() && self.config().get("ENABLE_TELEMETRY") == json!(true) && self.telemetry_notice_answered()
    }

    /// `PATH_DATA/telemetry_state.json`: the daily record and what was sent.
    fn telemetry_state_path(&self) -> PathBuf {
        self.config().environment().data_dir.join("telemetry_state.json")
    }

    /// `model.telemetryInit(enabled=True, ...)`.
    fn telemetry_init(&self) {
        let config = self.config();
        let path = self.telemetry_state_path();
        self.ops().telemetry.init(true, &config.get_str("VERSION"), Some(&path), &config.get_str("UI_LANGUAGE"));
    }

    /// The end of start-up: sending starts only when it is allowed ("Telemetry Init"). The
    /// error hook is registered either way, as Python registered it at import.
    pub(crate) fn start_telemetry(&self) {
        self.step("Telemetry Init");
        let _ = self.ops();
        if self.telemetry_allowed() {
            self.telemetry_init();
        }
    }

    /// At shutdown, after the settings are saved (`model.telemetryShutdown`).
    pub(crate) fn stop_telemetry(&self) {
        if let Some(ops) = self.ops.get() {
            ops.stop_reporting();
            ops.telemetry.shutdown();
        }
    }

    fn telemetry_notice(&self) -> Value {
        json!({
            "pending": !self.telemetry_forced_off() && !self.telemetry_notice_answered(),
            "enabled": self.config().get("ENABLE_TELEMETRY"),
        })
    }
}

pub(crate) fn add(b: &mut Builder<'_>) {
    b.with("/set/enable/telemetry", OPEN, |core, _| {
        let _ = core.config().set("ENABLE_TELEMETRY", json!(true));
        if core.telemetry_allowed() {
            core.telemetry_init();
        }
        ok(core.config().get("ENABLE_TELEMETRY"))
    });
    b.with("/set/disable/telemetry", OPEN, |core, _| {
        // Turning it off answers the notice too: an answer that sends nothing is safe from any
        // caller.
        let _ = core.config().set("TELEMETRY_NOTICE", json!(NOTICE_VERSION));
        if core.config().get("ENABLE_TELEMETRY") == json!(true) {
            let _ = core.config().set("ENABLE_TELEMETRY", json!(false));
        }
        core.ops().telemetry.shutdown();
        ok(core.config().get("ENABLE_TELEMETRY"))
    });
    b.with("/get/data/telemetry_notice", OPEN, |core, _| ok(core.telemetry_notice()));
    b.with("/set/data/telemetry_notice", OPEN, |core, data| {
        // The answer is exactly {"send": true} or {"send": false}.
        let send = data.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("send")).and_then(Value::as_bool);
        let Some(send) = send else { return Reply::status(400, json!({ "error_code": "telemetry_notice_invalid" })) };
        let config = core.config();
        let _ = config.set("ENABLE_TELEMETRY", json!(send));
        let _ = config.set("TELEMETRY_NOTICE", json!(NOTICE_VERSION));
        if core.telemetry_allowed() {
            core.telemetry_init();
        } else {
            core.ops().telemetry.shutdown();
        }
        ok(core.telemetry_notice())
    });
    b.with("/get/data/telemetry_preview", OPEN, |core, _| {
        // Answers while the notice is pending and while sending is off; asking sends nothing.
        let telemetry = &core.ops().telemetry;
        if telemetry.state().storage_path().is_none() {
            // Before the first send the record of what was sent has not been opened yet.
            telemetry.state().set_storage_path(&core.telemetry_state_path());
        }
        let config = core.config();
        let preview = telemetry.preview(&config.get_str("VERSION"), &config.get_str("UI_LANGUAGE"));
        ok(serde_json::to_value(preview).expect("plain JSON converts"))
    });
}

#[cfg(test)]
mod tests {
    use super::forced_off_by;

    #[test]
    fn only_off_forces_it_off() {
        for (value, forced) in [(Some("off"), true), (Some(" OFF "), true), (Some(""), false), (Some("on"), false), (Some("0"), false), (None, false)] {
            assert_eq!(forced_off_by(value), forced, "{value:?}");
        }
    }
}
