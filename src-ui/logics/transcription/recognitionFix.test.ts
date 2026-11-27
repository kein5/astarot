import assert from "node:assert/strict";
import { test } from "vitest";
import { detectingAsr, firstLanguage, languageSettingId, recognitionFixOf, withLanguage } from "./recognitionFix.ts";
import type { SetupCatalog } from "../setup/firstRunSetup.ts";
import { unchecked } from "../test/hookHarness.ts";

const SEND = "/set/enable/transcription_send", RECEIVE = "/set/enable/transcription_receive";

test("missing models are fixed for both speech recognition switches (#1225)", () => {
    for (const reason of ["realtime_asr_model_missing", "realtime_vad_model_missing"]) {
        assert.deepEqual(recognitionFixOf(SEND, { reason }), { endpoint: SEND, source: "mic", kind: "models", reason, languages: [], auto: false });
        assert.deepEqual(recognitionFixOf(RECEIVE, { reason }), { endpoint: RECEIVE, source: "speaker", kind: "models", reason, languages: [], auto: false });
    }
});

test("a language the model does not take offers the model's languages", () => {
    assert.deepEqual(recognitionFixOf(RECEIVE, { reason: "realtime_language_auto_unsupported", languages: ["ja"] }),
        { endpoint: RECEIVE, source: "speaker", kind: "language", reason: "realtime_language_auto_unsupported", languages: ["ja"], auto: true });
    assert.deepEqual(recognitionFixOf(SEND, { reason: "realtime_language_unsupported", languages: ["ja", "en"] }),
        { endpoint: SEND, source: "mic", kind: "language", reason: "realtime_language_unsupported", languages: ["ja", "en"], auto: false });
    // Only codes, once each, and never "auto", which the model cannot do.
    assert.deepEqual(recognitionFixOf(RECEIVE, { reason: "realtime_language_unsupported", languages: ["ja", "ja", "", "auto", 3, null] })?.languages, ["ja"]);
    // Without the list (an older engine), the fix still leads to the setting.
    assert.deepEqual(recognitionFixOf(RECEIVE, { reason: "realtime_language_unsupported" })?.languages, []);
});

test("other refusals and other switches keep their notice", () => {
    for (const reason of ["speech_server_autostart_off", "speech_server_not_ready", "realtime_model_required", "realtime_endpoint_required", "generic"]) {
        assert.equal(recognitionFixOf(RECEIVE, { reason }), null, reason);
    }
    // #1242: Listening's own model that does not fit beside Mic input's is offered one model for both.
    assert.deepEqual(recognitionFixOf(RECEIVE, { reason: "realtime_asr_models_do_not_fit" }),
        { endpoint: RECEIVE, source: "speaker", kind: "share", reason: "realtime_asr_models_do_not_fit", languages: [], auto: false });
    assert.equal(recognitionFixOf("/set/enable/ocr_capture", { reason: "realtime_asr_model_missing" }), null);
    for (const details of [null, undefined, {}, { reason: 1 }, "realtime_asr_model_missing"]) assert.equal(recognitionFixOf(SEND, details), null);
});

test("the model offered to tell the language is the one the catalog marks as telling it, recommended for the most languages", () => {
    // #1242: the catalog's flag decides, not a model's name.
    const row = (id: string, name: string, isDefault: boolean, detects: boolean, reach: string[], target = "asr") =>
        ({ id, target, name: `${name} · ${id}`, total_bytes: 1, speech: { name, label: name, type: "q8_0", default: isDefault, detects }, profile: { recommended_for: reach } });
    const catalog = { models: [row("reazonspeech-v2-q8", "reazonspeech-v2", true, false, ["ja"]), row("qwen3-asr-06b-q6", "qwen3-asr-0.6b", false, true, []),
        row("qwen3-asr-06b-q8", "qwen3-asr-0.6b", true, true, ["en", "zh", "fr"]), row("parakeet-v3", "parakeet-tdt-0.6b-v3", true, true, ["bg"]),
        row("qwen3-tts", "qwen3-tts", true, true, ["en", "zh", "fr", "de"], "japanese")] };
    // Test data: the entries carry only the fields of the catalog the choice reads.
    assert.equal(detectingAsr(unchecked<SetupCatalog>(catalog))?.id, "qwen3-asr-06b-q8");
    assert.equal(detectingAsr(unchecked<SetupCatalog>({ models: [row("reazonspeech-v2-q8", "reazonspeech-v2", true, false, ["ja"])] })), null);
    assert.equal(detectingAsr(null), null);
});

test("the language first offered is the UI's when the model takes it", () => {
    assert.equal(firstLanguage(["en", "ja"], "ja-JP"), "ja");
    assert.equal(firstLanguage(["en", "ko"], "ja"), "en");
    assert.equal(firstLanguage([], "ja"), "");
    assert.equal(firstLanguage(["ja"], undefined), "ja");
});

test("choosing a language changes only that source's", () => {
    const settings = { server: "bundled", mic: { language: "ja", endpoint: null }, speaker: { language: "auto", endpoint: null } };
    assert.deepEqual(withLanguage(settings, "speaker", "ja"), { server: "bundled", mic: { language: "ja", endpoint: null }, speaker: { language: "ja", endpoint: null } });
    assert.equal(settings.speaker.language, "auto", "the saved settings are not changed in place");
    assert.deepEqual([languageSettingId("mic"), languageSettingId("speaker")], ["realtime_mic_language", "realtime_speaker_language"]);
});
