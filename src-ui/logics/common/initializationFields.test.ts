import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { applyInitializationFields, createInitializationValidators, initialLanguages } from "./initializationFields.ts";

const PLACEMENT = "/get/data/overlay_desktop_placement";
const validators = createInitializationValidators([
    { base_endpoint_name: "overlay_desktop_placement", logics_template_id: "get_set", default_value: { x: null, y: null } },
]);

// A caption window dragged once is saved as whole px and has to come back on the next start.
test("a saved caption window place is applied at start-up", () => {
    const applied: unknown[] = [];
    const failed = applyInitializationFields({ [PLACEMENT]: { x: -1700, y: 640 } },
        { [PLACEMENT]: value => applied.push(value) }, validators, () => {});
    assert.deepEqual(failed, []);
    assert.deepEqual(applied, [{ x: -1700, y: 640 }]);
});

test("the caption window place accepts the band and refuses half or broken places", () => {
    const valid = validators[PLACEMENT];
    assert.equal(valid({ x: null, y: null }), true);
    assert.equal(valid({ x: 0, y: 0 }), true);
    for (const bad of [{ x: 1, y: null }, { x: null, y: 2 }, { x: 1.5, y: 2 }, { x: "1", y: 2 }, null, [], 3]) {
        assert.equal(valid(bad), false, JSON.stringify(bad));
    }
});

const slot = (enable = true) => ({ language: "Japanese", country: "Japan", enable });
const HOTKEYS = ["open_quick_chat", "toggle_vrct_visibility", "toggle_translation", "toggle_transcription_send",
    "toggle_transcription_receive", "stop_voice", "toggle_voice_mute", "toggle_tts", "toggle_rvc"];

test("the language selections start empty, with only the first slot of each tab on", () => {
    const empty = (enable: boolean) => ({ language: "", country: "", enable });
    assert.deepEqual(initialLanguages(), { 1: { 1: empty(true) }, 2: { 1: empty(true) }, 3: { 1: empty(true) } });
    const targets = { 1: empty(true), 2: empty(false), 3: empty(false) };
    assert.deepEqual(initialLanguages(true), { 1: targets, 2: targets, 3: targets });
});

test("a setting's value is checked against the type of its default", () => {
    const valid = createInitializationValidators([
        { base_endpoint_name: "port", logics_template_id: "get_set", default_value: 9000 },
        { base_endpoint_name: "name", logics_template_id: "get_set", default_value: "" },
        { base_endpoint_name: "on", logics_template_id: "toggle_enable_disable", default_value: false },
        { base_endpoint_name: "list", logics_template_id: "get_list", default_value: [] },
        { base_endpoint_name: "nothing_yet", logics_template_id: "get_only", default_value: null },
        { base_endpoint_name: "box", logics_template_id: "get_set", default_value: { size: 1, label: "" } },
        { base_endpoint_name: "shaped", logics_template_id: "get_only", default_value: "", response_transform: "keys" },
    ]);
    const check = (name: string, value: unknown) => valid[`/get/data/${name}`](value);
    assert.deepEqual([check("port", 8000), check("port", Number.NaN), check("port", Infinity), check("port", "8000")],
        [true, false, false, false]);
    assert.deepEqual([check("name", "a"), check("name", 1)], [true, false]);
    assert.deepEqual([check("on", true), check("on", "true")], [true, false]);
    assert.deepEqual([check("list", []), check("list", {})], [true, false]);
    assert.deepEqual([check("nothing_yet", null), check("nothing_yet", {}), check("nothing_yet", []), check("nothing_yet", "")],
        [true, true, false, false]);
    assert.deepEqual([check("box", { size: 2, label: "x" }), check("box", { size: "2", label: "x" }), check("box", { size: 2 })],
        [true, false, false]);
    assert.deepEqual([check("shaped", ["a"]), check("shaped", "a")], [true, false], "a transformed response is a list");
});

test("credentials, selected models and the transcription engine may be unset; other settings may not", () => {
    const names = ["deepl_auth_key", "selected_whisper_model", "selected_transcription_engine",
        "my_selected_whisper_model", "selected_whisper_model_list", "plain"];
    const valid = createInitializationValidators(names.map(name =>
        ({ base_endpoint_name: name, logics_template_id: "get_set", default_value: "" })));
    assert.deepEqual(names.map(name => valid[`/get/data/${name}`](null)), [true, true, true, false, false, false]);
    assert.equal(valid["/get/data/deepl_auth_key"](5), false, "a set value still has to fit");
});

test("a weight download status is read from its type list only", () => {
    const valid = createInitializationValidators([
        { base_endpoint_name: "whisper_weight", logics_template_id: "weight_download_status", default_value: "" }]);
    assert.equal(valid["/get/data/whisper_weight"], undefined, "the status itself is not a start-up value");
    const check = valid["/get/data/selectable_whisper_weight_type_dict"];
    assert.deepEqual([check({ base: true }), check([]), check(null)], [true, false, false]);
});

test("the start-up values that no setting describes have their own checks", () => {
    const valid = createInitializationValidators([]);
    const check = (name: string, value: unknown) => valid[`/get/data/${name}`](value);
    const tabs = (value: unknown) => ({ 1: value, 2: value, 3: value });
    assert.equal(check("selected_your_languages", tabs({ 1: slot() })), true);
    assert.equal(check("selected_your_languages", { 1: { 1: slot() }, 2: { 1: slot() } }), false, "every tab is there");
    assert.equal(check("selected_your_languages", tabs({ 1: { ...slot(), enable: "yes" } })), false);
    assert.equal(check("selected_target_languages", tabs({ 1: slot(), 2: slot(false), 3: slot(false) })), true);
    assert.equal(check("selected_target_languages", tabs({ 1: slot(), 2: slot(false) })), false, "every slot is there");
    assert.equal(check("selected_translation_engines", { 1: "DeepL", 2: "Google", 3: "" }), true);
    assert.equal(check("selected_translation_engines", { 1: "DeepL", 2: "Google" }), false);
    assert.deepEqual(["1", "3", "4", 1].map(value => check("selected_tab_no", value)), [true, true, false, false]);
    assert.equal(check("main_window_geometry", { x_pos: 0, y_pos: 0, width: 800, height: 600 }), true);
    assert.equal(check("main_window_geometry", { x_pos: 0, y_pos: 0, width: 800 }), false);
    assert.deepEqual([check("virtual_mic_notice", true), check("virtual_mic_notice", 1)], [true, false]);
    assert.deepEqual([check("version", "1.0"), check("version", 1)], [true, false]);
    assert.deepEqual([check("message_box_ratio", 0.5), check("message_box_ratio", Number.NaN)], [true, false]);
    for (const name of ["voice_settings", "voice_status", "voice_route", "voice_output_devices", "tts_model_options",
        "direct_voice_state", "direct_voice_sources", "speech_server_settings", "speech_server_state",
        "realtime_asr_settings", "realtime_asr_state", "realtime_asr_models", "realtime_asr_endpoints",
        "model_download_catalog", "model_download_state", "model_download_hardware", "user_models"]) {
        assert.deepEqual([check(name, {}), check(name, [])], [true, false], name);
    }
});

test("hotkeys are a key list, or none, for every action", () => {
    const check = createInitializationValidators([])["/get/data/hotkeys"];
    const hotkeys = Object.fromEntries(HOTKEYS.map(name => [name, null]));
    assert.equal(check(hotkeys), true);
    assert.equal(check({ ...hotkeys, toggle_tts: ["Control", "T"] }), true);
    assert.equal(check({ ...hotkeys, toggle_tts: ["Control", 84] }), false, "every key is a name");
    assert.equal(check({ ...hotkeys, toggle_tts: "Control+T" }), false);
    for (const name of HOTKEYS) {
        const { [name]: _, ...missing } = hotkeys;
        assert.equal(check(missing), false, name);
    }
    assert.equal(check([]), false);
});

test("values that cannot be used are reported by endpoint and reason, without the value", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown: { endpoint: string; result: unknown }[] = [], applied: unknown[] = [];
    const valid = createInitializationValidators([
        { base_endpoint_name: "deepl_auth_key", logics_template_id: "get_set", default_value: "" },
        { base_endpoint_name: "port", logics_template_id: "get_set", default_value: 9000 },
    ]);
    const routes = {
        "/get/data/deepl_auth_key": (value: unknown) => applied.push(value),
        "/get/data/port": () => { throw new Error("cannot apply"); },
        "/get/data/version": (value: unknown) => applied.push(value),
    };
    const failed = applyInitializationFields({
        "/get/data/deepl_auth_key": 12345,
        "/get/data/port": 8000,
        "/get/data/version": undefined,
        "/get/data/unknown": "secret-value",
    }, routes, valid, field => unknown.push(field));
    assert.deepEqual(failed, ["/get/data/deepl_auth_key", "/get/data/port", "/get/data/version"]);
    assert.deepEqual(applied, []);
    assert.deepEqual(unknown, [{ endpoint: "/get/data/unknown", result: "secret-value" }]);
    assert.deepEqual(log.mock.calls, [
        ["Sidecar initialization field unavailable", "/get/data/deepl_auth_key", "invalid value shape"],
        ["Sidecar initialization field unavailable", "/get/data/port", "could not apply value"],
        ["Sidecar initialization field unavailable", "/get/data/version", "missing value"],
    ]);
    assert.equal(JSON.stringify(log.mock.calls).includes("12345"), false, "a credential never reaches the log");
});

test("a start-up result that is not an object fails as a whole", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = { "/get/data/version": () => assert.fail("nothing is applied") };
    for (const result of [null, undefined, "ready", 1, ["/get/data/version"]]) {
        assert.deepEqual(applyInitializationFields(result, routes, {}, () => assert.fail("no field")),
            ["/run/initialization_complete"], JSON.stringify(result));
    }
    assert.deepEqual(log.mock.calls[0], ["Sidecar initialization field unavailable", "/run/initialization_complete", "expected an object"]);
});
