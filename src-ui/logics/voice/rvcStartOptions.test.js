import assert from "node:assert/strict";
import { test } from "node:test";
import { rvcStartOptions } from "./rvcStartOptions.js";

const saved = { rvc_runtime: "/r", rvc_model: "/v.pth", rvc_index: "", rvc_pitch: 3, rvc_index_rate: 0 };

test("settings saved before the worker choices start the worker as before", () => {
    assert.deepEqual(rvcStartOptions(saved), { engine: "rvc", runtime: "/r", model: "/v.pth", index: "", pitch: 3, index_rate: 0,
        device: "auto", threads: 0, highpass: true });
});

test("the saved worker choices go with the start", () => {
    const options = rvcStartOptions({ ...saved, rvc_device: "cpu", rvc_threads: 4, rvc_highpass: false });
    assert.deepEqual([options.device, options.threads, options.highpass], ["cpu", 4, false]);
});
