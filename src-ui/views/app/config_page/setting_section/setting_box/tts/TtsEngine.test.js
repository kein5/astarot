import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";

// The engine part of the TTS page (ADR-008), with the voice hook and the readout stubbed.
async function setup({ draft, saved = draft, engineVoices = null }) {
    const runtime = hooks();
    const sent = [];
    const state = { draft: { ...draft } };
    const { TtsEngine, CoeiroinkOptions, validCoeiroinkOptions, COEIROINK_DEFAULTS } = await loadModule(new URL("./TtsEngine.jsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: async () => {} },
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ engineVoices, send: (endpoint, data) => sent.push([endpoint, data]) }) },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/description/Description": { Description: "description" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
    });
    const setDraft = update => { state.draft = typeof update === "function" ? update(state.draft) : update; };
    const render = () => runtime.render(TtsEngine, { draft: state.draft, setDraft, saved });
    // The harness does not render nested components: the COEIROINK part renders on its own.
    const coeiroink = hooks();
    const renderCoeiroink = () => coeiroink.render(CoeiroinkOptions, { draft: state.draft, setDraft });
    const unmount = () => { runtime.unmount(); coeiroink.unmount(); };
    return { runtime: { unmount }, sent, state, render, renderCoeiroink, CoeiroinkOptions, validCoeiroinkOptions, COEIROINK_DEFAULTS };
}

const selects = tree => {
    const found = [];
    find(tree, node => { if (node.type === "select") found.push(node); return false; });
    return found;
};
const options = node => {
    const found = [];
    find(node, child => { if (child.type === "option") found.push(child); return false; });
    return found;
};

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
    const groups = [];
    find(voice, node => { if (node.type === "optgroup") groups.push(node.props.label); return false; });
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
    const numbers = [];
    find(tree, node => { if (node.type === "input" && node.props.type === "number") numbers.push(node); return false; });
    assert.deepEqual(numbers.map(node => node.props.value), ["1.0", "1.0", "0.0", "1.0", "0.1", "0.1"]);
    assert.ok(numbers.every(node => node.props["aria-invalid"] === false));
    const rate = selects(tree).find(node => node.props.value === "24000");
    assert.deepEqual(options(rate).map(option => option.props.value), ["16000", "24000", "44100", "48000"]);
    numbers[0].props.onChange({ target: { value: "1.5" } });
    rate.props.onChange({ target: { value: "48000" } });
    assert.deepEqual([c.state.draft.coeiroink_speed, c.state.draft.coeiroink_sampling_rate], ["1.5", "48000"]);
    // Restoring the defaults is an edit for the save bar, like any other.
    const reset = find(c.renderCoeiroink(), node => node.type === "button" && node.props.children === "voice_ui.engine.coeiroink.reset");
    assert.equal(reset.props.disabled, false);
    reset.props.onClick();
    assert.deepEqual([c.state.draft.coeiroink_speed, c.state.draft.coeiroink_sampling_rate], ["1.0", "24000"]);
    c.runtime.unmount();
});

test("COEIROINK numbers outside the core's ranges cannot be saved", async () => {
    const s = await setup({ draft: { japanese_engine: "coeiroink" } });
    const valid = draft => s.validCoeiroinkOptions({ ...s.COEIROINK_DEFAULTS, ...draft });
    assert.equal(s.validCoeiroinkOptions({}), true, "settings saved before these fields");
    assert.equal(valid({ coeiroink_speed: "2", coeiroink_pitch: "-0.15", coeiroink_post_phoneme: "1.5" }), true);
    for (const bad of [{ coeiroink_speed: "0.4" }, { coeiroink_speed: "" }, { coeiroink_speed: "1e0" }, { coeiroink_volume: "-0.1" },
        { coeiroink_pitch: "0.2" }, { coeiroink_intonation: "2.5" }, { coeiroink_pre_phoneme: "1.6" }, { coeiroink_sampling_rate: "22050" }])
        assert.equal(valid(bad), false, JSON.stringify(bad));
    s.runtime.unmount();
});

test("an engine that does not answer keeps the saved voice visible and says it is not connected", async () => {
    const s = await setup({ draft: voicevox, engineVoices: { engine: "voicevox", connected: false, pending: false, voices: [], error_code: "tts_engine_not_ready" } });
    const tree = s.render();
    const voice = selects(tree)[1];
    assert.deepEqual(options(voice).map(option => option.props.value), ["", "3"]);
    const readout = find(tree, node => node.type === "readout");
    assert.equal(readout.props.tone, "warning");
    assert.equal(readout.props.progress, undefined);
    s.runtime.unmount();
});
