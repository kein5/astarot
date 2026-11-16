// Pure helpers for Config → Chat reading: the reading region and the readiness summary.
// The backend validates the region again (config.py); these keep the sliders consistent.

export type RegionKey = "x" | "y" | "width" | "height";
// Fractions of the screen's width and height (OCR_CAPTURE_REGION, OCR_VR_CAPTURE_REGION).
export type OcrRegion = Record<RegionKey, number>;
// A region as saved or as the backend sends it: checked and clamped before use.
export type OcrRegionInput = { [key: string]: unknown } | null | undefined;

export const FULL_REGION: Readonly<OcrRegion> = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
export const MIN_REGION_SIDE = 0.02;
const KEYS: readonly string[] = ["x", "y", "width", "height"];

const finite = (value: unknown, fallback: number): number => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round = (value: number): number => Math.round(value * 10000) / 10000;

export const normalizeRegion = (region: OcrRegionInput): OcrRegion => {
    const source = region && typeof region === "object" ? region : FULL_REGION;
    let x = Math.min(Math.max(finite(source.x, 0), 0), 1 - MIN_REGION_SIDE);
    let y = Math.min(Math.max(finite(source.y, 0), 0), 1 - MIN_REGION_SIDE);
    const width = Math.min(Math.max(finite(source.width, 1), MIN_REGION_SIDE), 1 - x);
    const height = Math.min(Math.max(finite(source.height, 1), MIN_REGION_SIDE), 1 - y);
    return { x: round(x), y: round(y), width: round(width), height: round(height) };
};

// One slider moved (value in percent). Moving an edge keeps the area inside the
// window by shrinking the size first, then (for a size) clamping to what is left.
export const withRegionValue = (region: OcrRegionInput, key: string, percent: unknown): OcrRegion => {
    if (!KEYS.includes(key)) throw new Error(`unknown region key: ${key}`);
    const current = normalizeRegion(region);
    const value = finite(percent, 0) / 100;
    const next = { ...current, [key]: value };
    if (key === "x") next.width = Math.min(current.width, 1 - Math.min(value, 1 - MIN_REGION_SIDE));
    if (key === "y") next.height = Math.min(current.height, 1 - Math.min(value, 1 - MIN_REGION_SIDE));
    return normalizeRegion(next);
};

export const regionPercent = (region: OcrRegionInput, key: RegionKey): number => Math.round(normalizeRegion(region)[key] * 1000) / 10;

export const isFullRegion = (region: OcrRegionInput): boolean => {
    const r = normalizeRegion(region);
    return r.x === 0 && r.y === 0 && r.width === 1 && r.height === 1;
};

// The worker's state: the `runtime` of /get/data/ocr_readiness and the reply of
// /get/data/ocr_capture_status (docs/spec/data-and-persistence.md).
export type OcrRuntime = {
    active?: boolean;
    source?: string | null;
    shared_window?: "active" | "ended" | null;
    available_sources?: string[];
    // "stopped", "waiting", "reading" or "retrying".
    state?: string;
    stage?: string | null;
    error_code?: string | null;
    detector?: string | null;
};

// The reply of /get/data/ocr_readiness.
export type OcrReadiness = {
    engine?: boolean;
    language?: string;
    language_supported?: boolean;
    required_models?: string[];
    missing_models?: string[] | null;
    capture?: string;
    window_title?: string | null;
    detector_model?: unknown;
    detector_installed?: boolean;
    detector_enabled?: boolean;
    runtime?: OcrRuntime | null;
};

export type ReadinessSummary = { key: string; params: Record<string, string>; ok: boolean };

// The first thing still blocking chat reading, as an i18n key and params.
export const readinessSummary = (readiness: OcrReadiness | null | undefined): ReadinessSummary => {
    if (!readiness) return { key: "config_page.ocr.readiness.checking", params: {}, ok: false };
    if (readiness.engine === false) return { key: "config_page.ocr.readiness.engine_unavailable", params: {}, ok: false };
    if (readiness.language_supported === false) return { key: "config_page.ocr.readiness.language_unsupported", params: {}, ok: false };
    if ((readiness.missing_models ?? []).length > 0) return { key: "config_page.ocr.readiness.models_missing", params: {}, ok: false };
    if (readiness.capture === "capture_unavailable") return { key: "config_page.ocr.readiness.capture_unavailable", params: {}, ok: false };
    if (readiness.capture === "window_not_found") {
        return { key: "config_page.ocr.readiness.window_not_found", params: { title: readiness.window_title ?? "VRChat" }, ok: false };
    }
    return { key: "config_page.ocr.readiness.ready", params: {}, ok: true };
};

export type RuntimeSummary = ReadinessSummary & { tone: "failed" | "active" | "warning" };

export const runtimeSummary = (runtime: OcrRuntime | null | undefined): RuntimeSummary | null => {
    if (!runtime || runtime.state === "stopped") return null;
    // Linux: the window the user shared is gone and none is found by name. Say what to do
    // instead of the general capture failure.
    const lost = runtime.state === "retrying" && runtime.stage === "capture" && runtime.shared_window === "ended";
    const state = lost ? "shared_window_ended" : runtime.state === "retrying"
        ? `failed_${(["capture", "detector", "recognition"] as readonly unknown[]).includes(runtime.stage) ? runtime.stage : "tick"}`
        : runtime.state === "reading" ? "reading" : "waiting";
    const tone = runtime.state === "retrying" ? "failed" : state === "reading" ? "active" : "warning";
    return { key: `config_page.ocr.runtime.${state}`, params: {}, ok: state === "reading", tone };
};

export type DetectorStatus = { model: string; installed: boolean; on: boolean; preferred: boolean; key: string };

// Installation, preference and the worker's adopted detector are separate facts.
// `enabled` is the switch as the page knows it (it may be newer than the readiness reply).
export const detectorStatus = (readiness: OcrReadiness | null | undefined, enabled?: boolean | null,
    runtime: OcrRuntime | null | undefined = readiness?.runtime): DetectorStatus | null => {
    if (!readiness || typeof readiness.detector_model !== "string") return null;
    const installed = readiness.detector_installed === true;
    const preferred = (enabled ?? readiness.detector_enabled) !== false;
    const running = runtime && runtime.state !== "stopped";
    const adopted = running && runtime.detector === "vrct-vox-chatbox";
    const on = !!adopted && runtime.state === "reading";
    const state = adopted ? on ? "on" : "paused"
        : !installed ? "missing" : !preferred ? "off" : running ? "restart" : "ready";
    return { model: readiness.detector_model, installed, on, preferred, key: `config_page.ocr.detector.status_${state}` };
};

export type CaptureStatusSummary =
    | { key: string; tone: "neutral" }
    | (ReadinessSummary & { sourceKey: string; tone: "neutral" | "warning" })
    | (Partial<RuntimeSummary> & { sourceKey: string | null });

// One readout combines the worker's actual source and runtime state. Readiness
// describes how to start when stopped; it cannot override a running failure.
export const captureStatusSummary = (status: OcrRuntime | null | undefined, readiness: OcrReadiness | null | undefined): CaptureStatusSummary => {
    if (!status) return { key: "config_page.ocr.capture_source.checking", tone: "neutral" };
    if (!status.active || status.state === "stopped") {
        const summary = readinessSummary(readiness);
        return { ...summary, sourceKey: "config_page.ocr.capture_source.stopped", tone: summary.ok ? "neutral" : "warning" };
    }
    // A shared window is still the "window" source; the label tells which window is read.
    const source = status.source === "window" && status.shared_window === "active" ? "shared" : status.source;
    const sourceKey = (["window", "vr", "shared"] as readonly unknown[]).includes(source) ? `config_page.ocr.capture_source.${source}` : null;
    return { ...runtimeSummary(status), sourceKey };
};
