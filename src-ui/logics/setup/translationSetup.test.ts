import assert from "node:assert/strict";
import { test } from "vitest";
import { DEFAULT_TRANSLATION_WEIGHT, translationEntry, translationNext, translationOffer, weightOfEntry } from "./translationSetup.ts";

const M2M = { id: "m2m100-418m-onnx-int8", target: "translation", name: "M2M100 418M · int8", total_bytes: 500 };
const catalog = { catalog_version: "v1", models: [{ id: "reazonspeech-v2-q8", target: "asr", name: "ReazonSpeech", total_bytes: 1 }, M2M] };

// #936: the selected translation model's catalog entry, prepared in the setup itself.
test("the entry is the catalog's model of the selected translation model", () => {
    assert.equal(translationEntry(catalog, "m2m100_418M-ct2-int8"), M2M);
    assert.equal(translationEntry(catalog, "nllb-200-distilled-600M-ct2-int8"), null, "not in this catalog: no entry");
    assert.equal(translationEntry(null, "m2m100_418M-ct2-int8"), null);
    assert.equal(translationEntry(catalog, "user:mine"), null, "a model of one's own is not downloaded");
});

// As the recognition's section offers the model the setup recommends, the translation's offers
// the built-in default, and selects it once it is on the PC when another one is selected.
test("the setup offers the default model, and switches to it when another one is selected", () => {
    assert.equal(DEFAULT_TRANSLATION_WEIGHT, "m2m100_418M-ct2-int8");
    assert.deepEqual(translationOffer(catalog, "m2m100_418M-ct2-int8", []), { weight: "m2m100_418M-ct2-int8", name: M2M.name, entry: M2M, switches: false, restrictions: [] });
    // Another model selected (one the catalog does not have, or one with a restricted license).
    for (const selected of ["m2m100_1.2B-ct2-int8", "nllb-200-distilled-600M-ct2-int8"]) {
        assert.deepEqual(translationOffer(catalog, selected, []), { weight: "m2m100_418M-ct2-int8", name: M2M.name, entry: M2M, switches: true, restrictions: [] });
    }
    // The default is on the PC already: nothing to download, only the choice changes.
    assert.deepEqual(translationOffer(catalog, "m2m100_1.2B-ct2-int8", ["m2m100_418M-ct2-int8"]),
        { weight: "m2m100_418M-ct2-int8", name: "M2M100 418M · int8", entry: null, switches: true, restrictions: [] });
    assert.equal(translationOffer(catalog, "m2m100_418M-ct2-int8", ["m2m100_418M-ct2-int8"]), null, "selected and on the PC: nothing to do");
    // No default in the catalog, or the catalog not known yet: nothing offered here.
    assert.equal(translationOffer({ catalog_version: "v1", models: [] }, "m2m100_1.2B-ct2-int8", []), null);
    assert.equal(translationOffer(null, "m2m100_418M-ct2-int8", []), null);
});

test("a run starts the download, waits, applies it once, and is done when the model counts as downloaded", () => {
    const view = { job: undefined, started: undefined, applied: [] as string[], ready: false, modelReady: false, switches: false, switched: false };
    assert.deepEqual(translationNext(view), { kind: "start" });
    assert.deepEqual(translationNext({ ...view, started: null }), { kind: "wait" }, "asked, no job yet");
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "downloading" } }), { kind: "wait" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "ready" } }), { kind: "apply", jobId: "j1" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "ready" }, applied: ["j1"] }), { kind: "wait" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "applied" }, applied: ["j1"], ready: true }), { kind: "done" });
    // A download finished before (its consent given then) is applied without a new one.
    assert.deepEqual(translationNext({ ...view, job: { job_id: "j0", phase: "ready" } }), { kind: "apply", jobId: "j0" });
    // Applied, the default on the PC and the selected model the same: wait for the need to end.
    assert.deepEqual(translationNext({ ...view, started: null, applied: ["j1"], modelReady: true }), { kind: "wait" });
});

test("with another model selected, the run selects the default once it is on the PC, and once only", () => {
    const view = { job: undefined, started: undefined, applied: [] as string[], ready: false, modelReady: false, switches: true, switched: false };
    assert.deepEqual(translationNext(view), { kind: "start" }, "downloaded first");
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "ready" } }), { kind: "apply", jobId: "j1" });
    assert.deepEqual(translationNext({ ...view, started: null, applied: ["j1"], modelReady: true }), { kind: "switch" });
    assert.deepEqual(translationNext({ ...view, started: null, applied: ["j1"], modelReady: true, switched: true }), { kind: "wait" });
    assert.deepEqual(translationNext({ ...view, modelReady: true, switched: true, ready: true }), { kind: "done" });
    // The default on the PC already: only the switch.
    assert.deepEqual(translationNext({ ...view, modelReady: true }), { kind: "switch" });
});

test("a download this run started that failed or was cancelled stops it; an older job's does not", () => {
    const view = { applied: [] as string[], ready: false, modelReady: false, switches: false, switched: false };
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "failed", error_code: "download_failed_network" } }),
        { kind: "failed", code: "download_failed_network" });
    assert.deepEqual(translationNext({ ...view, started: null, job: { job_id: "j1", phase: "cancelled" } }), { kind: "failed", code: "cancelled" });
    assert.deepEqual(translationNext({ ...view, started: "j0", job: { job_id: "j0", phase: "failed" } }), { kind: "wait" }, "the old job, before this run's answer");
    assert.deepEqual(translationNext({ ...view, started: undefined, job: { job_id: "j0", phase: "failed" } }), { kind: "start" }, "an old failure does not stop a new run");
});

// #955: the model chosen in the setup, the default one unless another is chosen. A restricted
// license comes with the offer, to be acknowledged on its own before anything starts.
test("the setup prepares the model chosen in it, with what its license restricts", () => {
    const NLLB = { id: "nllb-200-distilled-600m-onnx-int8", target: "translation", name: "NLLB-200 distilled 600M · int8", total_bytes: 600, restrictions: ["non_commercial"] };
    assert.equal(weightOfEntry("m2m100-418m-onnx-int8"), "m2m100_418M-ct2-int8");
    assert.equal(weightOfEntry(NLLB.id), "nllb-200-distilled-600M-ct2-int8");
    assert.equal(weightOfEntry("user:mine"), null);
    assert.deepEqual(translationOffer(catalog, "m2m100_418M-ct2-int8", [], NLLB),
        { weight: "nllb-200-distilled-600M-ct2-int8", name: NLLB.name, entry: NLLB, switches: true, restrictions: ["non_commercial"] });
    // Already on the PC: only the choice changes, and the license is still acknowledged.
    assert.deepEqual(translationOffer(catalog, "m2m100_418M-ct2-int8", ["nllb-200-distilled-600M-ct2-int8"], NLLB),
        { weight: "nllb-200-distilled-600M-ct2-int8", name: NLLB.name, entry: null, switches: true, restrictions: ["non_commercial"] });
    // Chosen and already the selected one on the PC: nothing to do.
    assert.equal(translationOffer(catalog, "nllb-200-distilled-600M-ct2-int8", ["nllb-200-distilled-600M-ct2-int8"], NLLB), null);
    // The default, chosen by name: as without a choice.
    assert.deepEqual(translationOffer(catalog, "m2m100_418M-ct2-int8", [], M2M), translationOffer(catalog, "m2m100_418M-ct2-int8", []));
});
