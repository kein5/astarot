// Whether a catalog model looks too heavy for the user's PC (issue #405). Advisory only: the
// card shows a warning and the user can still choose, download and apply the model.
//
// It reads what the hardware probe measured (models/model_downloads/hardware.py) and what the
// catalog says of the model: the peak memory from its card (`profile.memory_bytes`), or the
// measured guidance (`guidance.reference_memory_bytes`), and whether it needs a GPU
// (`profile.gpu`, `profile.cpu`). It compares the memory with the device's total, not its free
// memory: free memory changes from moment to moment, and modelHardwareAdvice.ts already
// suggests the file type that fits it. A model without figures (RVC) gets no warning.
import type { HardwareDevice, HardwareState, ModelGuidance } from "./modelHardwareAdvice.ts";
import { engineGpu } from "./modelHardwareAdvice.ts";

export type WarnedModel = {
    profile?: { memory_bytes?: number | null; cpu?: string | null; gpu?: string | null } | null;
    guidance?: ModelGuidance | null;
};

// low_memory: the model's memory (plus the same 25% allowance as modelHardwareAdvice.ts) is more
// than the device has in total once the share of what runs next to it is kept back: RAM_RESERVE
// on the RAM, GPU_RESERVE on a GPU. Every model is compared this way, not only translation.
// no_gpu / cpu_setting: the model is too slow on a CPU and no GPU was found, or the engine is set
// to run on the CPU. `reserve` is the memory kept back on the device compared.
export type HardwareWarningReason = "low_memory" | "no_gpu" | "cpu_setting";
export type HardwareWarning = { reason: HardwareWarningReason; required: number | null; available: number | null;
    device: HardwareDevice | null; reserve: number | null };

const ALLOWANCE = 1.25;
const GiB = 1024 ** 3;
// The RAM the OS and VRChat use while a model runs on the CPU (#405; decided 2026-11-19, values
// reviewed 2026-11-20 from what was measured rather than the makers' minimums). The OS: Windows 11
// used 5.3 GB on an 8 GB laptop just after start (25H2; 4.1 GB on 26H2). VRChat: in VR with a
// browser open, whole PCs used 17.9-21.1 GB with 32 GB or more and were held to 12.6-14.3 GB with
// 16 GB, so VRChat took about 8 GB or more. docs/voice-stack/model-downloads.md has the sources.
export const RAM_RESERVE = { os: 5 * GiB, vrchat: 8 * GiB };
const RESERVED_RAM = RAM_RESERVE.os + RAM_RESERVE.vrchat;
// VRChat's share of the GPU's memory (decided 2026-11-20).
export const GPU_RESERVE = { vrchat: 4 * GiB };
const RESERVED_GPU = GPU_RESERVE.vrchat;
// The CPU marks of a model that a CPU does not run at a usable speed (native/ops/data/speechcpp_asr.json).
const SLOW_ON_CPU = ["impractical", "slow"];
// The engine's device choices (SpeechServers.tsx); anything else names one device.
const DEVICE_CHOICES = ["auto", "cpu", "gpu"];

const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

// The memory a model is said to use, or null when the catalog has no figure for it.
export function requiredMemory(model: WarnedModel): number | null {
    const guidance = model.guidance;
    const figures = [model.profile?.memory_bytes, guidance?.reference_memory_bytes,
        guidance?.validation?.state === "passed" ? guidance.validation?.sampled_peak_bytes : null].filter(positive);
    return figures.length ? Math.max(...figures) : null;
}

// The saved device of the local translation (SELECTED_TRANSLATION_COMPUTE_DEVICE): `device` is
// the ONNX Runtime provider (cpu, directml, cuda...), `device_index` its own count of devices.
export type TranslationDevice = { device?: string | null; device_index?: number | null } | "" | null | undefined;

// The GPUs a provider counts, by the probe's description; the others count every GPU.
const PROVIDER_VENDORS: Record<string, RegExp> = { cuda: /nvidia/i, tensorrt: /nvidia/i, migraphx: /amd|radeon/i };
// Providers that may run on the CPU or on a GPU: the probe cannot tell which.
const UNPLACED_PROVIDERS = ["openvino"];

// The deviceMode of hardwareWarning for the local translation, which runs where its own setting
// says, not where the speech engine does: "cpu" for the CPU (the default, also while the setting
// has not arrived), else the probe's name of the GPU the provider uses. The provider numbers the
// GPUs it sees in the system's order, which the probe's order follows on the PCs checked so far.
// null when that GPU is not among the probe's rows: then nothing is compared.
export function translationDeviceMode(device: TranslationDevice, hardware: HardwareState | null | undefined): string | null {
    const provider = device && typeof device === "object" ? device.device : null;
    if (!provider || provider === "cpu") return "cpu";
    if (hardware?.phase !== "ready" || UNPLACED_PROVIDERS.includes(provider)) return null;
    const index = Number.isSafeInteger(device && typeof device === "object" ? device.device_index : null)
        ? (device as { device_index: number }).device_index : 0;
    const vendor = PROVIDER_VENDORS[provider];
    const gpus = hardware.devices.filter(row => (row.kind === "gpu" || row.kind === "igpu")
        && (!vendor || vendor.test(row.description ?? "")));
    return (index >= 0 ? gpus[index]?.name : null) ?? null;
}

export function hardwareWarning(model: WarnedModel, hardware: HardwareState | null | undefined,
    { deviceMode = "auto" }: { deviceMode?: string } = {}): HardwareWarning | null {
    // Nothing measured, nothing to say: an unknown PC is never shown as too weak.
    if (hardware?.phase !== "ready") return null;
    const named = DEVICE_CHOICES.includes(deviceMode) ? null : hardware.devices.find(row => row.name === deviceMode);
    const devices = named ? [named] : hardware.devices;
    // The GPU the engine runs on (engineGpu), not the one with the most memory: an integrated
    // GPU reports the PC's shared memory and used to stand in for the GPU actually chosen.
    const gpu = engineGpu(hardware, deviceMode);
    const required = requiredMemory(model);
    if (!gpu) {
        if (model.profile?.gpu === "recommended" && SLOW_ON_CPU.includes(model.profile?.cpu ?? ""))
            return { reason: deviceMode === "cpu" || named?.kind === "cpu" ? "cpu_setting" : "no_gpu", required, available: null, device: null, reserve: null };
        const cpu = devices.find(row => row.kind === "cpu" && positive(row.memory_total));
        if (cpu && required !== null && required * ALLOWANCE + RESERVED_RAM > cpu.memory_total!)
            return { reason: "low_memory", required, available: cpu.memory_total, device: cpu, reserve: RESERVED_RAM };
        return null;
    }
    // GPU memories are never added together.
    if (required === null || !positive(gpu.memory_total)) return null;
    return required * ALLOWANCE + RESERVED_GPU > gpu.memory_total
        ? { reason: "low_memory", required, available: gpu.memory_total, device: gpu, reserve: RESERVED_GPU } : null;
}
