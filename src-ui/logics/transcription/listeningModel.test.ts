import assert from "node:assert/strict";
import { test } from "vitest";
import { SAME, catalogLanguages, listeningApart, listeningApply, listeningChoice, listeningRow, sourceApply, sourcesByPath } from "./listeningModel.ts";
import type { ModelCatalogRow, ModelDownloadCatalog } from "../voice/useModelDownloads";
import { unchecked } from "../test/hookHarness.ts";

// #1242: Listening's own model is chosen among the recognition models on the PC; its languages come
// from the catalog, and a checked choice is applied for Listening alone.
const row = (id: string, languages: string[], detects: boolean, target = "asr") =>
    ({ id, target, name: id, speech: { name: id, label: id, type: "q8_0", default: true, languages, detects } });
const catalog = unchecked<ModelDownloadCatalog>({ catalog_version: "v7", models: [
    row("reazon-q8", ["ja"], false), row("qwen-q8", ["ja", "en"], true), row("absent-q8", ["en"], false), row("vad", [], false, "vad")] });
const downloaded = { "reazon-q8": { model: "/m/reazon.gguf" }, "qwen-q8": { model: "/m/qwen.gguf" }, vad: { model: "/m/vad.gguf" } };

test("Listening's choice lists the recognition models on the PC and tells whether Listening has its own", () => {
    const shared = listeningChoice(catalog, downloaded, { model: "/m/reazon.gguf", listening_model: "" });
    assert.deepEqual([shared.apart, shared.path, shared.current, shared.mic?.id, shared.choices.map(entry => entry.id)],
        [false, "", null, "reazon-q8", ["reazon-q8", "qwen-q8"]]);
    const apart = listeningChoice(catalog, downloaded, { model: "/m/reazon.gguf", listening_model: "/m/qwen.gguf" });
    assert.deepEqual([apart.apart, apart.current?.id], [true, "qwen-q8"]);
    // The same file as Mic input's is one model for both; a file of one's own has no catalog entry.
    assert.equal(listeningChoice(catalog, downloaded, { model: "/m/qwen.gguf", listening_model: "/m/qwen.gguf" }).apart, false);
    assert.deepEqual(Object.values(listeningChoice(catalog, downloaded, { model: "/m/reazon.gguf", listening_model: "/own.gguf" })).slice(0, 3), [true, "/own.gguf", null]);
    assert.equal(listeningChoice(null, undefined, null).choices.length, 0);
    assert.equal(SAME, "");
});

// #1396: whether the ASR + VAD row also runs Listening's own server, as the core's listening_apart
// reads the saved settings: a file of its own, another than Mic input's. A core before #1242 sends
// no listening_model.
test("Listening has a model of its own only with another file than Mic input's", () => {
    assert.equal(listeningApart({ model: "/m/mic.gguf", listening_model: "/m/listen.gguf" }), true);
    assert.equal(listeningApart({ model: "", listening_model: "/m/listen.gguf" }), true);
    for (const asr of [{ model: "/m/mic.gguf", listening_model: "" }, { model: "/m/mic.gguf", listening_model: "/m/mic.gguf" },
        { model: "/m/mic.gguf" }, null, undefined]) {
        assert.equal(listeningApart(asr), false, JSON.stringify(asr));
    }
});

test("Listening's own model's languages come from the catalog, auto first when it tells the language", () => {
    assert.deepEqual(catalogLanguages(unchecked<ModelCatalogRow>(row("qwen-q8", ["ja", "en"], true))), ["auto", "ja", "en"]);
    assert.deepEqual(catalogLanguages(unchecked<ModelCatalogRow>(row("reazon-q8", ["ja"], false))), ["ja"]);
    assert.equal(catalogLanguages(null), null);
});

// #1298: Listening's languages are those of the model it uses, its own or the one it shares with Mic
// input, so "auto" is there for a model that tells the language whether its server runs or not.
test("the model Listening uses is its own, or Mic input's when it shares it", () => {
    assert.equal(listeningRow(listeningChoice(catalog, downloaded, { model: "/m/reazon.gguf", listening_model: "/m/qwen.gguf" }))?.id, "qwen-q8");
    assert.equal(listeningRow(listeningChoice(catalog, downloaded, { model: "/m/qwen.gguf", listening_model: "" }))?.id, "qwen-q8");
    assert.equal(listeningRow(listeningChoice(catalog, downloaded, { model: "/m/qwen.gguf", listening_model: "/m/qwen.gguf" }))?.id, "qwen-q8");
    // A file of one's own has no entry to read languages from.
    assert.equal(listeningRow(listeningChoice(catalog, downloaded, { model: "/m/reazon.gguf", listening_model: "/own.gguf" })), null);
    assert.equal(listeningRow(listeningChoice(catalog, downloaded, { model: "/own.gguf", listening_model: "" })), null);
});

test("a checked choice is applied for Listening once its own check is ready, with Listening's saved file", () => {
    const asked = { id: "qwen-q8", before: "old" };
    assert.equal(listeningApply(null, {}, ""), null);
    const job = (job_id: string, phase: string) => ({ "qwen-q8": { job_id, phase, received_bytes: 1, total_bytes: 1 } });
    assert.equal(listeningApply(asked, job("old", "ready"), ""), null, "an earlier check is not this one");
    assert.equal(listeningApply(asked, job("new", "verifying"), ""), null);
    assert.deepEqual(listeningApply(asked, job("new", "ready"), "/m/old.gguf"),
        { id: "qwen-q8", job_id: "new", expected: { model: "/m/old.gguf" }, source: "speaker" });
});

// #1308 ★1: Mic input's and Listening's models are chosen side by side; a choice is applied for its
// input alone, and the catalog marks a model with the inputs that use it.
test("a checked choice is applied for the input it was chosen for", () => {
    const jobs = { "qwen-q8": { job_id: "new", phase: "ready", received_bytes: 1, total_bytes: 1 } };
    const paths = { mic: "/m/reazon.gguf", speaker: "/m/own.gguf" };
    assert.deepEqual(sourceApply({ id: "qwen-q8", before: null, source: "mic" }, jobs, paths),
        { id: "qwen-q8", job_id: "new", expected: { model: "/m/reazon.gguf" } }, "Mic input's: no source, checked against its model");
    assert.deepEqual(sourceApply({ id: "qwen-q8", before: null, source: "speaker" }, jobs, paths),
        { id: "qwen-q8", job_id: "new", expected: { model: "/m/own.gguf" }, source: "speaker" });
    assert.equal(sourceApply(null, jobs, paths), null);
    assert.equal(sourceApply({ id: "qwen-q8", before: "new", source: "mic" }, jobs, paths), null, "an earlier check is not this one");
});

test("a model file is marked with the inputs that use it", () => {
    assert.deepEqual(sourcesByPath({ model: "/m/reazon.gguf", listening_model: "" }), { "/m/reazon.gguf": ["mic", "speaker"] }, "one model for both");
    assert.deepEqual(sourcesByPath({ model: "/m/reazon.gguf", listening_model: "/m/qwen.gguf" }), { "/m/reazon.gguf": ["mic"], "/m/qwen.gguf": ["speaker"] });
    assert.deepEqual(sourcesByPath({ model: "", listening_model: "/m/qwen.gguf" }), { "/m/qwen.gguf": ["speaker"] }, "Listening's alone");
    assert.deepEqual(sourcesByPath({ model: "", listening_model: "" }), {});
    assert.deepEqual(sourcesByPath(null), {});
});
