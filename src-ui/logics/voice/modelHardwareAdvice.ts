// What the hardware probe measured (models/model_downloads/hardware.py). Memory is in
// bytes; null where the device cannot report it.
export type HardwareDevice = {
    name?: string;
    description?: string;
    kind: "cpu" | "gpu" | "igpu";
    memory_total: number | null;
    memory_free: number | null;
};
export type HardwareState = {
    phase: "ready";
    devices: HardwareDevice[];
    measured_at_ms: number;
    error_code?: string | null;
} | {
    phase: "unknown" | "probing" | "failed" | "closed";
    devices: HardwareDevice[];
    measured_at_ms?: number | null;
    error_code?: string | null;
};

// A model's measured guidance (models/model_downloads/guidance.py).
export type ModelValidation = { state: string; scope?: string; device?: string; sampled_peak_bytes?: number | null };
export type ModelGuidance = { tier?: string; reference_memory_bytes: number; validation?: ModelValidation | null };
export type AdvisedModel = { id: string; guidance?: ModelGuidance | null };
type EligibleModel = AdvisedModel & { guidance: ModelGuidance & { validation: ModelValidation } };

export type ModelAdviceReason = "unknown" | "cpu" | "stale" | "shared_memory" | "unknown_memory" | "fits" | "low_memory" | "unverified";
export type ModelAdvice = { recommended: string | null; reason: ModelAdviceReason; device: HardwareDevice | null; multiple: boolean };
export type ModelAdviceOptions = { now?: number; reserveBytes?: number; deviceMode?: string };

const isGpu = (row: HardwareDevice) => row.kind === 'gpu' || row.kind === 'igpu';
// The engine's device choices (SpeechServers.jsx); anything else names one device.
const DEVICE_CHOICES = ['auto', 'cpu', 'gpu'];

// The GPU the speech engine runs on with `deviceMode`, or null on the CPU: the GPU the
// settings name, else the one the app passes for `auto` and `gpu` (preferred_gpu in
// native/speech-server/src/devices.rs): the separate GPU with the most memory, the first of
// equals. An integrated GPU is never chosen there, so without a separate GPU `auto` runs on
// the CPU. The advice and the warning describe that device and no other.
// A name the probe does not list is treated as `auto`.
export function engineGpu(hardware: { devices: HardwareDevice[] } | null | undefined, deviceMode = 'auto'): HardwareDevice | null {
    if (!hardware || deviceMode === 'cpu') return null;
    const named = DEVICE_CHOICES.includes(deviceMode) ? undefined : hardware.devices.find(row => row.name === deviceMode);
    if (named) return isGpu(named) ? named : null;
    const memory = (row: HardwareDevice) => Number.isSafeInteger(row.memory_total) && row.memory_total! > 0 ? row.memory_total! : 0;
    return hardware.devices.filter(row => row.kind === 'gpu')
        .reduce<HardwareDevice | null>((best, row) => !best || memory(row) > memory(best) ? row : best, null);
}

// Advisory only: measured memory on one GPU plus explicit headroom.
// Never add GPU memories or change the execution device / saved model path.
// `memory_free!`/`memory_total!`: Number.isSafeInteger has ruled out null before they are read.
export function modelAdvice(models: AdvisedModel[], hardware: HardwareState | null | undefined, { now = Date.now(), reserveBytes = 2 * 1024 ** 3, deviceMode = 'auto' }: ModelAdviceOptions = {}): ModelAdvice {
    const result: ModelAdvice = { recommended: null, reason: 'unknown', device: null, multiple: false };
    if (deviceMode === 'cpu') return { ...result, reason: 'cpu' };
    if (hardware?.phase !== 'ready') return result;
    if (!Number.isFinite(hardware.measured_at_ms) || now - hardware.measured_at_ms > 120000 || now < hardware.measured_at_ms)
        return { ...result, reason: 'stale' };
    const devices = hardware.devices.filter(isGpu);
    const device = engineGpu(hardware, deviceMode);
    if (!device) return { ...result, reason: hardware.devices.some(row => row.kind === 'cpu') ? 'cpu' : 'unknown' };
    const context = { ...result, device, multiple: devices.length > 1 };
    if (device.kind === 'igpu') return { ...context, reason: 'shared_memory' };
    if (!Number.isSafeInteger(device.memory_free) || !Number.isSafeInteger(device.memory_total) || device.memory_total! <= 0)
        return { ...context, reason: 'unknown_memory' };
    const eligible = models.filter((row): row is EligibleModel => row.guidance?.validation?.state === 'passed' && row.guidance.reference_memory_bytes > 0);
    // A 25% model allowance and the user's headroom are guidance, not a reservation.
    const chosen = eligible.find(row => Math.max(row.guidance.reference_memory_bytes,
        row.guidance.validation.sampled_peak_bytes ?? 0) * 1.25 + reserveBytes <= device.memory_free!);
    return { ...context, recommended: chosen?.id ?? null, reason: chosen ? 'fits' : eligible.length ? 'low_memory' : 'unverified' };
}
