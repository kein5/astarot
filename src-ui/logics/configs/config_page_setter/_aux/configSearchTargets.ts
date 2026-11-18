// Where the settings search (useConfigSearch.js) leads for each text under config_page.<page>.

// Texts under a page's namespace that are not settings: a field's placeholder, an error, an
// option of a choice. Listed, they would lead nowhere.
export const NOT_SETTINGS: ReadonlySet<string> = new Set([
    "hotkeys.input_placeholder", "hotkeys.unassigned_placeholder", "hotkeys.disabled_notice",
    "hotkeys.error_in_use", "hotkeys.error_failed_to_register_at_launch", "hotkeys.error_failed_to_register_all",
    "hotkeys.error_window_restore_failed", "hotkeys.error_window_minimize_failed",
    "vr.hmd", "vr.left_hand", "vr.right_hand",
    // Buttons that open another page: the row they sit on is the result (PagePointer).
    "vr.open_experimental_features", "vrchat.open_advanced_settings", "vrchat.open_tts", "device.open_vrchat",
    // The sentence of a row that leads to another page; the row is found by its label.
    "vrchat.tts_output_pointer", "device.mute_sync_pointer",
    // The experimental features page's notice and empty state; its items are listed one by one.
    "experimental_features.notice", "experimental_features.empty",
]);

// Parts of a larger setting with no place of their own: the search leads to the setting.
// The VR overlay's position, rotation, size and timing are drawn inside its editor.
const VR_OVERLAY = "vr_overlay";
export const SETTING_TARGETS: Readonly<Record<string, string>> = {
    ...Object.fromEntries(["single_line", "multi_lines", "position", "rotation", "x_position", "y_position", "z_position",
        "x_rotation", "y_rotation", "z_rotation", "opacity", "ui_scaling", "display_duration", "fadeout_duration"]
        .map(key => [`vr.${key}`, VR_OVERLAY])),
    // One text names both voice switches; the TTS row comes first.
    "hotkeys.toggle_voice_switch": "toggle_tts",
    "ocr.source_language": "ocr_source_language",
};

// The data-setting-id the search looks for first (it falls back to the label).
export const settingTarget = (namespace: string, key: string): string => SETTING_TARGETS[`${namespace}.${key}`] ?? key;
