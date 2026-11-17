import { invoke } from "@tauri-apps/api/core";

// What the VR panel tells the main window. The panel has no permission to send events
// (src-tauri/capabilities/vr-panel.json), so it cannot pass for Rust or another window: it calls
// vr_panel_send, which checks the sender, the name and the shape and sends the event to the main
// window only (src-tauri/src/vr_panel_state.rs). The main window listens as before.
export type VrPanelEvent = "vr-panel-ready" | "vr-panel-config-page" | "vr-panel-stdout";

export const sendToMain = (event: VrPanelEvent, payload: unknown = null): Promise<void> =>
    invoke<void>("vr_panel_send", { event, payload: payload ?? null });
