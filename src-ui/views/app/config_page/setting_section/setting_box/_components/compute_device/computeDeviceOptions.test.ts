import assert from "node:assert/strict";
import { test } from "vitest";
import { buildComputeDeviceOptions, computeDeviceLabel, needsRestart } from "./computeDeviceOptions";

const t = (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`;
const cpu = { device: "cpu", device_index: 0, device_name: "cpu", compute_types: ["auto", "float32", "int8"] };
const cuda = { device: "cuda", device_index: 0, device_name: "NVIDIA GPU (CUDA)", compute_types: ["auto", "float32", "float16", "int4"] };
const later = { ...cuda, restart_required: true };

test("a GPU set up during the run says it is used after a restart", () => {
    // The list the backend sends, by index (transformToIndexedArray).
    const options = buildComputeDeviceOptions({ 0: cpu, 1: later }, { ...later }, t);
    assert.deepEqual(options.device_labels, {
        0: "CPU",
        1: `config_page.common.compute_device.after_restart:${JSON.stringify({ device: "NVIDIA GPU (CUDA)" })}`,
    });
    assert.equal(options.selected_device_id, 1);
    assert.deepEqual(Object.keys(options.compute_type_labels), ["auto", "int4", "float16", "float32"]);
    // Loaded at start, it is named as before.
    assert.deepEqual(buildComputeDeviceOptions({ 0: cpu, 1: cuda }, cuda, t).device_labels, { 0: "CPU", 1: "NVIDIA GPU (CUDA)" });
});

test("the label of the chosen device names the restart only when one is needed", () => {
    assert.equal(needsRestart(later), true);
    assert.equal(needsRestart(cuda), false);
    assert.equal(needsRestart(null), false);
    assert.equal(computeDeviceLabel(cpu, t), "CPU");
    assert.equal(computeDeviceLabel(cuda, t), "NVIDIA GPU (CUDA)");
    assert.match(computeDeviceLabel(later, t) ?? "", /^config_page\.common\.compute_device\.after_restart:/);
    assert.equal(computeDeviceLabel(undefined, t), undefined);
});
