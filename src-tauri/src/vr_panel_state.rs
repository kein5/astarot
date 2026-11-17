//! The main window's state for the VR panel (security audit SEC-03).
//!
//! The state includes the conversation log. A global event would reach every window that may
//! listen to events (the caption overlay and Quick Chat may), and even an event sent to one
//! window reaches listeners registered for any target. So the VR panel opens a channel here,
//! and the main window's state goes only through that channel: Tauri delivers a channel's
//! messages to the one webview that created it.
use std::sync::Mutex;

use serde_json::Value;
use tauri::ipc::Channel;

pub const MAIN: &str = "main";
pub const VR_PANEL: &str = "vr_panel";
pub const FORBIDDEN: &str = "vr_panel_state_forbidden";

#[derive(Default)]
pub struct VrPanelState {
    channel: Mutex<Option<Channel<Value>>>,
}

impl VrPanelState {
    /// The VR panel's channel replaces any earlier one (a reopened panel subscribes again).
    pub fn subscribe(&self, sender: &str, channel: Channel<Value>) -> Result<(), String> {
        if sender != VR_PANEL {
            return Err(FORBIDDEN.into());
        }
        *self.channel.lock().map_err(|_| "vr_panel_state_unavailable".to_string())? = Some(channel);
        Ok(())
    }

    /// Ok(false) when no VR panel listens; the panel asks for the full state when it subscribes.
    pub fn push(&self, sender: &str, payload: Value) -> Result<bool, String> {
        if sender != MAIN {
            return Err(FORBIDDEN.into());
        }
        let mut slot = self.channel.lock().map_err(|_| "vr_panel_state_unavailable".to_string())?;
        let Some(channel) = slot.as_ref() else {
            return Ok(false);
        };
        if channel.send(payload).is_err() {
            // The panel's webview is gone; forget its channel until a new panel subscribes.
            *slot = None;
            return Ok(false);
        }
        Ok(true)
    }

    pub fn clear(&self) {
        if let Ok(mut slot) = self.channel.lock() {
            *slot = None;
        }
    }
}

/// What the VR panel tells the main window (#397). The panel has no permission to send events
/// itself, so it cannot pass for Rust (`portal-shortcut`, `caption-overlay-moved` ...) or for
/// another window: it calls `vr_panel_send`, which checks the sender, the name and the shape, and
/// sends the event to the main window only.
pub const PANEL_EVENTS: [&str; 3] = ["vr-panel-ready", "vr-panel-config-page", "vr-panel-stdout"];
pub const EVENT_INVALID: &str = "vr_panel_event_invalid";

pub fn check_panel_event(sender: &str, event: &str, payload: &Value) -> Result<(), String> {
    if sender != VR_PANEL {
        return Err(FORBIDDEN.into());
    }
    let valid = match event {
        "vr-panel-ready" => payload.is_null(),
        "vr-panel-config-page" => payload.is_boolean(),
        // The main window checks the path against its relay list (vrPanelWire.ts).
        "vr-panel-stdout" => payload.get("path").is_some_and(Value::is_string),
        _ => false,
    };
    if valid { Ok(()) } else { Err(EVENT_INVALID.into()) }
}

#[tauri::command]
pub fn vr_panel_send(window: tauri::WebviewWindow, event: String, payload: Value) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    check_panel_event(window.label(), &event, &payload)?;
    window.app_handle().emit_to(MAIN, &event, payload).map_err(|_| "vr_panel_state_unavailable".to_string())
}

#[tauri::command]
pub fn vr_panel_state_subscribe(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, VrPanelState>,
    channel: Channel<Value>,
) -> Result<(), String> {
    state.subscribe(window.label(), channel)
}

#[tauri::command]
pub fn vr_panel_state_push(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, VrPanelState>,
    payload: Value,
) -> Result<bool, String> {
    state.push(window.label(), payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};
    use tauri::ipc::InvokeResponseBody;

    fn recording() -> (Channel<Value>, Arc<StdMutex<Vec<String>>>) {
        let received = Arc::new(StdMutex::new(Vec::new()));
        let sink = received.clone();
        let channel = Channel::new(move |body| {
            let text = match body {
                InvokeResponseBody::Json(json) => json,
                InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            };
            sink.lock().unwrap().push(text);
            Ok(())
        });
        (channel, received)
    }

    #[test]
    fn only_the_vr_panel_can_subscribe() {
        let state = VrPanelState::default();
        for label in [MAIN, "quick_chat", "caption_overlay", "unknown", ""] {
            let (channel, _) = recording();
            assert_eq!(state.subscribe(label, channel), Err(FORBIDDEN.to_string()), "{label}");
        }
        // Nothing subscribed, so nothing is delivered.
        assert_eq!(state.push(MAIN, serde_json::json!({"MessageLogs": []})), Ok(false));
    }

    #[test]
    fn only_the_main_window_can_push_and_only_the_panel_receives() {
        let state = VrPanelState::default();
        let (channel, received) = recording();
        state.subscribe(VR_PANEL, channel).unwrap();
        for label in [VR_PANEL, "quick_chat", "caption_overlay", "unknown"] {
            assert_eq!(state.push(label, serde_json::json!({"forged": true})), Err(FORBIDDEN.to_string()), "{label}");
        }
        assert_eq!(state.push(MAIN, serde_json::json!({"TranslationStatus": true})), Ok(true));
        assert_eq!(received.lock().unwrap().as_slice(), [r#"{"TranslationStatus":true}"#]);
    }

    #[test]
    fn a_new_subscription_replaces_the_old_one_and_clear_forgets_it() {
        let state = VrPanelState::default();
        let (first, first_received) = recording();
        let (second, second_received) = recording();
        state.subscribe(VR_PANEL, first).unwrap();
        state.subscribe(VR_PANEL, second).unwrap();
        assert_eq!(state.push(MAIN, serde_json::json!(1)), Ok(true));
        assert!(first_received.lock().unwrap().is_empty());
        assert_eq!(second_received.lock().unwrap().len(), 1);
        state.clear();
        assert_eq!(state.push(MAIN, serde_json::json!(2)), Ok(false));
    }

    #[test]
    fn only_the_vr_panel_sends_its_three_events_in_their_shapes() {
        use serde_json::json;
        assert_eq!(check_panel_event(VR_PANEL, "vr-panel-ready", &Value::Null), Ok(()));
        assert_eq!(check_panel_event(VR_PANEL, "vr-panel-config-page", &json!(true)), Ok(()));
        assert_eq!(check_panel_event(VR_PANEL, "vr-panel-stdout", &json!({ "path": "/run/vr_panel_windows", "value": {} })), Ok(()));
        for label in [MAIN, "quick_chat", "caption_overlay", "unknown", ""] {
            assert_eq!(check_panel_event(label, "vr-panel-ready", &Value::Null), Err(FORBIDDEN.to_string()), "{label}");
        }
        // The names Rust sends to the main window cannot be passed off as the panel's.
        for event in ["portal-shortcut", "portal-shortcuts-lost", "caption-overlay-moved", "caption-overlay-font-step",
            "quick-chat-requested", "screencast-ended", "vr-panel-pointer", "vr-panel-state", ""] {
            assert_eq!(check_panel_event(VR_PANEL, event, &Value::Null), Err(EVENT_INVALID.to_string()), "{event}");
        }
        for (event, payload) in [("vr-panel-ready", json!(1)), ("vr-panel-config-page", json!("yes")),
            ("vr-panel-stdout", json!({ "path": 3 })), ("vr-panel-stdout", json!(null))] {
            assert_eq!(check_panel_event(VR_PANEL, event, &payload), Err(EVENT_INVALID.to_string()), "{event} {payload}");
        }
        assert!(PANEL_EVENTS.iter().all(|event| event.starts_with("vr-panel-")));
    }

    #[test]
    fn a_channel_that_fails_is_dropped() {
        let state = VrPanelState::default();
        let failing = Channel::new(|_| Err(tauri::Error::WebviewNotFound));
        state.subscribe(VR_PANEL, failing).unwrap();
        assert_eq!(state.push(MAIN, serde_json::json!(1)), Ok(false));
        let (channel, received) = recording();
        state.subscribe(VR_PANEL, channel).unwrap();
        assert_eq!(state.push(MAIN, serde_json::json!(2)), Ok(true));
        assert_eq!(received.lock().unwrap().len(), 1);
    }
}
