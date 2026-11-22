import assert from "node:assert/strict";
import { test } from "vitest";
import { SKIP, chosenEntry, featureOutcome, modelChoices, recommendedSpeech, settled } from "./setupChoices.ts";

const row = (id: string, target: string, name: string, extra: object = {}) => ({ id, target, name, total_bytes: 1, ...extra });
const catalog = { catalog_version: "v1", models: [
    // The files of one model share its summary, as the catalog's do (familyKey).
    row("irodori-mf-f16", "japanese", "Irodori-TTS v4.1 Small MF · F16", { profile: { summary: "mf", recommended_for: ["ja"] } }),
    row("qwen-06-q8", "multilingual", "Qwen3-TTS 0.6B · Q8_0", { profile: { recommended_for: ["en", "de"] } }),
    row("irodori-mf-q8", "japanese", "Irodori-TTS v4.1 Small MF · Q8_0", { profile: { summary: "mf" } }),
    row("irodori-large-q8", "japanese", "Irodori-TTS v4 Large · Q8_0"),
    row("qwen-17-q8", "multilingual", "Qwen3-TTS 1.7B · Q8_0"),
    row("asr-a", "asr", "A · Q8_0", { speech: { name: "A", default: true } }),
    row("asr-a-q4", "asr", "A · Q4_K", { speech: { name: "A", default: false } }),
    row("asr-b", "asr", "B · Q8_0", { speech: { name: "B", default: true } }),
] };

// #955: one file per model, the recommended model first; the files of one model are one choice.
test("a step offers one file per model, the recommended model first", () => {
    assert.deepEqual(modelChoices(catalog, ["asr"], "asr-b").map(entry => entry.id), ["asr-b", "asr-a"]);
    assert.deepEqual(modelChoices(catalog, ["asr"], null).map(entry => entry.id), ["asr-a", "asr-b"]);
    // Text to speech: the Japanese and the other languages' models in one list.
    assert.deepEqual(modelChoices(catalog, ["japanese", "multilingual"], "qwen-06-q8").map(entry => entry.id),
        ["qwen-06-q8", "irodori-mf-f16", "irodori-large-q8", "qwen-17-q8"]);
    assert.deepEqual(modelChoices(null, ["asr"], null), []);
});

test("the text-to-speech model recommended follows the UI language", () => {
    assert.equal(recommendedSpeech(catalog, "ja-JP")?.id, "irodori-mf-f16");
    assert.equal(recommendedSpeech(catalog, "en")?.id, "qwen-06-q8");
    assert.equal(recommendedSpeech(catalog, "fr")?.id, "qwen-06-q8", "a language without its own falls back to the other languages' model");
    assert.equal(recommendedSpeech(null, "ja"), null);
});

test("a choice names a model, or installs nothing", () => {
    const choices = modelChoices(catalog, ["asr"], null);
    assert.equal(chosenEntry(choices, "asr-b")?.id, "asr-b");
    assert.equal(chosenEntry(choices, SKIP), null);
    assert.equal(chosenEntry(choices, "gone"), null, "a model the list no longer has");
});

// #955: each feature on its own: ready, or not installed now, and nothing under way. The end says
// which switches to turn on, and that a feature not used can stay off.
test("a feature is settled when ready or skipped, and not while it runs", () => {
    assert.equal(settled({ ready: true, skipped: false, running: false }), true);
    assert.equal(settled({ ready: false, skipped: true, running: false }), true);
    assert.equal(settled({ ready: false, skipped: false, running: false }), false);
    assert.equal(settled({ ready: false, skipped: false, running: true }), false);
    assert.equal(featureOutcome({ ready: true, skipped: false, running: false }), "use");
    assert.equal(featureOutcome({ ready: false, skipped: true, running: false }), "unused");
});
