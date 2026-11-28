import assert from "node:assert/strict";
import { test } from "vitest";
import { activeSwitchBlock, switchBlocks } from "./switchBlocks.ts";
import type { SwitchBlocks, SwitchDirectSettings, SwitchDirectState, SwitchVoiceSettings } from "./switchBlocks.ts";

const reasons = (blocks: SwitchBlocks) => Object.fromEntries(Object.entries(blocks).map(([id, block]) => [id, block?.reason]));
const rvc = (values?: SwitchDirectSettings): SwitchDirectSettings => ({ mode: "converted", engine: "rvc", rvc_runtime: "/r/python", rvc_model: "/m/voice.pth", ...values });
const direct = (settings: SwitchDirectSettings, values?: SwitchDirectState): SwitchDirectState => ({ observation_id: "1", output_route: "managed", settings, ...values });
const speech = (values?: SwitchVoiceSettings): SwitchVoiceSettings => ({ mode: "original", mic_mode: "off", routing: "managed", output_device: "", ...values });

test("nothing known blocks nothing", () => {
    assert.deepEqual(switchBlocks(), {});
    assert.deepEqual(switchBlocks({ needs: [], ocr: null, voiceSettings: null, directState: {} }), {});
});

test("the setup needs block translation and both speech recognition switches", () => {
    const blocks = switchBlocks({ needs: [
        { id: "translation", weight: { id: "small", is_downloaded: false }, action: "review" },
        { id: "transcription", weight: null, action: "settings" },
    ] });
    assert.deepEqual(reasons(blocks), { translation: "translation_model", transcription_send: "asr_models",
        transcription_receive: "asr_models" });
    assert.equal(blocks.translation?.action, "translation");
    // The speech recognition models are fixed where the switch is: the setup reviews them (#1225).
    assert.equal(blocks.transcription_send?.action, "recognition_setup");
    assert.equal(blocks.transcription_receive?.action, "recognition_setup");
});

test("a translation model on its way says so, with nothing to press", () => {
    for (const weight of [{ id: "small", is_pending: true, progress: null }, { id: "small", is_pending: true, progress: 40 }]) {
        assert.deepEqual(switchBlocks({ needs: [{ id: "translation", weight, action: "review" }] }).translation,
            { reason: "translation_downloading", action: null });
    }
});

test("a translation model that cannot be downloaded points to the translator list", () => {
    assert.deepEqual(switchBlocks({ needs: [{ id: "translation", weight: { id: "small", is_downloaded: false }, action: "choose" }] }).translation,
        { reason: "translation_unavailable", action: "translator" });
});

test("chat reading follows the start: language first, then its models", () => {
    const ocr = (values?: Record<string, unknown>) => {
        const reply = { language: "Korean", language_supported: true, required_models: ["a", "b"], missing_models: [], ...values };
        return switchBlocks({ ocr: reply }).ocr;
    };
    assert.equal(ocr(), undefined);
    assert.deepEqual(ocr({ missing_models: ["b"] }), { reason: "ocr_models", action: "ocr_models" });
    assert.deepEqual(ocr({ language_supported: false, required_models: [], missing_models: [] }), { reason: "ocr_language", action: "ocr" });
    // A reply of another shape is not a reason.
    assert.equal(ocr({ language_supported: undefined, missing_models: ["b"] }), undefined);
    assert.equal(ocr({ missing_models: null }), undefined);
});

test("speech is blocked only when nothing is chosen to read aloud", () => {
    assert.deepEqual(switchBlocks({ voiceSettings: speech({ mode: "off" }) }).tts, { reason: "tts_source", action: "tts" });
    for (const values of [{}, { mode: "translated" }, { mode: "off", mic_mode: "original" }, { mode: "off", mic_mode: "translated" }])
        assert.equal(switchBlocks({ voiceSettings: speech(values) }).tts, undefined);
});

// #1266 (TT-3): a reading that has no voice to read with is blocked, and leads to the TTS page.
test("speech is blocked when every voice it can read with is on the bundled server without its model", () => {
    const profiles = (japanese = "", multilingual = "") => ({ profiles: { japanese: { model: japanese }, multilingual: { model: multilingual }, asr: { model: "" } } });
    const block = (values: Record<string, unknown>, servers: ReturnType<typeof profiles> | null = profiles()) =>
        switchBlocks({ voiceSettings: speech({ mode: "translated", ...values }), speechServers: servers }).tts;
    // A new install: both voices on the bundled server, no model.
    // The models are on the TTS page's part for this PC (#1314, M-2).
    assert.deepEqual(block({}), { reason: "tts_model", action: "tts_models" });
    assert.deepEqual(block({ japanese_server: "bundled", multilingual_server: "bundled" }), { reason: "tts_model", action: "tts_models" });
    // One language with its model, a server of the user's own, or an installed engine for Japanese: it can read.
    for (const [values, servers] of [[{}, profiles("/ja.gguf")], [{}, profiles("", "/multi.gguf")], [{ japanese_server: "external" }, profiles()],
        [{ multilingual_server: "external" }, profiles()], [{ japanese_engine: "voicevox" }, profiles()]] as const)
        assert.equal(block(values, servers), undefined, JSON.stringify([values, servers]));
    // The speech servers not known yet: nothing blocks. Nothing to read: that reason first.
    assert.equal(block({}, null), undefined);
    assert.equal(switchBlocks({ voiceSettings: speech({ mode: "off" }), speechServers: profiles() }).tts?.reason, "tts_source");
});

// #1314 (M-2): text to speech names everything it misses at once, in the TTS page's order, and
// leads to the first. One at a time, a choice the page refused for the next requirement read as if
// it had not been made.
test("speech names everything it misses at once, and leads to the first", () => {
    const profiles = { profiles: { japanese: { model: "" }, multilingual: { model: "" }, asr: { model: "" } } };
    const ready = { profiles: { japanese: { model: "/ja.gguf" }, multilingual: { model: "" }, asr: { model: "" } } };
    const block = (values: SwitchVoiceSettings, servers: typeof profiles | null = profiles) =>
        switchBlocks({ voiceSettings: speech(values), speechServers: servers }).tts;
    // A new install on a route of its own: nothing to read, no output device, no voice.
    assert.deepEqual(block({ mode: "off", routing: "direct" }),
        { reason: "tts_source", action: "tts", missing: ["tts_source", "tts_output_device", "tts_model"] });
    // Something to read, but no output device and no voice.
    assert.deepEqual(block({ routing: "direct" }), { reason: "tts_output_device", action: "tts", missing: ["tts_output_device", "tts_model"] });
    // Only the output device: its own reason, no list.
    assert.deepEqual(block({ routing: "direct" }, ready), { reason: "tts_output_device", action: "tts" });
    assert.equal(block({ routing: "direct", output_device: "Speakers" }, ready), undefined);
    // The managed route needs no output device; a route not known yet says nothing about it.
    assert.deepEqual(block({ mode: "off" }), { reason: "tts_source", action: "tts", missing: ["tts_source", "tts_model"] });
    assert.deepEqual(block({ routing: undefined }), { reason: "tts_model", action: "tts_models" });
});

test("voice conversion needs its saved model and runtime, then its route", () => {
    const block = (settings: SwitchDirectSettings, voiceSettings: SwitchVoiceSettings | null = speech(), values?: SwitchDirectState) => switchBlocks({ voiceSettings, directState: direct(settings, values) }).rvc;
    assert.equal(block(rvc()), undefined);
    for (const values of [{ rvc_model: "" }, { rvc_runtime: "" }, { engine: "seed-vc" }, { mode: "passthrough" }])
        assert.deepEqual(block(rvc(values)), { reason: "rvc_model", action: "rvc" });
    assert.deepEqual(block(rvc(), speech({ routing: "external" })), { reason: "rvc_route", action: "device" });
    // Windows: the converted voice goes to the output device the speech settings choose.
    assert.deepEqual(block(rvc(), speech({ routing: "external" }), { output_route: "device" }),
        { reason: "rvc_output_device", action: "tts" });
    assert.equal(block(rvc(), speech({ output_device: "Cable" }), { output_route: "device" }), undefined);
    // Before the speech settings arrive, the route is not judged.
    assert.equal(block(rvc(), null), undefined);
});

test("voice conversion is not judged before the engine has reported its state", () => {
    assert.equal(switchBlocks({ voiceSettings: speech(), directState: { settings: rvc({ rvc_model: "" }) } }).rvc, undefined);
    assert.equal(switchBlocks({ voiceSettings: speech(), directState: { observation_id: "1" } }).rvc, undefined);
});

test("only a switch that is off and waits for nothing is held off", () => {
    const blocks: SwitchBlocks = { ocr: { reason: "ocr_models", action: "ocr_models" } };
    assert.deepEqual(activeSwitchBlock(blocks, "ocr", { state: "ok", data: false }), blocks.ocr);
    assert.equal(activeSwitchBlock(blocks, "ocr", { state: "ok", data: true }), undefined);
    assert.equal(activeSwitchBlock(blocks, "ocr", { state: "pending", data: false }), undefined);
    assert.equal(activeSwitchBlock(blocks, "translation", { state: "ok", data: false }), undefined);
    assert.equal(activeSwitchBlock(undefined, "ocr", { state: "ok", data: false }), undefined);
});
