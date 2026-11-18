import assert from "node:assert/strict";
import { test } from "vitest";
import { IDLE_GPU_CHECK, ISSUE_URL_LIMIT, deviceRows, gpuCheckAfterAnswer, gpuCheckAfterState, issueTitle, issueUrl } from "./gpuCheck.ts";

const REPORT = {
    report: "astarot-gpu-check", schema: 1,
    devices: [
        { device: "cpu", kind: "cpu", name: null },
        { device: "Vulkan0", kind: "gpu", name: "AMD Radeon RX 7800 XT" },
    ],
    tts: { runs: [{ device: "Vulkan0", ok: false, error: "out_of_memory" }, { device: "cpu", ok: true, rtfx: 0.1 }] },
    asr: { runs: [{ device: "cpu", ok: true, rtfx: 1.0, cer_to_cpu: 0 }, { device: "Vulkan0", ok: true, rtfx: 13.9, cer_to_cpu: 0.05 }] },
};

test("the polled state becomes the view; another shape leaves it as it was", () => {
    const done = gpuCheckAfterState(IDLE_GPU_CHECK, { state: "idle", run: 2, step: null, outcome: "done", error_code: null, report: REPORT, text: "{}" });
    assert.deepEqual(done, { phase: "idle", run: 2, step: null, outcome: "done", error: null, report: REPORT, text: "{}" });
    for (const odd of [null, "idle", { state: "playing", run: 1 }, { state: "idle" }, { state: "idle", run: "2" }]) {
        assert.equal(gpuCheckAfterState(done, odd), done, JSON.stringify(odd));
    }
    // A report of another shape is not shown as one.
    assert.equal(gpuCheckAfterState(IDLE_GPU_CHECK, { state: "idle", run: 1, outcome: "done", report: [1], text: "x" }).report, null);
});

test("a start waits for its answer: an earlier idle state does not end it", () => {
    const pending = { ...IDLE_GPU_CHECK, phase: "pending", run: 3 };
    assert.equal(gpuCheckAfterState(pending, { state: "idle", run: 3, outcome: "done" }), pending);
    assert.equal(gpuCheckAfterState(pending, { state: "running", run: 4, step: "tts" }).phase, "running");
    assert.equal(gpuCheckAfterAnswer(pending, { state: "running", run: 4 }).phase, "running");
    // Refused (the app is closing): back to idle; the next poll says why.
    assert.equal(gpuCheckAfterAnswer(pending, { state: "idle", run: 3 }).phase, "idle");
    assert.equal(gpuCheckAfterAnswer(pending, "odd"), pending);
});

test("the table has one row per device with its two runs", () => {
    assert.deepEqual(deviceRows(REPORT).map(row => [row.device, row.name, row.tts?.ok, row.asr?.cer_to_cpu]), [
        ["cpu", null, true, 0],
        ["Vulkan0", "AMD Radeon RX 7800 XT", false, 0.05],
    ]);
    assert.deepEqual(deviceRows({ ...REPORT, tts: { skipped: "no_model" } }).map(row => row.tts), [null, null]);
    assert.deepEqual(deviceRows(null), []);
});

test("the issue names the first GPU and carries the report while the address stays short", () => {
    assert.equal(issueTitle(REPORT), "GPU report: AMD Radeon RX 7800 XT");
    assert.equal(issueTitle({ devices: [{ device: "cpu", kind: "cpu", name: null }] }), "GPU report: no GPU");
    const short = issueUrl(REPORT, '{"schema": 1}');
    assert.equal(short.filled, true);
    const url = new URL(short.url);
    assert.equal(`${url.origin}${url.pathname}`, "https://github.com/kein5/astarot/issues/new");
    assert.equal(url.searchParams.get("template"), "gpu_report.yml");
    assert.equal(url.searchParams.get("report"), '{"schema": 1}');
    const long = issueUrl(REPORT, "x".repeat(ISSUE_URL_LIMIT));
    assert.equal(long.filled, false);
    assert.equal(new URL(long.url).searchParams.get("report"), null);
});
