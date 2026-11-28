import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { EngineVoices, VoiceSettings } from "../../../../../../logics/voice/useVoice.ts";
import type { TtsDraftSetter, TtsEngineId } from "./TtsEngine.tsx";

interface Options {
    draft: VoiceSettings;
    saved?: VoiceSettings | null;
    engineVoices?: EngineVoices | null;
    // The words as a language would write them, with the values put in; the keys alone by default.
    translate?: (key: string, values?: object) => string;
}

// The engine part of the TTS page (ADR-008), with the voice hook and the readout stubbed.
async function setup({ draft, saved = draft, engineVoices = null, translate }: Options) {
    const runtime = hooks();
    const sent: [string, unknown][] = [];
    const state: { draft: VoiceSettings } = { draft: { ...draft } };
    const { TtsEngine, CoeiroinkOptions, AudioQueryOptions, validCoeiroinkOptions, validAudioQueryOptions, COEIROINK_DEFAULTS } = await loadModule<typeof import("./TtsEngine.tsx")>(new URL("./TtsEngine.tsx", import.meta.url), runtime, {
        ...(translate ? { "@useI18n": { useI18n: () => ({ t: translate }) } } : {}),
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: async () => {} },
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ engineVoices, send: (endpoint: string, data: unknown) => sent.push([endpoint, data]) }) },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/description/Description": { Description: "description" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
    });
    // Every edit of the page spreads the draft into a new one, so the draft it sets is always there.
    const setDraft: TtsDraftSetter = update => {
        const next = typeof update === "function" ? update(state.draft) : update;
        assert.ok(next, "the page sets a draft");
        state.draft = next;
    };
    const render = () => runtime.render(TtsEngine, { draft: state.draft, setDraft, saved });
    // The harness does not render nested components: the COEIROINK part renders on its own.
    const coeiroink = hooks();
    const renderCoeiroink = () => coeiroink.render(CoeiroinkOptions, { draft: state.draft, setDraft });
    const scales = hooks();
    const renderScales = (engine: TtsEngineId) => scales.render(AudioQueryOptions, { engine, draft: state.draft, setDraft });
    const unmount = () => { runtime.unmount(); coeiroink.unmount(); scales.unmount(); };
    return { runtime: { unmount }, sent, state, render, renderCoeiroink, renderScales, CoeiroinkOptions, AudioQueryOptions,
        validCoeiroinkOptions, validAudioQueryOptions, COEIROINK_DEFAULTS };
}

const selects = (tree: unknown) => nodesIn(tree).filter(node => node.type === kitStandIns.Select);
const options = (node: unknown) => nodesIn(node).filter(child => child.type === kitStandIns.SelectOption);

const voicevox = { japanese_engine: "voicevox", voicevox_url: "http://127.0.0.1:50021",
    engine_voice_id: "3", engine_voice_speaker: "ずんだもん", engine_voice_style: "ノーマル" };
const connected = { engine: "voicevox", connected: true, version: "0.25.0", pending: false, voices: [
    { id: "2", speaker: "四国めたん", style: "ノーマル" }, { id: "3", speaker: "ずんだもん", style: "ノーマル" },
    { id: "1", speaker: "ずんだもん", style: "あまあま" }] };

test("with speech.cpp chosen the part is only the engine choice and checks nothing", async () => {
    const s = await setup({ draft: { japanese_engine: "speechcpp" } });
    const tree = s.render();
    assert.equal(selects(tree).length, 1);
    assert.deepEqual(options(selects(tree)[0]).map(option => option.props.value), ["speechcpp", "voicevox", "coeiroink", "aivis", "sharevox"]);
    assert.deepEqual(s.sent, []);
    s.runtime.unmount();
});

test("an installed engine is checked at once, and its voices are grouped by speaker", async () => {
    const s = await setup({ draft: voicevox, engineVoices: connected });
    const tree = s.render();
    assert.deepEqual(s.sent, [["/get/data/tts_engine_voices", { engine: "voicevox", url: "http://127.0.0.1:50021" }]]);
    const voice = selects(tree)[1];
    const groups: unknown[] = [];
    find(voice, node => { if (node.type === kitStandIns.SelectOptGroup) groups.push(node.props.label); return false; });
    assert.deepEqual(groups, ["四国めたん", "ずんだもん"]);
    assert.equal(voice.props.value, "3");
    // The saved voice is in the list, so it is not repeated as a saved-only entry.
    assert.equal(options(voice).filter(option => option.props.value === "3").length, 1);
    voice.props.onChange({ target: { value: "1" } });
    assert.deepEqual([s.state.draft.engine_voice_id, s.state.draft.engine_voice_speaker, s.state.draft.engine_voice_style], ["1", "ずんだもん", "あまあま"]);
    s.runtime.unmount();
});

test("another engine clears the voice, and the saved engine brings its saved voice back", async () => {
    const s = await setup({ draft: voicevox, engineVoices: connected });
    const engine = selects(s.render())[0];
    engine.props.onChange({ target: { value: "coeiroink" } });
    assert.deepEqual([s.state.draft.japanese_engine, s.state.draft.engine_voice_id, s.state.draft.engine_voice_speaker], ["coeiroink", "", ""]);
    selects(s.render())[0].props.onChange({ target: { value: "voicevox" } });
    assert.deepEqual([s.state.draft.engine_voice_id, s.state.draft.engine_voice_speaker, s.state.draft.engine_voice_style], ["3", "ずんだもん", "ノーマル"]);
    s.runtime.unmount();
});

test("only COEIROINK shows how it reads, starting from the values sent before they could be set", async () => {
    const s = await setup({ draft: voicevox, engineVoices: connected });
    assert.ok(!find(s.render(), node => node.type === s.CoeiroinkOptions));
    s.runtime.unmount();
    // A file saved before these fields has none of them: the page shows the defaults.
    const c = await setup({ draft: { japanese_engine: "coeiroink", coeiroink_url: "http://127.0.0.1:50032" } });
    assert.ok(find(c.render(), node => node.type === c.CoeiroinkOptions));
    const tree = c.renderCoeiroink();
    assert.ok(find(tree, node => node.type === "setup"));
    const numbers: TreeNode[] = [];
    find(tree, node => { if (node.type === kitStandIns.TextField && node.props.type === "number") numbers.push(node); return false; });
    assert.deepEqual(numbers.map(node => node.props.value), ["1.0", "1.0", "0.0", "1.0", "0.1", "0.1"]);
    assert.ok(numbers.every(node => node.props.invalid === false));
    const rate = selects(tree).find(node => node.props.value === "24000");
    assert.ok(rate);
    assert.deepEqual(options(rate).map(option => option.props.value), ["16000", "24000", "44100", "48000"]);
    numbers[0].props.onChange({ target: { value: "1.5" } });
    rate.props.onChange({ target: { value: "48000" } });
    assert.deepEqual([c.state.draft.coeiroink_speed, c.state.draft.coeiroink_sampling_rate], ["1.5", "48000"]);
    // Restoring the defaults is an edit of the draft (the page saves it at once, #1111).
    const reset = findIn(c.renderCoeiroink(), node => node.type === kitStandIns.Button && node.props.children === "voice_ui.engine.coeiroink.reset");
    assert.equal(reset.props.disabled, false);
    reset.props.onClick();
    assert.deepEqual([c.state.draft.coeiroink_speed, c.state.draft.coeiroink_sampling_rate], ["1.0", "24000"]);
    c.runtime.unmount();
});

test("COEIROINK numbers outside the core's ranges cannot be saved", async () => {
    const s = await setup({ draft: { japanese_engine: "coeiroink" } });
    const valid = (draft: VoiceSettings) => s.validCoeiroinkOptions({ ...s.COEIROINK_DEFAULTS, ...draft });
    assert.equal(s.validCoeiroinkOptions({}), true, "settings saved before these fields");
    assert.equal(valid({ coeiroink_speed: "2", coeiroink_pitch: "-0.15", coeiroink_post_phoneme: "1.5" }), true);
    for (const bad of [{ coeiroink_speed: "0.4" }, { coeiroink_speed: "" }, { coeiroink_speed: "1e0" }, { coeiroink_volume: "-0.1" },
        { coeiroink_pitch: "0.2" }, { coeiroink_intonation: "2.5" }, { coeiroink_pre_phoneme: "1.6" }, { coeiroink_sampling_rate: "22050" }])
        assert.equal(valid(bad), false, JSON.stringify(bad));
    s.runtime.unmount();
});

test("VOICEVOX, AivisSpeech and SHAREVOX each show their own reading, from the engine's own values", async () => {
    const s = await setup({ draft: voicevox, engineVoices: connected });
    const shown = findIn(s.render(), node => node.type === s.AudioQueryOptions);
    assert.equal(shown.props.engine, "voicevox");
    assert.ok(!find(s.render(), node => node.type === s.CoeiroinkOptions));
    // A file saved before these fields has none of them: the page shows the engine's defaults.
    const numbers = (tree: unknown) => {
        const found: TreeNode[] = [];
        find(tree, node => { if (node.type === kitStandIns.TextField && node.props.type === "number") found.push(node); return false; });
        return found;
    };
    const fields = numbers(s.renderScales("voicevox"));
    assert.deepEqual(fields.map(node => node.props.value), ["1.0", "1.0", "0.0", "1.0"]);
    assert.ok(fields.every(node => node.props.invalid === false));
    fields[0].props.onChange({ target: { value: "1.25" } });
    assert.equal(s.state.draft.voicevox_speed, "1.25");
    // AivisSpeech keeps its own values: VOICEVOX's speed is not AivisSpeech's.
    assert.equal(numbers(s.renderScales("aivis"))[0].props.value, "1.0");
    const reset = findIn(s.renderScales("voicevox"), node => node.type === kitStandIns.Button && node.props.children === "voice_ui.engine.audio_query.reset");
    assert.equal(reset.props.disabled, false);
    reset.props.onClick();
    assert.equal(s.state.draft.voicevox_speed, "1.0");
    s.runtime.unmount();
    const c = await setup({ draft: { japanese_engine: "coeiroink" } });
    assert.ok(!find(c.render(), node => node.type === c.AudioQueryOptions), "COEIROINK has its own fields");
    c.runtime.unmount();
});

test("VOICEVOX API numbers outside the core's ranges cannot be saved", async () => {
    const s = await setup({ draft: voicevox });
    assert.equal(s.validAudioQueryOptions({}), true, "settings saved before these fields");
    assert.equal(s.validAudioQueryOptions({ voicevox_speed: "2", aivis_pitch: "-0.15", sharevox_intonation: "0" }), true);
    for (const bad of [{ voicevox_speed: "0.4" }, { voicevox_speed: "" }, { aivis_speed: "1e0" }, { aivis_volume: "-0.1" },
        { sharevox_pitch: "0.2" }, { sharevox_intonation: "2.5" }])
        assert.equal(s.validAudioQueryOptions(bad), false, JSON.stringify(bad));
    s.runtime.unmount();
});

test("an engine that does not answer keeps the saved voice visible and says it is not connected", async () => {
    const s = await setup({ draft: voicevox, engineVoices: { engine: "voicevox", connected: false, pending: false, voices: [], error_code: "tts_engine_not_ready" } });
    const tree = s.render();
    const voice = selects(tree)[1];
    assert.deepEqual(options(voice).map(option => option.props.value), ["", "3"]);
    const readout = findIn(tree, node => node.type === "readout");
    assert.equal(readout.props.tone, "warning");
    assert.equal(readout.props.progress, undefined);
    s.runtime.unmount();
});

// #614: what an engine's reading values are is the fold's description (its title's hint on a
// reviewed page); the voices' credit terms stay in sight under the engine's fields.
test("the reading folds carry their description; the credit stays a paragraph", async () => {
    const s = await setup({ draft: voicevox, engineVoices: connected });
    assert.equal(s.renderScales("voicevox").props.desc, "voice_ui.engine.audio_query.description");
    assert.equal(s.renderCoeiroink().props.desc, "voice_ui.engine.coeiroink.description");
    for (const tree of [s.renderScales("voicevox"), s.renderCoeiroink()]) assert.ok(!find(tree, node => node.type === "description"));
    assert.ok(find(s.render(), node => node.type === "description" && node.props.text === "voice_ui.engine.credit.voicevox"));
    s.runtime.unmount();
});

// The engine's URL is the kit's monospaced field in a named row with its hint; Check again is the
// kit's plain button, which waits only while an answer to a check is on its way.
test("the engine's URL and Check again are the kit's parts", async () => {
    for (const [voices, disabled] of [[connected, false], [{ ...connected, pending: true }, true], [null, false]] as const) {
        const s = await setup({ draft: voicevox, engineVoices: voices });
        const row = findIn(s.render(), node => node.type === "row" && node.props.label === "voice_ui.engine.url");
        assert.equal(row.props.description, "voice_ui.engine.url_hint");
        const url = findIn(row, node => node.type === kitStandIns.TextField);
        assert.deepEqual([url.props.mono, url.props["aria-label"], url.props.value, url.props.spellCheck],
            [true, "voice_ui.engine.url", "http://127.0.0.1:50021", false]);
        const recheck = row.props.actions;
        assert.deepEqual([recheck.type, recheck.props.children, recheck.props.disabled], [kitStandIns.Button, "voice_ui.engine.recheck", disabled]);
        recheck.props.onClick();
        assert.deepEqual(s.sent.at(-1), ["/get/data/tts_engine_voices", { engine: "voicevox", url: "http://127.0.0.1:50021" }]);
        url.props.onChange({ target: { value: "http://127.0.0.1:50022" } });
        assert.equal(s.state.draft.voicevox_url, "http://127.0.0.1:50022");
        s.runtime.unmount();
    }
});

test("a number out of its range is marked invalid and points at the error", async () => {
    const s = await setup({ draft: { japanese_engine: "voicevox", voicevox_url: "http://127.0.0.1:50021", voicevox_speed: "99" } });
    const fields: TreeNode[] = [];
    find(s.renderScales("voicevox"), node => { if (node.type === kitStandIns.TextField) fields.push(node); return false; });
    assert.deepEqual(fields.map(field => field.props.invalid), [true, false, false, false]);
    assert.ok(fields[0].props["aria-describedby"]);
    assert.equal(fields[1].props["aria-describedby"], undefined);
    assert.ok(fields.every(field => field.props.placeholder === "voice_ui.example"));
    s.runtime.unmount();
});

test("the engine's lists are the kit's Select with the kit's options and groups, named as before", async () => {
    // D-14 (decided on 2026-11-25): the settings' select fields are the kit's Select.
    const translate = (key: string, values?: object) => values ? `${key} ${JSON.stringify(values)}` : key;
    const native = (tree: unknown) => nodesIn(tree).filter(node => node.type === "select" || node.type === "option" || node.type === "optgroup");
    const labelOf = (tree: unknown, select: TreeNode) => [findIn(tree, node => node.type === "label"
        && find(node, inner => inner.type === kitStandIns.Select && inner.props["aria-label"] === select.props["aria-label"]) !== null).props.children].flat()[0];
    const texts = (node: unknown) => options(node).map(option => [option.props.value, [option.props.children].flat().join("")]);
    // AI voice: the row says what the engine needs and offers speech.cpp first.
    const ai = await setup({ draft: { japanese_engine: "speechcpp" }, translate });
    let tree = ai.render();
    const row = findIn(tree, node => node.type === "row");
    assert.deepEqual([row.props.label, row.props.description], ["voice_ui.engine.label", "voice_ui.engine.description_speechcpp"]);
    assert.deepEqual(texts(selects(tree)[0])[0], ["speechcpp", "voice_ui.engine.speechcpp"]);
    ai.runtime.unmount();
    // An installed engine: its voices under their speakers, each speaker with only its own styles.
    const s = await setup({ draft: { ...voicevox, japanese_engine: "coeiroink", coeiroink_url: "http://127.0.0.1:50032" }, engineVoices: { ...connected, engine: "coeiroink" }, translate });
    tree = s.render();
    assert.equal(findIn(tree, node => node.type === "row").props.description, "voice_ui.engine.description");
    assert.deepEqual(selects(tree).map(node => node.props["aria-label"]), ["voice_ui.engine.label", "voice_ui.engine.voice"]);
    const voice = selects(tree)[1];
    assert.equal(labelOf(tree, voice), "voice_ui.engine.voice");
    assert.deepEqual(texts(voice)[0], ["", "voice_ui.engine.voice_unset"]);
    assert.deepEqual(nodesIn(voice).filter(node => node.type === kitStandIns.SelectOptGroup).map(group => [group.props.label, options(group).map(option => option.props.value)]),
        [["四国めたん", ["2"]], ["ずんだもん", ["3", "1"]]]);
    // COEIROINK's sampling rate, each rate in the words of the language.
    const coeiroink = s.renderCoeiroink();
    const rate = selects(coeiroink)[0];
    assert.deepEqual([rate.props["aria-label"], labelOf(coeiroink, rate)], ["voice_ui.engine.coeiroink.coeiroink_sampling_rate", "voice_ui.engine.coeiroink.coeiroink_sampling_rate"]);
    assert.deepEqual(texts(rate)[0], ["16000", 'voice_ui.engine.coeiroink.rate_option {"rate":"16000"}']);
    assert.deepEqual([...native(tree), ...native(coeiroink)], []);
    s.runtime.unmount();
    // No voice chosen: the list shows "not set"; a saved voice the engine does not list is named.
    const unset = await setup({ draft: { japanese_engine: "voicevox", voicevox_url: "http://127.0.0.1:50021" }, engineVoices: connected, translate });
    assert.equal(selects(unset.render())[1].props.value, "");
    unset.runtime.unmount();
    const gone = await setup({ draft: { ...voicevox, engine_voice_id: "9", engine_voice_style: "ささやき" }, engineVoices: connected, translate });
    assert.deepEqual(texts(selects(gone.render())[1])[1], ["9", 'voice_ui.engine.voice_saved {"speaker":"ずんだもん","style":"ささやき"}']);
    gone.runtime.unmount();
});
