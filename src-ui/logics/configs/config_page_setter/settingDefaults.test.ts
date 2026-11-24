import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { test } from "vitest";
import { fieldOf, isRecord } from "../../test/hookHarness.ts";
import { settingAtom } from "../../test/bridgeHarness.ts";
import { coreDefaults, loadSettingsList } from "../../test/settingsHarness.ts";
import { ctranslate2_weight_type_status } from "../../ui_configs.ts";

// The value each setting of the list (ui_config_setter.ts) shows before the backend's first answer,
// checked against the core's defaults (tools/spec_core_catalog.json, written by the core's tests).
// A setting reads the config key named like its endpoint (selected_mic_host: SELECTED_MIC_HOST),
// unless the core's GET reads another key, or a field of one (native/core/src/controller/routes.rs).

const coreValue = (key: string): unknown => {
    assert.ok(coreDefaults.has(key), `the core keeps no ${key}`);
    return coreDefaults.get(key);
};
const READ_ELSEWHERE: Readonly<Record<string, () => unknown>> = {
    MicVadFilter: () => coreValue("MIC_ENABLE_VAD"),
    SpeakerVadFilter: () => coreValue("SPEAKER_ENABLE_VAD"),
    Telemetry: () => coreValue("ENABLE_TELEMETRY"),
    ReleaseChannel: () => coreValue("SELECTED_RELEASE_CHANNEL"),
    OverlayVrPanelAnchor: () => fieldOf(coreValue("OVERLAY_VR_PANEL_SETTINGS"), "tracker"),
    OverlayVrPanelOpacity: () => fieldOf(coreValue("OVERLAY_VR_PANEL_SETTINGS"), "opacity"),
    OverlayVrLauncherHand: () => fieldOf(coreValue("OVERLAY_VR_LAUNCHER_SETTINGS"), "tracker"),
    WebsocketTls: () => ({ cert_file: coreValue("WEBSOCKET_TLS_CERT_FILE"), key_file: coreValue("WEBSOCKET_TLS_KEY_FILE") }),
};

// Settings that wait for the core's answer with an empty value ("", 0, null, {}) instead of the
// core's default: a device, model or URL the page should not name before the core does, and
// numbers the page shows only once known.
const EMPTY_UNTIL_ANSWERED: ReadonlySet<string> = new Set([
    "SelectedMicHost", "SelectedMicDevice", "SelectedSpeakerDevice", "MicThreshold", "SpeakerThreshold",
    "SelectedTranslationComputeType", "SelectedTranslationComputeDevice",
    "SelectedPlamoModel", "SelectedGeminiModel", "SelectedOpenAIModel", "SelectedGroqModel", "SelectedOpenRouterModel",
    "LMStudioURL", "SelectedLMStudioModel", "SelectedOpenAICompatibleModel", "OllamaURL", "SelectedOllamaModel",
    "MicRecordTimeout", "MicPhraseTimeout", "MicMaxWords", "SpeakerRecordTimeout", "SpeakerPhraseTimeout", "SpeakerMaxWords",
    "SelectedTranscriptionEngine", "SelectedGroqWhisperModel", "SelectedOpenAIWhisperModel", "SelectedCustomWhisperModel", "SelectedDeepgramModel",
    "MicAvgLogprob", "MicNoSpeechProb", "SpeakerAvgLogprob", "SpeakerNoSpeechProb",
    "WebsocketAuthToken", "ExperimentalFeatures", "UsagePresets",
    // The path of config.json, which the core works out on each machine.
    "PathConfig",
]);

// Settings that start at a value of their own, which is neither the core's default nor empty. Each
// is listed with that value, so a change to it is a decision made here.
const OWN_START: Readonly<Record<string, unknown>> = {
    // The automatic sensitivity is drawn on, and the switches below off, until the core answers; the
    // core's defaults are the other way round.
    EnableAutomaticMicThreshold: true,
    EnableAutomaticSpeakerThreshold: true,
    ShowResendButton: true,
    EnableAutoClearMessageInputBox: false,
    EnableSendMessageToVrc: false,
    EnableNotificationVrcSfx: false,
    // Not one of the core's values (SEND_MESSAGE_BUTTON_TYPE_LIST); the input box reads anything but
    // "hide" and "show_and_disable_enter_key" as "show", the core's default.
    SendMessageButtonType: "primary",
    // The core answers whether the one-time notice waits and whether sending is on, worked out from
    // TELEMETRY_NOTICE (a number) and ENABLE_TELEMETRY.
    TelemetryNotice: { pending: false, enabled: true },
    WebsocketPort: 9001,
    // The core answers the folder the logs go to and why it fell back, if it did (#1096), worked
    // out from PATH_LOGS.
    PathLogs: { path: "", error_code: null },
};

const isEmpty = (value: unknown) => value === "" || value === 0 || value === false || value === null
    || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);

test("a setting the core keeps starts at the core's default, or empty where it waits for the core's answer", async () => {
    const { list } = await loadSettingsList();
    const kept = list.SETTINGS_ARRAY.filter(setting => setting.Base_Name in READ_ELSEWHERE || coreDefaults.has(setting.base_endpoint_name.toUpperCase()));
    assert.ok(kept.length > 130, String(kept.length));
    for (const setting of kept) {
        const name = setting.Base_Name, value: unknown = setting.default_value;
        if (name in OWN_START) continue;
        const core = READ_ELSEWHERE[name]?.() ?? coreValue(setting.base_endpoint_name.toUpperCase());
        if (EMPTY_UNTIL_ANSWERED.has(name)) {
            assert.ok(isEmpty(value), `${name} starts at ${JSON.stringify(value)}`);
            assert.ok(!isDeepStrictEqual(value, core), `${name} starts at the core's default: drop it from the list`);
        } else {
            assert.deepEqual(value, core, `${name} starts at the core's default`);
        }
    }
});

test("the settings that start at a value of their own are the listed ones, at the listed values", async () => {
    const { list } = await loadSettingsList();
    for (const [name, value] of Object.entries(OWN_START)) {
        const setting = list.SETTINGS_ARRAY.find(item => item.Base_Name === name);
        assert.ok(setting, name);
        assert.deepEqual(setting.default_value, value, name);
        const core = READ_ELSEWHERE[name]?.() ?? coreValue(setting.base_endpoint_name.toUpperCase());
        assert.ok(!isDeepStrictEqual(value, core), `${name} starts at the core's default: drop it from the list`);
    }
    for (const name of EMPTY_UNTIL_ANSWERED) assert.ok(list.SETTINGS_ARRAY.some(item => item.Base_Name === name), name);
});

test("a value the core works out starts empty, but for the built-in weights and the VR layout", async () => {
    const { list, vrLayout } = await loadSettingsList();
    const worked = list.SETTINGS_ARRAY.filter(setting => !(setting.Base_Name in READ_ELSEWHERE) && !coreDefaults.has(setting.base_endpoint_name.toUpperCase()));
    assert.ok(worked.length > 25, String(worked.length));
    for (const setting of worked) {
        const name = setting.Base_Name, value: unknown = setting.default_value;
        if (name === "CTranslate2WeightTypeStatus") assert.deepEqual(value, ctranslate2_weight_type_status, name);
        else if (name === "VrPanelLayout") assert.deepEqual(value, vrLayout, name);
        else assert.ok(isEmpty(value), `${name} starts at ${JSON.stringify(value)}`);
    }
});

test("every setting waits for the backend with its starting value", async () => {
    const s = await loadSettingsList();
    for (const setting of s.list.SETTINGS_ARRAY) {
        const state = s.runtime.store.get(settingAtom(s.stores.dynamicStoreRegistry, `Atom_${setting.Base_Name}`));
        assert.deepEqual(state, { state: "pending", data: setting.default_value }, setting.Base_Name);
    }
});
