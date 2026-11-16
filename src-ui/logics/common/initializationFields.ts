// How a setting of SETTINGS_ARRAY (ui_config_setter.js) talks to the backend.
export type SettingLogicsTemplateId =
    "get_only" | "get_list" | "get_set" | "get_set_delete" | "toggle_enable_disable" | "weight_download_status";

// The fields of a SETTINGS_ARRAY entry the request logic reads.
export interface SettingDefinition {
    base_endpoint_name: string;
    logics_template_id: SettingLogicsTemplateId;
    default_value?: unknown;
    response_transform?: string;
}

// The value the backend sent for one /get/data/... endpoint, checked before it is applied.
export type InitializationValidator = (value: unknown) => boolean;
export type InitializationValidators = Record<string, InitializationValidator>;

// One language slot of selected_your_languages / selected_target_languages.
export interface LanguageSelection {
    language: string;
    country: string;
    enable: boolean;
}

// Tab number ("1" to "3"), then slot number, to the selection.
export type LanguageSelections = Record<string, Record<string, LanguageSelection>>;

type JsonRecord = { readonly [key: string]: unknown };

const record = (value: unknown): value is JsonRecord => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown) => typeof value === "string";
const boolean = (value: unknown) => typeof value === "boolean";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const tabs = ["1", "2", "3"];
// Unknown languages render the existing loading label without inventing a
// backend selection. Every slot the selector indexes must exist before ready.
export const initialLanguages = (target = false): LanguageSelections => Object.fromEntries(tabs.map(tab => [tab,
    Object.fromEntries((target ? tabs : ["1"]).map(slot => [slot, { language: "", country: "", enable: slot === "1" }]))]));
const matches = (fallback: unknown): InitializationValidator => value => {
    if (fallback == null) return value === null || record(value);
    if (Array.isArray(fallback)) return Array.isArray(value);
    if (record(fallback)) return record(value) && Object.entries(fallback).every(([key, item]) => matches(item)(value[key]));
    return typeof fallback === "number" ? number(value) : typeof value === typeof fallback;
};

export const createInitializationValidators = (settings: readonly SettingDefinition[]): InitializationValidators => {
    const validators: InitializationValidators = {};
    for (const setting of settings) {
        const name = setting.base_endpoint_name;
        if (setting.logics_template_id === "weight_download_status") {
            validators[`/get/data/selectable_${name}_type_dict`] = record;
            continue;
        }
        const validate: InitializationValidator = setting.response_transform ? Array.isArray : matches(setting.default_value);
        const optional = name.endsWith("_auth_key") || /^selected_.*_model$/.test(name) || name === "selected_transcription_engine";
        validators[`/get/data/${name}`] = optional ? value => value === null || validate(value) : validate;
    }
    const specific: InitializationValidators = {
        selected_your_languages: matches(initialLanguages()),
        selected_target_languages: matches(initialLanguages(true)),
        selected_translation_engines: matches({ 1: "", 2: "", 3: "" }),
        selected_tab_no: value => tabs.includes(value as string),
        selectable_translation_engines: Array.isArray,
        selectable_language_list: Array.isArray,
        selected_translation_compute_device: record,
        local_asr_notice: boolean,
        virtual_mic_notice: boolean,
        virtual_mic_status: record,
        old_whisper_weights: record,
        hotkeys: value => record(value) && ["open_quick_chat", "toggle_vrct_visibility", "toggle_translation",
            "toggle_transcription_send", "toggle_transcription_receive",
            "stop_voice", "toggle_voice_mute", "toggle_tts", "toggle_rvc"].every(key =>
            value[key] === null || (Array.isArray(value[key]) && value[key].every(string))),
        compute_mode: string,
        version: string,
        message_box_ratio: number,
        foreground: boolean,
        main_window_sidebar_compact_mode: boolean,
        connected_lmstudio: boolean,
        connected_ollama: boolean,
        main_window_geometry: matches({ x_pos: 0, y_pos: 0, width: 0, height: 0 }),
        available_releases: Array.isArray,
    };
    for (const name of ["voice_settings", "voice_status", "voice_route", "voice_output_devices", "tts_model_options",
        "direct_voice_state", "direct_voice_sources", "speech_server_settings", "speech_server_state",
        "realtime_asr_settings", "realtime_asr_state", "realtime_asr_models", "realtime_asr_endpoints",
        "model_download_catalog", "model_download_state", "model_download_hardware", "user_models"]) specific[name] = record;
    for (const [name, validate] of Object.entries(specific)) validators[`/get/data/${name}`] = validate;
    return validators;
};

// Applies one initialization value to the UI; throws when it cannot.
export type InitializationRoutes = Record<string, (value: unknown) => void>;

// Null remains valid for optional credentials/models. Failed required getters
// keep their safe UI defaults and participate in the degraded-startup warning.
export const applyInitializationFields = (
    result: unknown,
    routes: InitializationRoutes,
    validators: InitializationValidators,
    invalidEndpoint: (field: { endpoint: string; result: unknown }) => void,
): string[] => {
    const failed: string[] = [];
    const report = (endpoint: string, reason: string) => {
        failed.push(endpoint);
        // Getter values can contain credentials. Log the name and reason only.
        console.error("Sidecar initialization field unavailable", endpoint, reason);
    };
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        report("/run/initialization_complete", "expected an object");
        return failed;
    }
    for (const [endpoint, value] of Object.entries(result as { readonly [key: string]: unknown })) {
        if (!Object.hasOwn(routes, endpoint)) {
            invalidEndpoint({ endpoint, result: value });
            continue;
        }
        if (validators[endpoint] && !validators[endpoint](value)) {
            report(endpoint, value == null ? "missing value" : "invalid value shape");
            continue;
        }
        try {
            routes[endpoint](value);
        } catch {
            report(endpoint, "could not apply value");
        }
    }
    return failed;
};
