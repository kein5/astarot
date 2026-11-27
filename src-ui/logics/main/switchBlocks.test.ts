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
    assert.deepEqual(block({}), { reason: "tts_model", action: "tts" });
    assert.deepEqual(block({ japanese_server: "bundled", multilingual_server: "bundled" }), { reason: "tts_model", action: "tts" });
    // One language with its model, a server of the user's own, or an installed engine for Japanese: it can read.
    for (const [values, servers] of [[{}, profiles("/ja.gguf")], [{}, profiles("", "/multi.gguf")], [{ japanese_server: "external" }, profiles()],
        [{ multilingual_server: "external" }, profiles()], [{ japanese_engine: "voicevox" }, profiles()]] as const)
        assert.equal(block(values, servers), undefined, JSON.stringify([values, servers]));
    // The speech servers not known yet: nothing blocks. Nothing to read: that reason first.
    assert.equal(block({}, null), undefined);
    assert.equal(switchBlocks({ voiceSettings: speech({ mode: "off" }), speechServers: profiles() }).tts?.reason, "tts_source");
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
