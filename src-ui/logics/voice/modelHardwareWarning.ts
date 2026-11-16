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

export type WarnedModel = {
    profile?: { memory_bytes?: number | null; cpu?: string | null; gpu?: string | null } | null;
    guidance?: ModelGuidance | null;
};

// low_memory: the model's memory (plus the same 25% allowance as modelHardwareAdvice.ts) is more
// than the device has in total. no_gpu / cpu_setting: the model is too slow on a CPU and no GPU
// was found, or the engine is set to run on the CPU.
export type HardwareWarningReason = "low_memory" | "no_gpu" | "cpu_setting";
export type HardwareWarning = { reason: HardwareWarningReason; required: number | null; available: number | null; device: HardwareDevice | null };

const ALLOWANCE = 1.25;
// The CPU marks of a model that a CPU does not run at a usable speed (catalog speechcpp_asr.py).
const SLOW_ON_CPU = ["impractical", "slow"];
// The engine's device choices (SpeechServers.jsx); anything else names one device.
const DEVICE_CHOICES = ["auto", "cpu", "gpu"];

const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

// The memory a model is said to use, or null when the catalog has no figure for it.
export function requiredMemory(model: WarnedModel): number | null {
    const guidance = model.guidance;
    const figures = [model.profile?.memory_bytes, guidance?.reference_memory_bytes,
        guidance?.validation?.state === "passed" ? guidance.validation?.sampled_peak_bytes : null].filter(positive);
    return figures.length ? Math.max(...figures) : null;
}

export function hardwareWarning(model: WarnedModel, hardware: HardwareState | null | undefined,
    { deviceMode = "auto" }: { deviceMode?: string } = {}): HardwareWarning | null {
    // Nothing measured, nothing to say: an unknown PC is never shown as too weak.
    if (hardware?.phase !== "ready") return null;
    const named = DEVICE_CHOICES.includes(deviceMode) ? null : hardware.devices.find(row => row.name === deviceMode);
    const devices = named ? [named] : hardware.devices;
    const gpus = deviceMode === "cpu" ? [] : devices.filter(row => row.kind === "gpu" || row.kind === "igpu");
    const required = requiredMemory(model);
    if (!gpus.length) {
        if (model.profile?.gpu === "recommended" && SLOW_ON_CPU.includes(model.profile?.cpu ?? ""))
            return { reason: deviceMode === "cpu" || named?.kind === "cpu" ? "cpu_setting" : "no_gpu", required, available: null, device: null };
        const cpu = devices.find(row => row.kind === "cpu" && positive(row.memory_total));
        if (cpu && required !== null && required * ALLOWANCE > cpu.memory_total!)
            return { reason: "low_memory", required, available: cpu.memory_total, device: cpu };
        return null;
    }
    if (required === null) return null;
    // The largest GPU the engine may use; GPU memories are never added together.
    const measured = gpus.filter(row => positive(row.memory_total));
    if (!measured.length) return null;
    const device = measured.reduce((best, row) => row.memory_total! > best.memory_total! ? row : best);
    return required * ALLOWANCE > device.memory_total!
        ? { reason: "low_memory", required, available: device.memory_total, device } : null;
}
