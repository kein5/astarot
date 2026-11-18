// The GPUs' memory (VRAM) from /get/data/gpu_memory, worded for the flow panel (#448).
// The backend reads it only while the panel asks (every 2 s while it is open); sizes are bytes.
import type { Translate } from "./flowText.ts";

export type GpuMemoryState = "measuring" | "ready" | "unsupported" | "failed";
export type AppPart = "speech" | "conversion" | "other";

export interface GpuReading {
    name: string;
    total: number | null;
    used: number | null;
    app: Record<AppPart, number>;
    app_shared: number | null;
}

export interface GpuMemory {
    state: GpuMemoryState;
    gpus: GpuReading[];
    age_ms: number | null;
}

export interface GpuSegment {
    part: AppPart | "rest";
    share: number;
}

export interface GpuRow {
    name: string;
    // "dedicated": the GPU's own memory; "shared": system memory an integrated GPU works in.
    memory: "dedicated" | "shared";
    app: string;
    // The app's parts it uses, each worded, in the order of the bar.
    parts: { part: AppPart; text: string }[];
    whole: string | null;
    // The bar: the app's parts and the rest of the GPU's use, as shares of its total (0 to 1).
    segments: GpuSegment[];
}

// How often the panel asks while it is open, and the backend's reading is at most this old.
export const GPU_MEMORY_POLL_MS = 2000;
// An older reading was taken before the panel was opened again.
const STALE_MS = 5000;
// A GPU with less of its own memory than this is integrated: it works in system memory.
const INTEGRATED_BELOW = 1024 ** 3;
const PARTS: readonly AppPart[] = ["speech", "conversion", "other"];
const STATES: readonly GpuMemoryState[] = ["measuring", "ready", "unsupported", "failed"];

const isBytes = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const readGpu = (gpu: unknown): GpuReading | null => {
    if (!gpu || typeof gpu !== "object") return null;
    const row = gpu as Record<string, unknown>;
    const app = row.app as Record<string, unknown> | null | undefined;
    if (typeof row.name !== "string" || !app || typeof app !== "object" || !PARTS.every(part => isBytes(app[part]))) return null;
    return {
        name: row.name.slice(0, 128),
        total: isBytes(row.total) ? row.total : null,
        used: isBytes(row.used) ? row.used : null,
        app: { speech: app.speech as number, conversion: app.conversion as number, other: app.other as number },
        app_shared: isBytes(row.app_shared) ? row.app_shared : null,
    };
};

// The answer as the panel may trust it, or null when it is not one. A reading left from the
// last time the panel was open is not shown: the new one follows within a poll.
export const readGpuMemory = (answer: unknown): GpuMemory | null => {
    if (!answer || typeof answer !== "object") return null;
    const value = answer as Record<string, unknown>;
    if (!(STATES as readonly unknown[]).includes(value.state) || !Array.isArray(value.gpus)) return null;
    const gpus = value.gpus.map(readGpu);
    if (gpus.some(gpu => gpu === null)) return null;
    const age = isBytes(value.age_ms) ? value.age_ms : null;
    if (age !== null && age > STALE_MS) return { state: "measuring", gpus: [], age_ms: age };
    return { state: value.state as GpuMemoryState, gpus: gpus as GpuReading[], age_ms: age };
};

// Sizes as people read them: GB with one decimal from 1 GB, else whole MB.
export const formatBytes = (bytes: unknown): string => {
    if (!isBytes(bytes)) return "—";
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    return `${Math.round(bytes / 1024 ** 2)} MB`;
};

const appTotal = (gpu: GpuReading): number => PARTS.reduce((sum, part) => sum + gpu.app[part], 0);

const integrated = (gpu: GpuReading): boolean => gpu.total === null || gpu.total < INTEGRATED_BELOW;

// The GPUs worth a row: those with memory of their own, and an integrated one only while the
// app works on it.
export const shownGpus = (memory: GpuMemory | null | undefined): GpuReading[] => (memory?.gpus ?? [])
    .filter(gpu => !integrated(gpu) || appTotal(gpu) > 0 || (gpu.app_shared ?? 0) > 0);

export const gpuRows = (memory: GpuMemory | null | undefined, t: Translate): GpuRow[] => shownGpus(memory).map(gpu => {
    const parts = PARTS.filter(part => gpu.app[part] > 0)
        .map(part => ({ part, text: t(`io_flow.gpu.part.${part}`, { size: formatBytes(gpu.app[part]) }) }));
    if (integrated(gpu)) {
        // Its own memory is a few MB at most; what the app holds there is in system memory.
        return { name: gpu.name, memory: "shared", app: formatBytes((gpu.app_shared ?? 0) + appTotal(gpu)), parts, whole: null, segments: [] };
    }
    const total = gpu.total as number;
    const app = appTotal(gpu);
    const share = (bytes: number) => Math.min(1, Math.max(0, bytes / total));
    const segments: GpuSegment[] = PARTS.filter(part => gpu.app[part] > 0).map(part => ({ part, share: share(gpu.app[part]) }));
    if (gpu.used !== null && gpu.used > app) segments.push({ part: "rest", share: share(gpu.used - app) });
    return {
        name: gpu.name, memory: "dedicated", app: formatBytes(app), parts,
        whole: t("io_flow.gpu.whole", { used: formatBytes(gpu.used), total: formatBytes(total) }),
        segments,
    };
});
