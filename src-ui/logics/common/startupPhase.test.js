import assert from "node:assert/strict";
import { test } from "node:test";
import { startupPhase, isStartupLocked, describeStartupFailure, startupDownloads } from "./startupPhase.js";

test("the phase comes from the session's startup state and readiness, nothing else", () => {
    // Retry returns "starting" before the old attempt is gone: the page stays locked, without the dialog.
    for (const startupState of ["starting", "running"]) {
        assert.equal(startupPhase({ startupState, isBackendReady: false }), "starting");
        assert.equal(startupPhase({ startupState, isBackendReady: true }), "ready");
    }
    // Failed and stopped both clear readiness; only a failure before readiness locks the page.
    assert.equal(startupPhase({ startupState: "failed", isBackendReady: false }), "failed");
    assert.equal(startupPhase({ startupState: "stopped", isBackendReady: false }), "stopped");
    assert.deepEqual(["starting", "failed", "ready", "stopped"].map(isStartupLocked), [true, true, false, false]);
});

test("a startup failure keeps whether it never started or ended early, and a short message", () => {
    assert.deepEqual(describeStartupFailure({ code: 1, signal: null }), { kind: "exit", code: 1 });
    assert.deepEqual(describeStartupFailure({ code: null, signal: 9 }), { kind: "exit", code: 9 });
    assert.deepEqual(describeStartupFailure({}), { kind: "spawn", message: null });
    assert.deepEqual(describeStartupFailure(new Error(" program not found ")), { kind: "spawn", message: "program not found" });
    assert.deepEqual(describeStartupFailure("denied"), { kind: "spawn", message: "denied" });
    assert.deepEqual(describeStartupFailure(null), { kind: "spawn", message: null });
    assert.equal(describeStartupFailure(new Error("x".repeat(500))).message.length, 200);
});

test("startup downloads list only the models being fetched", () => {
    const downloads = startupDownloads({ translationWeights: [{ id: "small", progress: null },
        { id: "large", progress: 42.7 }, { id: "base", progress: null, is_pending: true }, { id: "tiny", progress: 120 }] });
    assert.deepEqual(downloads, [
        { kind: "translation", id: "large", progress: 42 },
        { kind: "translation", id: "base", progress: "pending" },
        { kind: "translation", id: "tiny", progress: 100 },
    ]);
    assert.deepEqual(startupDownloads({ translationWeights: undefined }), []);
});
