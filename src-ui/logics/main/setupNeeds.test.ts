import assert from "node:assert/strict";
import { test } from "vitest";
import { setupNeeds, downloadProgress, translationDownloadable, translationCatalogIds } from "./setupNeeds.ts";
import type { ModelWeight, SetupSelection } from "./setupNeeds.ts";

const weights = (downloaded: boolean): ModelWeight[] => [{ id: "small", is_downloaded: downloaded }, { id: "large", is_downloaded: false }];
const asr = (model: string, vad_model: string) => ({ model, vad_model, diarization_model: "", device: "auto" });
const selection = (values?: SetupSelection): SetupSelection => ({ translationEngine: "CTranslate2", translationWeights: weights(false), translationWeight: "small",
    transcriptionEngine: "SpeechCpp", realtimeServer: "bundled", asrProfile: asr("", ""), ...values });

test("a selected built-in engine without its selected model is a need", () => {
    assert.deepEqual(setupNeeds(selection()).map(need => [need.id, need.weight?.id ?? null, need.action]),
        [["translation", "small", "review"], ["transcription", null, "settings"]]);
});

test("the local engine on the bundled server needs both the recognition and the VAD model", () => {
    for (const profile of [asr("", ""), asr("/m/asr.gguf", ""), asr("", "/m/vad.gguf"), asr("  ", "/m/vad.gguf")]) {
        const needs = setupNeeds(selection({ translationEngine: "DeepL", asrProfile: profile }));
        // It opens Settings → Speech recognition, where models are reviewed with consent; it never downloads.
        assert.deepEqual(needs, [{ id: "transcription", weight: null, action: "settings" }]);
        assert.equal(downloadProgress(needs[0].weight), null);
    }
    assert.deepEqual(setupNeeds(selection({ translationEngine: "DeepL", asrProfile: asr("/m/asr.gguf", "/m/vad.gguf") })), []);
});

test("a model that is there, or an engine that needs none, is not a need", () => {
    assert.deepEqual(setupNeeds(selection({ translationWeights: weights(true) })).map(need => need.id), ["transcription"]);
    assert.deepEqual(setupNeeds(selection({ translationEngine: "DeepL_API", transcriptionEngine: "Deepgram" })), []);
    // Your own speech.cpp server has its own models.
    assert.deepEqual(setupNeeds(selection({ translationEngine: "DeepL", realtimeServer: "external" })), []);
    // Nothing has been chosen yet: the first press of the microphone asks which engine to use.
    assert.deepEqual(setupNeeds(selection({ translationEngine: "DeepL", transcriptionEngine: null })), []);
    // The removed engine is not asked for, even in a stale value.
    assert.deepEqual(setupNeeds(selection({ translationEngine: "DeepL", transcriptionEngine: "Whisper" })), []);
});

test("an unselected model that is missing is not a need, and unknown settings ask for nothing", () => {
    assert.deepEqual(setupNeeds(selection({ translationWeights: [{ id: "small", is_downloaded: true }, { id: "large", is_downloaded: false }],
        asrProfile: undefined })), []);
    assert.deepEqual(setupNeeds(selection({ translationWeight: "gone", realtimeServer: undefined })), []);
});

test("progress is a whole percentage, a wait before the first report, or nothing", () => {
    assert.equal(downloadProgress({ is_pending: true, progress: null }), "pending");
    assert.equal(downloadProgress({ is_pending: true, progress: 41.7 }), 41);
    assert.equal(downloadProgress({ is_pending: true, progress: 100.4 }), 100);
    assert.equal(downloadProgress({ is_pending: false, progress: null }), null);
    assert.equal(downloadProgress(undefined), null);
});

test("a model the catalog does not offer asks for another translator instead of a review", () => {
    const action = (translationDownloadable: boolean | null | undefined) =>
        setupNeeds(selection({ translationDownloadable })).find(need => need.id === "translation")?.action;
    assert.equal(action(false), "choose");
    // Unknown (no catalog yet) or downloadable: the review, as before.
    assert.equal(action(null), "review");
    assert.equal(action(undefined), "review");
    assert.equal(action(true), "review");
    // A download already on its way keeps its progress.
    const pending = setupNeeds(selection({ translationDownloadable: false,
        translationWeights: [{ id: "small", is_downloaded: false, is_pending: true }] }));
    assert.equal(pending[0].action, "review");
});

test("a translation model is downloadable when the catalog reviews its weight or lists a variant of it", () => {
    assert.equal(translationDownloadable(null, "small"), null);
    assert.equal(translationDownloadable({ legacy_models: [], models: [] }, "small"), false);
    assert.equal(translationDownloadable({ legacy_models: [{ kind: "ctranslate2", weight_type: "large" }], models: [{ target: "rvc" }] }, "small"), false);
    assert.equal(translationDownloadable({ legacy_models: [{ kind: "ctranslate2", weight_type: "small" }] }, "small"), true);
    const m2m100 = { id: "m2m100-418m-onnx-int8", target: "translation" };
    assert.equal(translationDownloadable({ legacy_models: [], models: [m2m100] }, "m2m100_418M-ct2-int8"), true);
    assert.equal(translationDownloadable({ legacy_models: [], models: [{ id: "m2m100-418m-onnx-float16", target: "translation" }] }, "m2m100_418M-ct2-int8"), true);
    // Another model's entry does not offer this one: its review would only lead elsewhere.
    assert.equal(translationDownloadable({ legacy_models: [], models: [m2m100] }, "nllb-200-distilled-600M-ct2-int8"), false);
    assert.equal(translationDownloadable({ legacy_models: [], models: [{ ...m2m100, target: "rvc" }] }, "m2m100_418M-ct2-int8"), false);
    // A user's model is never downloaded from the catalog.
    assert.equal(translationDownloadable({ legacy_models: [], models: [m2m100] }, "custom:m2m100_418M-ct2-int8"), false);
});

test("a built-in weight names its catalog entries the way the core does", () => {
    assert.deepEqual(translationCatalogIds("m2m100_418M-ct2-int8"),
        ["m2m100-418m-onnx-float32", "m2m100-418m-onnx-float16", "m2m100-418m-onnx-int8", "m2m100-418m-onnx-int4"]);
    assert.ok(translationCatalogIds("nllb-200-distilled-1.3B-ct2-int8").includes("nllb-200-distilled-1-3b-onnx-int8"));
    for (const weight of ["custom:folder", "user:tr-1", "", null, undefined, "small"]) assert.deepEqual(translationCatalogIds(weight), []);
});
