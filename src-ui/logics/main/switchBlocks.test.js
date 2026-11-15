import assert from "node:assert/strict";
import { test } from "node:test";
import { switchBlocks } from "./switchBlocks.js";

const reasons = blocks => Object.fromEntries(Object.entries(blocks).map(([id, block]) => [id, block.reason]));
const rvc = values => ({ mode: "converted", engine: "rvc", rvc_runtime: "/r/python", rvc_model: "/m/voice.pth", ...values });
const direct = (settings, values) => ({ observation_id: "1", output_route: "managed", settings, ...values });
const speech = values => ({ mode: "original", mic_mode: "off", routing: "managed", output_device: "", ...values });

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
    assert.equal(blocks.translation.action, "translation");
    assert.equal(blocks.transcription_send.action, "transcription");
});

test("a translation model on its way says so, with nothing to press", () => {
    for (const weight of [{ id: "small", is_pending: true, progress: null }, { id: "small", is_pending: true, progress: 40 }]) {
        assert.deepEqual(switchBlocks({ needs: [{ id: "translation", weight, action: "review" }] }).translation,
            { reason: "translation_downloading", action: null });
    }
});

test("chat reading follows the start: language first, then its models", () => {
    const ocr = values => switchBlocks({ ocr: { language: "Korean", language_supported: true, required_models: ["a", "b"],
        missing_models: [], ...values } }).ocr;
    assert.equal(ocr(), undefined);
    assert.deepEqual(ocr({ missing_models: ["b"] }), { reason: "ocr_models", action: "ocr" });
    assert.deepEqual(ocr({ language_supported: false, required_models: [], missing_models: [] }), { reason: "ocr_language", action: "ocr" });
    // A reply of another shape is not a reason.
    assert.equal(ocr({ language_supported: undefined, missing_models: ["b"] }), undefined);
    assert.equal(ocr({ missing_models: null }), undefined);
});

test("speech is blocked only when nothing is chosen to read aloud", () => {
    assert.deepEqual(switchBlocks({ voiceSettings: speech({ mode: "off" }) }).tts, { reason: "tts_source", action: "tts" });
    for (const values of [{}, { mode: "translated" }, { mode: "off", mic_mode: "translated" }])
        assert.equal(switchBlocks({ voiceSettings: speech(values) }).tts, undefined);
});

test("voice conversion needs its saved model and runtime, then its route", () => {
    const block = (settings, voiceSettings = speech(), values) => switchBlocks({ voiceSettings, directState: direct(settings, values) }).rvc;
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
