// Answers to the Tauri commands the app calls besides the core's, as a desktop without the
// features of the app's shell would give them (ADR-017): no Quick Chat window, caption window,
// companion, VR panel, screen sharing or updater. A command without an answer here is recorded,
// and the tests fail on it, so a new command the app calls is noticed instead of answered by
// accident.

export interface IntegrationRecord {
    // Commands this file has no answer for.
    unknown: string[];
    // Links the app asked the system to open.
    opened: string[];
}

declare global {
    interface Window {
        __integration: IntegrationRecord;
    }
}

const answers: Record<string, unknown> = {
    get_font_list: ["Noto Sans", "Noto Sans JP"],
    caption_overlay_supported: false,
    screencast_support: { supported: false, active: false },
    quick_chat_shortcut_platform: "x11",
    // Nothing waits in the Quick Chat window or the companion.
    quick_chat_take: null,
    companion_take: [],
    app_update_info: { kind: "development", mode: "disabled", channel: "stable", current_version: "0.0.0", package_manager: null },
};

// Commands that only change something in the shell; they answer nothing.
const settings = new Set([
    "companion_set", "companion_publish", "companion_close_hides", "companion_handle_layout", "companion_panel_hide",
    "companion_panel_toggle", "companion_hide_main", "companion_show_main", "caption_overlay_set", "caption_overlay_update",
    "quick_chat_configure", "quick_chat_hide", "main_window_restore", "set_vr_panel_window", "vr_panel_state_push",
    "vr_panel_send", "screencast_stop",
]);

const windowAnswers: Record<string, unknown> = {
    is_visible: true, is_focused: true, is_minimized: false, is_maximized: false, is_fullscreen: false, is_decorated: true,
    scale_factor: 1, inner_size: { width: 1280, height: 800 }, outer_size: { width: 1280, height: 800 },
    inner_position: { x: 0, y: 0 }, outer_position: { x: 0, y: 0 }, title: "ASTAROT", theme: "dark",
};

export function standIn(command: string, payload: Record<string, unknown>): unknown {
    if (command in answers) return answers[command];
    if (settings.has(command)) return null;
    const [plugin, name = ""] = command.split("|");
    if (plugin === "plugin:window" || plugin === "plugin:webview") {
        // Setters and listeners of the window answer nothing; its state is that of a shown window.
        return name in windowAnswers ? windowAnswers[name] : null;
    }
    if (plugin === "plugin:global-shortcut") return name === "is_registered" ? false : null;
    if (plugin === "plugin:opener") {
        window.__integration.opened.push(String(payload.url ?? payload.path ?? ""));
        return null;
    }
    if (plugin === "plugin:app" && name === "version") return "0.0.0";
    window.__integration.unknown.push(command);
    return null;
}
