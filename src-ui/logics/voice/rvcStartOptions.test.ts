import assert from "node:assert/strict";
import { test } from "vitest";
import { rvcDevices, rvcStartOptions } from "./rvcStartOptions.ts";

const saved = { rvc_runtime: "/r", rvc_model: "/v.pth", rvc_index: "", rvc_pitch: 3, rvc_index_rate: 0 };

test("settings saved before the worker choices start the worker as before", () => {
    assert.deepEqual(rvcStartOptions(saved), { engine: "rvc", runtime: "/r", model: "/v.pth", index: "", pitch: 3, index_rate: 0,
        device: "auto", threads: 0, highpass: true });
});

test("the saved worker choices go with the start", () => {
    const options = rvcStartOptions({ ...saved, rvc_device: "cpu", rvc_threads: 4, rvc_highpass: false });
    assert.deepEqual([options.device, options.threads, options.highpass], ["cpu", 4, false]);
    assert.equal(rvcStartOptions({ ...saved, rvc_device: "directml" }).device, "directml");
});

test("DirectML is listed where its runtime is offered, and a saved choice is always listed", () => {
    assert.deepEqual(rvcDevices(true), ["auto", "cuda", "directml", "cpu"]);
    // Linux: the backend offers no DirectML runtime.
    assert.deepEqual(rvcDevices(false), ["auto", "cuda", "cpu"]);
    assert.deepEqual(rvcDevices(false, "directml"), ["auto", "cuda", "directml", "cpu"]);
    assert.deepEqual(rvcDevices(false, "cpu"), ["auto", "cuda", "cpu"]);
});
