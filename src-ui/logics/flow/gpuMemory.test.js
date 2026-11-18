import { test } from "vitest";
import assert from "node:assert/strict";
import { formatBytes, gpuRows, readGpuMemory, shownGpus } from "./gpuMemory.ts";

const t = (key, options) => options ? `${key}:${JSON.stringify(options)}` : key;
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const gpu = (extra = {}) => ({ name: "Test GPU", total: 8 * GB, used: 3 * GB,
    app: { speech: GB, conversion: 512 * MB, other: 256 * MB }, app_shared: 0, ...extra });
const answer = (gpus, extra = {}) => ({ state: "ready", gpus, age_ms: 300, ...extra });

test("only a well-formed answer is read", () => {
    assert.deepEqual(readGpuMemory(answer([gpu()])), answer([gpu()]));
    assert.equal(readGpuMemory(null), null);
    assert.equal(readGpuMemory({ state: "busy", gpus: [] }), null);
    assert.equal(readGpuMemory({ state: "ready", gpus: null }), null);
    assert.equal(readGpuMemory(answer([gpu({ app: { speech: -1, conversion: 0, other: 0 } })])), null);
    assert.equal(readGpuMemory(answer([gpu({ name: 3 })])), null);
    // Numbers the driver does not tell are null, not zero.
    const unknown = readGpuMemory(answer([gpu({ total: null, used: "x", app_shared: undefined })])).gpus[0];
    assert.deepEqual([unknown.total, unknown.used, unknown.app_shared], [null, null, null]);
});

test("a reading left from an earlier opening of the panel is not shown", () => {
    assert.deepEqual(readGpuMemory(answer([gpu()], { age_ms: 60000 })), { state: "measuring", gpus: [], age_ms: 60000 });
    assert.equal(readGpuMemory(answer([gpu()], { age_ms: 4000 })).state, "ready");
});

test("sizes read as GB from 1 GB, else whole MB", () => {
    assert.equal(formatBytes(3 * GB), "3.0 GB");
    assert.equal(formatBytes(1.25 * GB), "1.3 GB");
    assert.equal(formatBytes(512 * MB), "512 MB");
    assert.equal(formatBytes(0), "0 MB");
    assert.equal(formatBytes(null), "—");
});

test("a GPU's row gives the app's use by part and the whole GPU's use", () => {
    const [row] = gpuRows(answer([gpu()]), t);
    assert.equal(row.memory, "dedicated");
    assert.equal(row.app, "1.8 GB");
    assert.deepEqual(row.parts, [{ part: "speech", text: 'io_flow.gpu.part.speech:{"size":"1.0 GB"}' },
        { part: "conversion", text: 'io_flow.gpu.part.conversion:{"size":"512 MB"}' }, { part: "other", text: 'io_flow.gpu.part.other:{"size":"256 MB"}' }]);
    assert.equal(row.whole, 'io_flow.gpu.whole:{"used":"3.0 GB","total":"8.0 GB"}');
    assert.deepEqual(row.segments, [{ part: "speech", share: 1 / 8 }, { part: "conversion", share: 1 / 16 }, { part: "other", share: 1 / 32 },
        { part: "rest", share: 1.25 / 8 }]);
    // Parts the app does not use are left out, and nothing exceeds the bar.
    const [idle] = gpuRows(answer([gpu({ used: null, app: { speech: 0, conversion: 0, other: 9 * GB } })]), t);
    assert.deepEqual(idle.segments, [{ part: "other", share: 1 }]);
    assert.equal(idle.whole, 'io_flow.gpu.whole:{"used":"—","total":"8.0 GB"}');
});

test("an integrated GPU shows only while the app works on it, in shared memory", () => {
    const igpu = gpu({ name: "Integrated", total: 128 * MB, used: 0, app: { speech: 0, conversion: 0, other: 0 }, app_shared: 140 * MB });
    const idle = { ...igpu, app_shared: 0 };
    assert.deepEqual(shownGpus(answer([idle, gpu()])).map(row => row.name), ["Test GPU"]);
    const [row] = gpuRows(answer([igpu]), t);
    assert.deepEqual([row.memory, row.app, row.whole, row.segments], ["shared", "140 MB", null, []]);
    assert.deepEqual(gpuRows(null, t), []);
});
