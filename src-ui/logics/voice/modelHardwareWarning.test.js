import { test } from "vitest";
import assert from "node:assert/strict";
import { hardwareWarning, requiredMemory, translationDeviceMode } from "./modelHardwareWarning.ts";

const GiB = 1024 ** 3;
const ready = devices => ({ phase: "ready", measured_at_ms: 1, devices });
const gpu = (total, extra = {}) => ({ name: "Vulkan0", description: "GPU", kind: "gpu", memory_total: total, memory_free: total, ...extra });
const cpu = (total = null) => ({ name: "CPU", description: "CPU", kind: "cpu", memory_total: total, memory_free: total });
const model = (memory, extra = {}) => ({ profile: { memory_bytes: memory, cpu: "impractical", gpu: "recommended", ...extra } });

test("a model larger than the GPU's total memory is warned about", () => {
    const warning = hardwareWarning(model(20 * GiB), ready([cpu(), gpu(16 * GiB)]));
    assert.equal(warning.reason, "low_memory");
    assert.equal(warning.required, 20 * GiB);
    assert.equal(warning.available, 16 * GiB);
});

test("a model that fits the total is not warned about, even when the free memory is low", () => {
    assert.equal(hardwareWarning(model(4 * GiB), ready([gpu(8 * GiB, { memory_free: GiB })])), null);
});

test("the same 25% allowance as the advice is added to the model's memory", () => {
    assert.equal(hardwareWarning(model(7 * GiB), ready([gpu(8 * GiB)])).reason, "low_memory");
    assert.equal(hardwareWarning(model(6 * GiB), ready([gpu(8 * GiB)])), null);
});

test("on auto the separate GPU with the most memory is compared and GPU memories are never added", () => {
    // The app starts auto and gpu on that GPU (preferred_gpu), not on the first one listed.
    const devices = [gpu(4 * GiB), gpu(12 * GiB, { name: "Vulkan1" })];
    for (const deviceMode of ["auto", "gpu"]) {
        const warning = hardwareWarning(model(12 * GiB), ready(devices), { deviceMode });
        assert.equal(warning.device.name, "Vulkan1");
        assert.equal(warning.available, 12 * GiB);
    }
});

test("on auto an integrated GPU is never compared", () => {
    const devices = [gpu(32 * GiB, { kind: "igpu" }), cpu(16 * GiB)];
    assert.equal(hardwareWarning(model(GiB), ready(devices)).reason, "no_gpu");
});

test("a GPU named in the engine's settings is the one compared", () => {
    const devices = [gpu(4 * GiB), gpu(12 * GiB, { name: "Vulkan1" })];
    assert.equal(hardwareWarning(model(8 * GiB), ready(devices), { deviceMode: "Vulkan0" }).reason, "low_memory");
    assert.equal(hardwareWarning(model(8 * GiB), ready(devices), { deviceMode: "Vulkan1" }), null);
    // A name the probe does not know is treated as auto.
    assert.equal(hardwareWarning(model(12 * GiB), ready(devices), { deviceMode: "Vulkan9" }).device.name, "Vulkan1");
});

test("an integrated GPU's shared memory does not stand in for the chosen GPU", () => {
    // The beta.5 PC: Vulkan0 an Iris Xe reporting 16 GiB of shared memory, Vulkan1 an 8 GiB RTX.
    const devices = [gpu(16 * GiB, { kind: "igpu" }), gpu(8 * GiB, { name: "Vulkan1" }), cpu(32 * GiB)];
    const warning = hardwareWarning(model(10 * GiB), ready(devices), { deviceMode: "Vulkan1" });
    assert.equal(warning.device.name, "Vulkan1");
    assert.equal(warning.available, 8 * GiB);
});

test("a model too slow on a CPU is warned about without a GPU or on the CPU setting", () => {
    assert.equal(hardwareWarning(model(GiB), ready([cpu()])).reason, "no_gpu");
    assert.equal(hardwareWarning(model(GiB, { cpu: "slow" }), ready([cpu()])).reason, "no_gpu");
    assert.equal(hardwareWarning(model(GiB), ready([cpu(), gpu(16 * GiB)]), { deviceMode: "cpu" }).reason, "cpu_setting");
    // A model that runs on a CPU, or one not measured there, is not.
    assert.equal(hardwareWarning(model(null, { cpu: "practical", gpu: "not_needed" }), ready([cpu()])), null);
    assert.equal(hardwareWarning(model(GiB, { cpu: "unverified" }), ready([cpu()])), null);
});

test("on the CPU a model larger than the reported memory is warned about", () => {
    assert.equal(hardwareWarning(model(20 * GiB, { cpu: "unverified" }), ready([cpu(16 * GiB)])).reason, "low_memory");
});

test("an unknown PC or a model without figures is never warned about", () => {
    for (const phase of ["unknown", "probing", "failed", "closed"])
        assert.equal(hardwareWarning(model(99 * GiB), { phase, devices: [] }), null);
    assert.equal(hardwareWarning(model(99 * GiB), null), null);
    assert.equal(hardwareWarning(model(99 * GiB), ready([gpu(null)])), null);
    // RVC: no profile, no memory figure.
    const rvc = { profile: null, guidance: { tier: "voice", reference_memory_bytes: null, validation: { state: "passed" } } };
    assert.equal(hardwareWarning(rvc, ready([gpu(2 * GiB)])), null);
    assert.equal(hardwareWarning(rvc, ready([cpu()])), null);
});

test("the larger of the catalog's figures is the model's memory", () => {
    assert.equal(requiredMemory({ profile: { memory_bytes: 2 }, guidance: { reference_memory_bytes: 3,
        validation: { state: "passed", sampled_peak_bytes: 4 } } }), 4);
    assert.equal(requiredMemory({ profile: { memory_bytes: 2 }, guidance: { reference_memory_bytes: 3,
        validation: { state: "pending", sampled_peak_bytes: 9 } } }), 3);
    assert.equal(requiredMemory({ profile: null, guidance: null }), null);
});

// The local translation (#597): NLLB-200 distilled 600M's guidance (native/ops guidance.rs).
const nllb = { target: "translation", profile: null, guidance: { tier: "translation", reference_memory_bytes: 1_490_300_928,
    validation: { state: "passed", scope: "translation_onnx_cpu", device: "Intel Core i7-1255U", sampled_peak_bytes: 1_490_300_928 } } };
// The PC of the measurements: an Iris Xe (shared memory), an 8 GiB RTX and 32 GiB of RAM.
const laptop = ready([gpu(16 * GiB, { kind: "igpu", description: "Intel(R) Iris(R) Xe Graphics" }),
    gpu(8 * GiB, { name: "Vulkan1", description: "NVIDIA GeForce RTX 3060 Ti" }), cpu(32 * GiB)]);
const translationWarning = (device, hardware) => {
    const deviceMode = translationDeviceMode(device, hardware);
    return deviceMode === null ? null : hardwareWarning(nllb, hardware, { deviceMode });
};

test("the local translation is compared with the RAM by default, not with a GPU", () => {
    for (const device of ["", null, undefined, { device: "cpu", device_index: 0, device_name: "CPU" }])
        assert.equal(translationDeviceMode(device, laptop), "cpu");
    // 1.39 GiB and the 25% allowance: about 1.73 GiB.
    const warning = translationWarning({ device: "cpu", device_index: 0 }, ready([gpu(8 * GiB), cpu(GiB)]));
    assert.equal(warning.reason, "low_memory");
    assert.equal(warning.device.kind, "cpu");
    assert.equal(warning.required, 1_490_300_928);
    assert.equal(warning.available, GiB);
    assert.equal(translationWarning("", ready([cpu(1.5 * GiB)])).reason, "low_memory");
    assert.equal(translationWarning("", ready([cpu(2 * GiB)])), null);
    assert.equal(translationWarning("", laptop), null);
    // A GPU too small for it does not matter while the translation runs on the CPU.
    assert.equal(translationWarning("", ready([gpu(GiB), cpu(16 * GiB)])), null);
});

test("a translation set to a GPU is compared with that GPU's memory", () => {
    assert.equal(translationDeviceMode({ device: "cuda", device_index: 0 }, laptop), "Vulkan1");
    assert.equal(translationDeviceMode({ device: "tensorrt", device_index: 0 }, laptop), "Vulkan1");
    // DirectML counts every adapter: device 0 is the Iris Xe here, 1 the RTX.
    assert.equal(translationDeviceMode({ device: "directml", device_index: 0 }, laptop), "Vulkan0");
    assert.equal(translationDeviceMode({ device: "directml", device_index: 1 }, laptop), "Vulkan1");
    const small = ready([gpu(GiB, { description: "NVIDIA GeForce GT 1030" }), cpu(32 * GiB)]);
    const warning = translationWarning({ device: "cuda", device_index: 0 }, small);
    assert.equal(warning.reason, "low_memory");
    assert.equal(warning.device.kind, "gpu");
    assert.equal(translationWarning({ device: "cuda", device_index: 0 }, laptop), null);
});

test("a translation GPU the probe cannot point at is not compared", () => {
    // No NVIDIA GPU for CUDA, an index past the list, OpenVINO (CPU or GPU), and no probe yet.
    const amd = ready([gpu(GiB, { description: "AMD Radeon RX 6400" }), cpu(GiB)]);
    assert.equal(translationDeviceMode({ device: "cuda", device_index: 0 }, amd), null);
    assert.equal(translationDeviceMode({ device: "migraphx", device_index: 0 }, amd), "Vulkan0");
    assert.equal(translationDeviceMode({ device: "directml", device_index: 3 }, laptop), null);
    assert.equal(translationDeviceMode({ device: "openvino", device_index: 0 }, laptop), null);
    assert.equal(translationDeviceMode({ device: "cuda", device_index: 0 }, { phase: "failed", devices: [] }), null);
    assert.equal(translationWarning({ device: "cuda", device_index: 0 }, amd), null);
});

test("a translation model without a measurement is never warned about", () => {
    const m2m100 = { target: "translation", profile: null, guidance: { tier: "unknown", reference_memory_bytes: null, validation: { state: "pending" } } };
    assert.equal(hardwareWarning(m2m100, ready([cpu(GiB / 4)]), { deviceMode: "cpu" }), null);
    // The probe failed (no speech.cpp to ask): an unknown PC is not shown as too weak.
    assert.equal(translationWarning("", { phase: "failed", devices: [], error_code: "hardware_unavailable" }), null);
});