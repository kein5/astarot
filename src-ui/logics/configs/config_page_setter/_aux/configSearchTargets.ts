// Where the settings search (useConfigSearch.ts) leads for each text under config_page.<page>.

// Texts under a page's namespace that are not settings: a field's placeholder, an error, an
// option of a choice. Listed, they would lead nowhere.
export const NOT_SETTINGS: ReadonlySet<string> = new Set([
    "hotkeys.input_placeholder", "hotkeys.unassigned_placeholder", "hotkeys.disabled_notice",
    "hotkeys.error_in_use", "hotkeys.error_failed_to_register_at_launch", "hotkeys.error_failed_to_register_all",
    "hotkeys.error_window_restore_failed", "hotkeys.error_window_minimize_failed",
    "vr.hmd", "vr.left_hand", "vr.right_hand",
    // What the buttons that open another page say is done there: the row they sit on is the
    // result (PagePointer). The others are in their row's group (vr_panel_pointer, osc_pointer).
    "vrchat.tts_output_action", "device.mute_sync_action",
    // The sentence of a row that leads to another page; the row is found by its label.
    "vrchat.tts_output_pointer", "device.mute_sync_pointer",
    // The experimental features page's notice and empty state; its items are listed one by one.
    "experimental_features.notice", "experimental_features.empty",
    // States shown on a fold's line: the selected translation model's (on 「Model and device」), each
    // translation and speech recognition provider's, and the segmenting fold's.
    "translation.setup_downloaded", "translation.setup_not_downloaded", "translation.setup_unavailable",
    "translation.provider_in_use", "translation.provider_ready", "translation.provider_not_set",
    "transcription.timing_status",
    // A state shown in place of a model's download button.
    "translation.download_unavailable",
    // Notes beside settings, which are found by their own texts: no built-in model can be
    // downloaded; what LLM engines receive; VAD needs a speech recognition server.
    "translation.models_unavailable", "translation.llm_privacy_lead", "translation.llm_privacy_desc",
    "device.desc_vad_unavailable",
    // Words inside the mic and speaker rows of the Device page, each in both rows: the volume check
    // button and the parts of the device choice. The rows are found by their own texts.
    "device.check_volume", "device.label_auto_select", "device.label_host", "device.label_device",
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
