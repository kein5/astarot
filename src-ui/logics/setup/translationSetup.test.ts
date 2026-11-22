import assert from "node:assert/strict";
import { test } from "vitest";
import { translationEntry, translationNext } from "./translationSetup.ts";

const M2M = { id: "m2m100-418m-onnx-int8", target: "translation", name: "M2M100 418M · int8", total_bytes: 500 };
const catalog = { catalog_version: "v1", models: [{ id: "reazonspeech-v2-q8", target: "asr", name: "ReazonSpeech", total_bytes: 1 }, M2M] };

// #936: the selected translation model's catalog entry, prepared in the setup itself.
test("the entry is the catalog's model of the selected translation model", () => {
    assert.equal(translationEntry(catalog, "m2m100_418M-ct2-int8"), M2M);
    assert.equal(translationEntry(catalog, "nllb-200-distilled-600M-ct2-int8"), null, "not in this catalog: no entry");
    assert.equal(translationEntry(null, "m2m100_418M-ct2-int8"), null);
    assert.equal(translationEntry(catalog, "user:mine"), null, "a model of one's own is not downloaded");
});

test("a run starts the download, waits, applies it once, and is done when the model counts as downloaded", () => {
    const view = { job: undefined, started: undefined, applied: [] as string[], ready: false };
    assert.deepEqual(translationNext(view), { kind: "start" });
    assert.deepEqual(translationNext({ ...view, started: null }), { kind: "wait" }, "asked, no job yet");
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "downloading" } }), { kind: "wait" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "ready" } }), { kind: "apply", jobId: "j1" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "ready" }, applied: ["j1"] }), { kind: "wait" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "applied" }, applied: ["j1"], ready: true }), { kind: "done" });
    // A download finished before (its consent given then) is applied without a new one.
    assert.deepEqual(translationNext({ ...view, job: { job_id: "j0", phase: "ready" } }), { kind: "apply", jobId: "j0" });
});

test("a download this run started that failed or was cancelled stops it; an older job's does not", () => {
    const view = { applied: [] as string[], ready: false };
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "failed", error_code: "download_failed_network" } }),
        { kind: "failed", code: "download_failed_network" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "cancelled" } }), { kind: "failed", code: "cancelled" });
    assert.deepEqual(translationNext({ ...view, started: "j0", job: { job_id: "j0", phase: "failed" } }), { kind: "wait" }, "the old job, before this run's answer");
    assert.deepEqual(translationNext({ ...view, started: undefined, job: { job_id: "j0", phase: "failed" } }), { kind: "start" }, "an old failure does not stop a new run");
});
