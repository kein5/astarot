import assert from "node:assert/strict";
import { test } from "vitest";
import { asrModels, hasOldWeights, normalizeOutcome, normalizeWeights, weightsSize } from "./localAsrMigration.ts";
import { loadBridgeRoutes } from "../test/bridgeHarness.js";

test("old weights are taken only in the shape the backend sends", () => {
    assert.deepEqual(normalizeWeights({ total_bytes: 3, folders: ["base"], extra: 1 }), { total_bytes: 3, folders: ["base"] });
    for (const value of [null, {}, { total_bytes: -1, folders: [] }, { total_bytes: 1.5, folders: [] },
        { total_bytes: 1, folders: "base" }, { total_bytes: 1, folders: [1] }]) assert.equal(normalizeWeights(value), null);
    assert.deepEqual(normalizeOutcome({ total_bytes: 0, folders: [], freed_bytes: 9, failed: ["small", 2] }),
        { freed_bytes: 9, failed: ["small"] });
    assert.equal(normalizeOutcome({ total_bytes: 0, folders: [] }), null);
    assert.equal(hasOldWeights({ total_bytes: 0, folders: [] }), false);
    assert.equal(hasOldWeights({ total_bytes: 0, folders: ["base"] }), true);
    assert.equal(hasOldWeights(null), false);
});

test("sizes read like the model download review: binary MB or GB, three significant digits", () => {
    assert.equal(weightsSize(147882941), "141 MB");
    assert.equal(weightsSize(1529008357), "1.42 GB");
    assert.equal(weightsSize(0), "0 MB");
    assert.equal(weightsSize(undefined), "0 MB");
});

test("the asr profile says which of the two models are set; unknown settings say nothing", () => {
    assert.equal(asrModels(null), null);
    assert.equal(asrModels({ profiles: {} }), null);
    assert.deepEqual(asrModels({ profiles: { asr: { model: "/m/asr.gguf", vad_model: "  " } } }), { model: true, vad_model: false });
    assert.deepEqual(asrModels({ profiles: { asr: { model: "", vad_model: "/m/vad.gguf" } } }), { model: false, vad_model: true });
});

test("the notice, the old weights and a delete arrive through their own routes", async () => {
    const subject = await loadBridgeRoutes();
    const state = () => subject.localAsr();
    assert.equal(state().notice, null, "unknown until the backend says");
    subject.receiveRoutes({ status: 200, endpoint: "/get/data/local_asr_notice", result: true });
    subject.receiveRoutes({ status: 200, endpoint: "/get/data/old_whisper_weights", result: { total_bytes: 2048, folders: ["base", "small"] } });
    assert.equal(state().notice, true);
    assert.deepEqual(state().weights, { total_bytes: 2048, folders: ["base", "small"] });

    // Closing the notice clears it at once and tells the backend; nothing is downloaded.
    await state().dismissNotice();
    assert.equal(state().notice, false);
    assert.deepEqual(subject.reads.filter(path => path.includes("local_asr") || path.includes("download")), ["/set/disable/local_asr_notice"]);
    subject.receiveRoutes({ status: 200, endpoint: "/set/disable/local_asr_notice", result: false });
    assert.equal(state().notice, false);

    // A delete is sent once while it is under way, then the remaining folders and the freed bytes arrive.
    await state().deleteWeights();
    assert.equal(state().deleting, true);
    assert.equal(await state().deleteWeights(), false);
    assert.equal(subject.reads.filter(path => path === "/run/delete_old_whisper_weights").length, 1);
    subject.receiveRoutes({ status: 200, endpoint: "/run/delete_old_whisper_weights",
        result: { total_bytes: 0, folders: [], freed_bytes: 2048, failed: [] } });
    assert.equal(state().deleting, false);
    assert.deepEqual(state().weights, { total_bytes: 0, folders: [] });
    assert.deepEqual(state().outcome, { freed_bytes: 2048, failed: [] });
});

test("a refused delete or a stopped backend lets the user try again", async () => {
    const subject = await loadBridgeRoutes();
    const state = () => subject.localAsr();
    await state().deleteWeights();
    subject.receiveRoutes({ status: 500, endpoint: "/run/delete_old_whisper_weights", result: { error_code: "old_whisper_weights_delete_failed" } });
    assert.equal(state().deleting, false);
    assert.equal(state().error, "old_whisper_weights_delete_failed");
    // Its own notice is in the settings box, not the generic "unexpected error" one.
    assert.deepEqual(subject.notices, []);

    await state().deleteWeights();
    assert.equal(state().deleting, true);
    subject.backendStopped();
    assert.equal(state().deleting, false);
    assert.equal(state().error, "backend_unavailable");
});
