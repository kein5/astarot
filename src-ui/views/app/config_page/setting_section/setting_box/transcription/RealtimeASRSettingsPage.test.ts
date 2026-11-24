import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, eventTarget, fieldOf, find, findIn, hooks, loadModule, nodesIn, stubGlobals, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as languageNames from "../../../../../../logics/common/languageNames.ts";
import * as draftRebase from "../../../../../../logics/voice/draftRebase.ts";
import * as fieldErrors from "../../../../../../logics/configs/fieldErrors.ts";

// The realtime captions' form (RealtimeASRSettings.tsx) drawn with the real settings draft, which
// saves the form by itself, and the real language names. The realtime ASR and speech server hooks
// are stand-ins that hold what the test gives and record what the form sends; the shared parts are
// stand-ins that keep their props.

const t = (key: string, variables?: Record<string, unknown>) => {
    const { defaultValue, ...values } = variables ?? {};
    if (key.includes("absent")) return String(defaultValue ?? key);
    return Object.keys(values).length ? `${key} ${JSON.stringify(values)}` : key;
};
const endpoint = (name: string) => ({ cookie: 1, serial: 2, name, media_class: "Audio/Source" });
const keyOf = (value: ReturnType<typeof endpoint>) => JSON.stringify([value.cookie, value.serial, value.name, value.media_class]);
const settings = { server: "external", base_url: "http://asr.local", model: "whisper",
    mic: { endpoint: null, follow_default: true, language: "ja" }, speaker: { endpoint: null, follow_default: true, language: "en" } };
// The models of the external server, as current for the settings above.
const current = { server: "external", configured_url: "http://asr.local", base_url: "http://asr.local",
    models: [{ id: "whisper", languages: ["ja", "en"] }, { id: "qwen", languages: ["ja"], detects_language: true }] };

interface Asr {
    settings: Record<string, unknown> | null;
    state: Record<string, Record<string, unknown> | undefined>;
    endpoints: Record<string, Record<string, unknown> | undefined>;
    models: Record<string, unknown>;
    error: string | null;
    builtinVocabulary: readonly string[] | null;
}

// The pages a test opened, closed together when it ends, before the stand-in window goes.
const pagesByTest = new WeakMap<TestContext, HookRuntime[]>();
function closeWithTest(context: TestContext, runtime: HookRuntime) {
    const pages = pagesByTest.get(context);
    if (pages) { pages.push(runtime); return; }
    const opened = [runtime];
    pagesByTest.set(context, opened);
    context.onTestFinished(() => { for (const page of opened) page.unmount(); });
}

async function captionsForm(context: TestContext, given: Partial<Asr> = {}, options: { hints?: boolean; servers?: Record<string, unknown>; answer?: unknown } = {}) {
    const runtime = hooks(), sent: unknown[][] = [];
    closeWithTest(context, runtime);
    // The settings draft guards leaving a page with edits through the window.
    stubGlobals(context, { window: eventTarget() });
    const asr: Asr = { settings, state: { mic: { state: "stopped" }, speaker: { state: "stopped" } },
        endpoints: { mic: { endpoints: [{ endpoint: endpoint("Mic"), label: "Microphone" }] }, speaker: { endpoints: [{ endpoint: endpoint("Out"), label: "Speakers" }] } },
        models: current, error: null, builtinVocabulary: ["term"], ...given };
    const speech = { state: { asr: undefined, ...options.servers } as Record<string, unknown> };
    const hook = {
        send: (endpointName: string, value?: unknown): unknown => {
            sent.push(value === undefined ? [endpointName] : [endpointName, value]);
            return endpointName.startsWith("/set/") ? Promise.resolve(options.answer ?? { status: 200, result: value }) : true;
        },
        sendSpeech: (endpointName: string): unknown => { sent.push(["speech", endpointName]); return true; },
        updateError: (code: string | null) => { asr.error = code; },
    };
    const ui = { "@useI18n": { useI18n: () => ({ t, i18n: { language: "en" } }) } };
    const { useSettingsDraft } = await loadModule<typeof import("../../../../../../logics/voice/useSettingsDraft.tsx")>(new URL("../../../../../../logics/voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        ...ui, "./draftRebase": draftRebase,
        
    });
    const module = await loadModule<typeof import("./RealtimeASRSettings.tsx")>(new URL("./RealtimeASRSettings.tsx", import.meta.url), runtime, { "../../../../../../logics/configs/fieldErrors.ts": fieldErrors, "../_components/field_problem/FieldProblem": { FieldProblem: "field-problem" }, ...ui,
        "../../../../../../logics/common/languageNames.ts": languageNames,
        "../../../../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => ({ ...asr, send: hook.send, updateError: hook.updateError }) },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ state: speech.state, send: hook.sendSpeech }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => options.hints ?? false },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "./VocabularyFiles.tsx": { VocabularyFiles: "vocabulary-files" },
        "./VocabularyList.tsx": { VocabularyList: "vocabulary-list" },
    });
    const draw = () => runtime.render(module.RealtimeASRSettings);
    // The first drawing makes the draft from the saved settings; the second shows it.
    const open = () => { draw(); return draw(); };
    return { runtime, asr, speech, hook, sent, draw, open };
}

// What the form saved, in order (#1111: a choice saves at once; the next waits for its answer).
const saves = (f: { sent: unknown[][] }) => f.sent.filter(call => call[0] === "/set/data/realtime_asr_settings").map(call => call[1]);

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const ofType = (tree: unknown, type: string) => nodesIn(tree).filter(node => node.type === type);
const selectNamed = (tree: unknown, name: string) => findIn(tree, node => node.type === "select" && node.props["aria-label"] === name, `the list ${name}`);
const optionsOf = (select: TreeNode) => ofType(select, "option").map(option => [option.props.value, textOf(option)]);
const buttonNamed = (tree: unknown, words: string) => findIn(tree, node => node.type === "button" && textOf(node) === words, `the button ${words}`);
const fieldsetOf = (tree: unknown, source: string) => findIn(tree, node => node.type === "fieldset" && textOf(findIn(node, inner => inner.type === "legend")) === `realtime.${source}`, source);
// The failure lines, drawn by the form's own part: the words and the code.
const failures = (tree: unknown) => nodesIn(tree).filter(node => componentName(node) === "Failure").map(node => {
    const line = componentOf(node)(node.props);
    assert.equal(line.props.role, "alert");
    return [textOf(line).trim(), textOf(findIn(line, inner => inner.type === "code"))];
});

test("the form asks for its settings, state, built-in terms, the server's state and both sources' devices, and again on a new connection", async context => {
    const f = await captionsForm(context);
    f.open();
    assert.deepEqual(f.sent, [["/get/data/realtime_asr_settings"], ["/get/data/realtime_asr_state"], ["/get/data/builtin_vocabulary"], ["speech", "/get/data/speech_server_state"],
        ["/get/data/realtime_asr_endpoints", { source: "mic" }], ["/get/data/realtime_asr_endpoints", { source: "speaker" }], ["/get/data/realtime_asr_models"]]);
    f.sent.length = 0;
    f.draw();
    assert.deepEqual(f.sent, [], "drawn again, nothing is asked twice");
    f.hook.sendSpeech = (name: string) => { f.sent.push(["new speech", name]); return true; };
    f.draw();
    assert.deepEqual(f.sent.slice(0, 4), [["/get/data/realtime_asr_settings"], ["/get/data/realtime_asr_state"], ["/get/data/builtin_vocabulary"], ["new speech", "/get/data/speech_server_state"]]);
    // The device list is asked for again by its button too.
    f.sent.length = 0;
    buttonNamed(f.draw(), "realtime.refresh_devices").props.onClick();
    assert.deepEqual(f.sent, [["/get/data/realtime_asr_endpoints", { source: "mic" }], ["/get/data/realtime_asr_endpoints", { source: "speaker" }]]);
});

test("the models are asked for when there is an address, and again when the server, its address or the bundled server's run changes", async context => {
    const f = await captionsForm(context, { settings: { ...settings, base_url: "" } });
    f.open();
    const asked = () => f.sent.filter(call => call[0] === "/get/data/realtime_asr_models").length;
    assert.equal(asked(), 0, "no address, no models to ask for");
    f.asr.settings = { ...settings };
    f.draw();
    assert.equal(asked(), 1);
    f.draw();
    assert.equal(asked(), 1);
    f.asr.settings = { ...settings, server: "bundled" };
    f.draw();
    assert.equal(asked(), 2);
    f.speech.state = { asr: { state: "ready", base_url: "http://127.0.0.1:1", generation: 1 } };
    f.draw();
    assert.equal(asked(), 3);
    f.speech.state = { asr: { state: "ready", base_url: "http://127.0.0.1:1", generation: 2 } };
    f.draw();
    assert.equal(asked(), 4);
    f.speech.state = { asr: { state: "ready", base_url: "http://127.0.0.1:2", generation: 2 } };
    f.draw();
    assert.equal(asked(), 5);
    findIn(f.draw(), node => node.type === "form-row" && node.props.label === "realtime.model").props.actions.props.onClick();
    assert.equal(asked(), 6);
});

test("the form names its part, says what the captions are and which server they use, and what a change stops", async context => {
    const f = await captionsForm(context);
    let tree = f.open();
    assert.deepEqual([tree.type, tree.props["data-setting-id"], tree.props["aria-label"], tree.props["data-unsaved"]], ["section", "realtime_asr", "realtime.title", undefined]);
    const label = findIn(tree, node => node.type === "section-label").props;
    assert.deepEqual([label.sub, label.label, label.desc], [true, "realtime.title", "realtime.scope\nrealtime.server_help"]);
    selectNamed(tree, "realtime.model").props.onChange({ target: { value: "qwen" } });
    tree = f.draw();
    // The row marks went with the save bar (#1111): a choice saves at once.
    assert.equal(tree.props["data-unsaved"], undefined);
    assert.deepEqual(ofType(tree, "description").map(node => node.props.text).at(-1), "realtime.save_help");
});

test("an external server needs its address; the bundled one asks whether a main switch may start it", async context => {
    const f = await captionsForm(context, { settings: { ...settings, server: undefined } });
    let tree = f.open();
    const server = selectNamed(tree, "realtime.title".replace("realtime.title", "speech_servers.asr_selection"));
    assert.deepEqual([server.props.value, optionsOf(server)], ["external", [["external", "speech_servers.external"], ["bundled", "speech_servers.bundled"]]]);
    assert.equal([findIn(tree, node => node.type === "label" && find(node, inner => inner.props?.["aria-label"] === "speech_servers.asr_selection") !== null).props.children].flat()[0],
        "speech_servers.asr_selection");
    const url = findIn(tree, node => node.type === "input" && node.props["aria-label"] === "realtime.url");
    assert.deepEqual([url.props.value, url.props.readOnly], ["http://asr.local", false]);
    assert.equal([findIn(tree, node => node.type === "label" && find(node, inner => inner.props?.["aria-label"] === "realtime.url") !== null).props.children].flat()[0], "realtime.url");
    url.props.onChange({ target: { value: "http://other" } });
    assert.equal(findIn(f.draw(), node => node.type === "input" && node.props["aria-label"] === "realtime.url").props.value, "http://other");
    assert.equal(find(tree, node => node.type === "hint-check"), null);
    selectNamed(f.draw(), "speech_servers.asr_selection").props.onChange({ target: { value: "bundled" } });
    tree = f.draw();
    assert.equal(selectNamed(tree, "speech_servers.asr_selection").props.value, "bundled");
    assert.equal(find(tree, node => node.props?.["aria-label"] === "realtime.url"), null);
    const start = findIn(tree, node => node.type === "hint-check").props;
    assert.deepEqual([start.label, start.description, start.checked], ["realtime.start_server", "realtime.start_server_help", true]);
    // A choice stays usable while a save waits, so focus stays on it (#1111).
    assert.equal(start.disabled, undefined);
    start.onChange({ target: { checked: false } });
    assert.equal(findIn(f.draw(), node => node.type === "hint-check").props.checked, false);
    // The server saves at once with the address typed so far; the start switch waits for its answer.
    assert.deepEqual(saves(f).map(value => [fieldOf(value, "server"), fieldOf(value, "base_url")]), [["bundled", "http://other"]]);
});

test("the model list offers the server's models only while they are the current server's, and keeps a saved model named as unavailable", async context => {
    const listed = async (models: Record<string, unknown>, given: Partial<Asr> = {}, servers?: Record<string, unknown>) => {
        const f = await captionsForm(context, { models, ...given }, { servers });
        return optionsOf(selectNamed(f.open(), "realtime.model"));
    };
    const all = [["", "realtime.select_model"], ["whisper", "whisper"], ["qwen", "qwen"]];
    const unavailable = [["", "realtime.select_model"], ["whisper", "whisper (realtime.unavailable)"]];
    assert.deepEqual(await listed(current), all);
    assert.deepEqual(await listed({ ...current, server: "bundled" }), unavailable, "the list of another server");
    assert.deepEqual(await listed({ ...current, configured_url: "http://old" }), unavailable, "asked for another address");
    assert.deepEqual(await listed({ ...current, base_url: "http://old" }), unavailable);
    assert.deepEqual(await listed({ ...current, models: undefined }), [["", "realtime.select_model"], ["whisper", "whisper (realtime.unavailable)"]]);
    // The bundled server: its models while it runs at the address it answered from, in this run.
    const bundled = { ...settings, server: "bundled" };
    const fromBundled = { ...current, server: "bundled", base_url: "http://127.0.0.1:1", server_generation: 3 };
    const running = { asr: { state: "ready", base_url: "http://127.0.0.1:1", generation: 3 } };
    assert.deepEqual(await listed(fromBundled, { settings: bundled }, running), all);
    assert.deepEqual(await listed(fromBundled, { settings: bundled }, { asr: { ...running.asr, state: "starting" } }), unavailable);
    assert.deepEqual(await listed(fromBundled, { settings: bundled }, { asr: { ...running.asr, base_url: "http://127.0.0.1:2" } }), unavailable);
    assert.deepEqual(await listed(fromBundled, { settings: bundled }, { asr: { ...running.asr, generation: 4 } }), unavailable);
    assert.deepEqual(await listed(fromBundled, { settings: bundled }), unavailable, "no bundled server state yet");
    // No model saved: nothing marked unavailable.
    assert.deepEqual(await listed({ ...current, models: [] }, { settings: { ...settings, model: "" } }), [["", "realtime.select_model"]]);
    const f = await captionsForm(context);
    const tree = f.open();
    const row = findIn(tree, node => node.type === "form-row" && node.props.label === "realtime.model").props;
    assert.deepEqual([row.description, textOf(row.actions)], ["realtime.auto_help", "realtime.refresh_models"]);
    selectNamed(tree, "realtime.model").props.onChange({ target: { value: "qwen" } });
    assert.equal(selectNamed(f.draw(), "realtime.model").props.value, "qwen");
});

test("a failure to list the models, a device or a source is said in the toggles' words with its code, and the form's own error under it", async context => {
    const f = await captionsForm(context, { models: { ...current, error_code: "models_unreachable" }, error: "absent_code",
        endpoints: { mic: { endpoints: [], error_code: "mic_missing" }, speaker: { endpoints: [] } }, state: { mic: { state: "failed" }, speaker: { state: "failed", error_code: "speaker_failed" } } });
    const tree = f.open();
    assert.deepEqual(failures(tree), [["realtime_toggle.models_unreachable models_unreachable", "models_unreachable"], ["realtime_toggle.mic_missing mic_missing", "mic_missing"],
        ["realtime_toggle.speaker_failed speaker_failed", "speaker_failed"], ["absent_code", "absent_code"]]);
    const clean = await captionsForm(context);
    assert.deepEqual(failures(clean.open()), []);
});

test("how long a silence ends a caption and how loud speech must be are chosen from lists, keeping a saved value off the list", async context => {
    const f = await captionsForm(context, { settings: { ...settings, silence_duration_ms: 450, vad_threshold: 0.35 } });
    const tree = f.open();
    const silenceRow = findIn(tree, node => node.type === "form-row" && node.props.label === "realtime.silence").props;
    assert.equal(silenceRow.description, "realtime.silence_help");
    assert.deepEqual(optionsOf(selectNamed(tree, "realtime.silence")), [["", "realtime.silence_default"], [450, `realtime.silence_seconds {"seconds":0.45}`],
        [300, `realtime.silence_seconds {"seconds":0.3}`], [500, `realtime.silence_seconds {"seconds":0.5}`], [700, `realtime.silence_seconds {"seconds":0.7}`],
        [1000, `realtime.silence_seconds {"seconds":1}`]]);
    const thresholdRow = findIn(tree, node => node.type === "form-row" && node.props.label === "realtime.vad_threshold").props;
    assert.equal(thresholdRow.description, "realtime.vad_threshold_help");
    assert.deepEqual(optionsOf(selectNamed(tree, "realtime.vad_threshold")), [["", "realtime.vad_threshold_default"], [0.35, "0.35"], [0.2, "0.2"], [0.3, "0.3"], [0.4, "0.4"],
        [0.5, "0.5"], [0.6, "0.6"], [0.7, "0.7"]]);
    const onList = await captionsForm(context, { settings: { ...settings, silence_duration_ms: 700, vad_threshold: 0.4 } });
    const shown = onList.open();
    assert.equal(optionsOf(selectNamed(shown, "realtime.silence")).length, 5);
    assert.equal(optionsOf(selectNamed(shown, "realtime.vad_threshold")).length, 7);
    const unset = await captionsForm(context);
    assert.equal(optionsOf(selectNamed(unset.open(), "realtime.vad_threshold")).length, 7, "nothing saved: no extra choice");
});

test("each source follows the system's device or one chosen, keeps a lost one named, and says what following does", async context => {
    const f = await captionsForm(context, { settings: { ...settings, speaker: { endpoint: endpoint("Gone"), follow_default: false, language: "en" } } });
    let tree = f.open();
    const mic = fieldsetOf(tree, "mic");
    const micRow = findIn(mic, node => node.type === "form-row").props;
    assert.deepEqual([micRow.label, micRow.description], ["realtime.mic_input", "realtime.follow_default_help"]);
    const micList = selectNamed(mic, "realtime.mic_input");
    assert.equal(micList.props.value, "follow-default");
    assert.deepEqual(optionsOf(micList), [["", "realtime.select_device"], ["follow-default", "realtime.follow_default_mic"], [keyOf(endpoint("Mic")), "Microphone"]]);
    const speaker = fieldsetOf(tree, "speaker");
    const speakerRow = findIn(speaker, node => node.type === "form-row").props;
    assert.deepEqual([speakerRow.label, speakerRow.description], ["realtime.speaker_input", "realtime.speaker_help"]);
    const speakerList = selectNamed(speaker, "realtime.speaker_input");
    assert.equal(speakerList.props.value, keyOf(endpoint("Gone")));
    assert.deepEqual(optionsOf(speakerList), [["", "realtime.select_device"], ["follow-default", "realtime.follow_default_speaker"], [keyOf(endpoint("Gone")), "realtime.disconnected"],
        [keyOf(endpoint("Out")), "Speakers"]]);
    speakerList.props.onChange({ target: { value: keyOf(endpoint("Out")) } });
    tree = f.draw();
    assert.deepEqual(optionsOf(selectNamed(fieldsetOf(tree, "speaker"), "realtime.speaker_input")).map(option => option[0]), ["", "follow-default", keyOf(endpoint("Out"))]);
    selectNamed(fieldsetOf(tree, "mic"), "realtime.mic_input").props.onChange({ target: { value: keyOf(endpoint("Mic")) } });
    selectNamed(fieldsetOf(f.draw(), "speaker"), "realtime.speaker_input").props.onChange({ target: { value: "follow-default" } });
    tree = f.draw();
    assert.equal(selectNamed(fieldsetOf(tree, "mic"), "realtime.mic_input").props.value, keyOf(endpoint("Mic")));
    assert.equal(findIn(fieldsetOf(tree, "mic"), node => node.type === "form-row").props.description, undefined, "a chosen device needs no word on following");
    assert.equal(selectNamed(fieldsetOf(tree, "speaker"), "realtime.speaker_input").props.value, "follow-default");
    assert.equal(findIn(fieldsetOf(tree, "speaker"), node => node.type === "form-row").props.description, "realtime.speaker_help\nrealtime.follow_default_help");
    // The first choice saved at once; the others wait for its answer.
    assert.deepEqual(saves(f).map(value => fieldOf(value, "speaker", "endpoint")), [endpoint("Out")]);
    // A device chosen that is not in the list (it went while the list was open) is saved as none.
    selectNamed(fieldsetOf(tree, "mic"), "realtime.mic_input").props.onChange({ target: { value: "[9]" } });
    tree = f.draw();
    assert.equal(selectNamed(fieldsetOf(tree, "mic"), "realtime.mic_input").props.value, "");
    // A device list not known yet: only the two fixed choices.
    const none = await captionsForm(context, { endpoints: {} });
    assert.deepEqual(optionsOf(selectNamed(fieldsetOf(none.open(), "mic"), "realtime.mic_input")).map(option => option[0]), ["", "follow-default"]);
});

test("each source's language is one the model reads, with automatic detection where the model has it, and a saved other one stays named", async context => {
    const f = await captionsForm(context, { settings: { ...settings, mic: { ...settings.mic, language: "fr" } } });
    let tree = f.open();
    const mic = selectNamed(fieldsetOf(tree, "mic"), "realtime.mic_language");
    assert.deepEqual(optionsOf(mic), [["fr", "French"], ["ja", "Japanese"], ["en", "English"]]);
    assert.equal([findIn(fieldsetOf(tree, "mic"), node => node.type === "label").props.children].flat()[0], "realtime.mic_language");
    assert.deepEqual(optionsOf(selectNamed(fieldsetOf(tree, "speaker"), "realtime.speaker_language")), [["ja", "Japanese"], ["en", "English"]]);
    mic.props.onChange({ target: { value: "en" } });
    assert.equal(selectNamed(fieldsetOf(f.draw(), "mic"), "realtime.mic_language").props.value, "en");
    selectNamed(f.draw(), "realtime.model").props.onChange({ target: { value: "qwen" } });
    tree = f.draw();
    assert.deepEqual(optionsOf(selectNamed(fieldsetOf(tree, "speaker"), "realtime.speaker_language")), [["en", "English"], ["auto", "realtime.auto_language"], ["ja", "Japanese"]]);
    assert.deepEqual(saves(f).map(value => fieldOf(value, "mic", "language")), ["en"]);
    // No model known: only the saved language.
    const unknown = await captionsForm(context, { models: {} });
    assert.deepEqual(optionsOf(selectNamed(fieldsetOf(unknown.open(), "mic"), "realtime.mic_language")), [["ja", "Japanese"]]);
});

test("Start waits for a saved form, a device, a model, a language it reads and a source that can start; Stop always asks", async context => {
    const blocked = async (given: Partial<Asr> = {}, edit?: (f: Awaited<ReturnType<typeof captionsForm>>) => void) => {
        const f = await captionsForm(context, given);
        f.open();
        edit?.(f);
        return buttonNamed(fieldsetOf(f.draw(), "mic"), "realtime.start_mic").props.disabled;
    };
    assert.equal(await blocked(), false);
    assert.equal(await blocked({}, f => selectNamed(f.draw(), "realtime.silence").props.onChange({ target: { value: "300" } })), true, "edits to save first");
    assert.equal(await blocked({ settings: { ...settings, mic: { endpoint: endpoint("Gone"), follow_default: false, language: "ja" } } }), true, "a lost device");
    assert.equal(await blocked({ settings: { ...settings, mic: { endpoint: null, follow_default: false, language: "ja" } } }), true, "no device");
    assert.equal(await blocked({ models: { ...current, models: [] } }), true, "no model");
    assert.equal(await blocked({ settings: { ...settings, mic: { ...settings.mic, language: "fr" } } }), true, "a language the model does not read");
    assert.equal(await blocked({ state: {} }), true, "the source's state not known");
    assert.equal(await blocked({ state: { mic: { state: "starting", requested: true } } }), true, "already asked");
    assert.equal(await blocked({ endpoints: { mic: { endpoints: [], error_code: "lost" } } }), true, "the devices could not be listed");
    const f = await captionsForm(context);
    const tree = f.open();
    const mic = fieldsetOf(tree, "mic");
    buttonNamed(mic, "realtime.start_mic").props.onClick();
    buttonNamed(mic, "realtime.stop_mic").props.onClick();
    buttonNamed(fieldsetOf(tree, "speaker"), "realtime.stop_speaker").props.onClick();
    assert.deepEqual(f.sent.slice(-3), [["/run/start_realtime_asr", { source: "mic" }], ["/run/stop_realtime_asr", { source: "mic" }], ["/run/stop_realtime_asr", { source: "speaker" }]]);
});

test("each source's state is read out with the tone of that state", async context => {
    const cases: [Record<string, unknown> | undefined, string, string][] = [[{ state: "ready" }, "active", "realtime.state_ready"], [{ state: "failed" }, "failed", "realtime.state_failed"],
        [{ state: "starting" }, "warning", "realtime.state_starting"], [{ state: "stopping" }, "warning", "realtime.state_stopping"],
        [{ state: "stopped" }, "neutral", "realtime.state_stopped"], [undefined, "neutral", "realtime.state_unknown"], [{}, "neutral", "realtime.state_unknown"]];
    for (const [state, tone, words] of cases) {
        const f = await captionsForm(context, { state: { mic: state } });
        const readout = findIn(fieldsetOf(f.open(), "mic"), node => node.type === "readout");
        assert.deepEqual([readout.props.tone, textOf(readout)], [tone, words], JSON.stringify(state));
    }
});

test("the dictionary's built-in terms can be left out, and its help is the legend's hint on a page that keeps descriptions out of sight", async context => {
    const unsaved = await captionsForm(context, { settings: { ...settings, vocabulary: undefined } });
    assert.deepEqual(findIn(unsaved.open(), node => node.type === "vocabulary-list").props.vocabulary, { builtin: true, terms: [] }, "nothing saved: the built-in terms and no others");
    const f = await captionsForm(context, { settings: { ...settings, vocabulary: { terms: [] } } });
    let tree = f.open();
    const dictionary = findIn(tree, node => node.type === "fieldset" && find(node, inner => inner.type === "vocabulary-list") !== null);
    assert.deepEqual(ofType(dictionary, "description").map(node => node.props.text), ["realtime.vocabulary_help"]);
    assert.equal(find(dictionary, node => node.props?.["data-hint-host"] !== undefined), null);
    const builtin = findIn(dictionary, node => node.type === "input" && node.props.type === "checkbox");
    assert.equal(builtin.props.checked, true);
    assert.equal(textOf(findIn(dictionary, node => node.type === "label")), "realtime.vocabulary_builtin");
    builtin.props.onChange({ target: { checked: false } });
    tree = f.draw();
    assert.equal(findIn(tree, node => node.type === "input" && node.props.type === "checkbox").props.checked, false);
    assert.deepEqual(findIn(tree, node => node.type === "vocabulary-list").props.vocabulary, { terms: [], builtin: false });
    assert.deepEqual(saves(f).map(value => fieldOf(value, "vocabulary")), [{ terms: [], builtin: false }]);
    const hinted = await captionsForm(context, {}, { hints: true });
    const legend = findIn(hinted.open(), node => node.props?.["data-hint-host"] === true);
    assert.equal(textOf(legend), "realtime.vocabulary");
    assert.deepEqual([findIn(legend, node => node.type === "hint").props.text, findIn(legend, node => node.type === "hint").props.focusable], ["realtime.vocabulary_help", true]);
});

test("a choice saves at once with no Save button, and nothing is sent again while a save waits", async context => {
    const f = await captionsForm(context);
    let tree = f.open();
    assert.equal(find(tree, node => node.type === "button" && node.props.type === "submit"), null, "no Save button");
    let prevented = 0;
    findIn(tree, node => node.type === "form").props.onSubmit({ preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(saves(f).length, 0, "nothing to save");
    selectNamed(tree, "realtime.vad_threshold").props.onChange({ target: { value: "0.5" } });
    f.draw();
    assert.deepEqual(f.sent.at(-1), ["/set/data/realtime_asr_settings", { ...settings, vad_threshold: 0.5 }]);
    tree = f.draw();
    assert.equal(findIn(tree, node => node.type === "form").props["aria-busy"], true);
    findIn(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(saves(f).length, 1);
});
