import assert from "node:assert/strict";
import { test } from "node:test";
import { conversionDelaySeconds } from "./conversionLatency.js";

test("the delay adds the app's block, the worker's delay and the round trip", () => {
    assert.deepEqual(conversionDelaySeconds({ active: true, conversion_device: "gpu", conversion_latency_ms: 52, round_trip_ms: 24 }),
        { device: "gpu", seconds: "0.2" });
    assert.deepEqual(conversionDelaySeconds({ active: true, conversion_device: "cpu", conversion_latency_ms: 1183, round_trip_ms: 1 }),
        { device: "cpu", seconds: "1.3" });
    // Before the first round trip is measured the worker's own delay still counts.
    assert.deepEqual(conversionDelaySeconds({ active: true, conversion_device: "cpu", conversion_latency_ms: 1183, round_trip_ms: null }),
        { device: "cpu", seconds: "1.3" });
});

test("nothing is shown when the conversion is not running or says nothing", () => {
    for (const state of [null, {}, { active: false, conversion_device: "gpu", conversion_latency_ms: 52 },
        { active: true, conversion_device: null, conversion_latency_ms: 52 },
        { active: true, conversion_device: "npu", conversion_latency_ms: 52 },
        { active: true, conversion_device: "gpu", conversion_latency_ms: null },
        { active: true, conversion_device: "gpu", conversion_latency_ms: -1 }]) {
        assert.equal(conversionDelaySeconds(state), null);
    }
});
