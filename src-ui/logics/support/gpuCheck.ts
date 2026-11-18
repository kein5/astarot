// The GPU check (#288): what the settings show of the core's state, and the GitHub issue the
// user may open with the report. The report is the core's; nothing here adds to it.

export type GpuCheckPhase = "idle" | "pending" | "running";

export type GpuRun = {
    device: string;
    ok: boolean;
    ran_on?: string;
    error?: string;
    rtfx?: number;
    total_s?: number;
    cer_to_cpu?: number;
};

export type GpuStep = { runs?: GpuRun[]; skipped?: string; model?: string };

export type GpuDevice = { device: string; kind: string; name: string | null };

export type GpuReport = {
    devices?: GpuDevice[];
    tts?: GpuStep;
    asr?: GpuStep;
    [field: string]: unknown;
};

export type GpuCheckView = {
    phase: GpuCheckPhase;
    run: number;
    step: string | null;
    outcome: string | null;
    error: string | null;
    report: GpuReport | null;
    // The report as the core wrote it: what is shown, copied and sent, as it is.
    text: string | null;
};

export const IDLE_GPU_CHECK: GpuCheckView = { phase: "idle", run: 0, step: null, outcome: null, error: null, report: null, text: null };

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// The polled state (`/get/data/gpu_check_state`). A value of another shape leaves the view as it was.
export const gpuCheckAfterState = (view: GpuCheckView, value: unknown): GpuCheckView => {
    if (!record(value) || (value.state !== "idle" && value.state !== "running") || typeof value.run !== "number") return view;
    // A start waits for its answer: an idle state from before it does not end it.
    if (view.phase === "pending" && value.state === "idle" && value.run <= view.run) return view;
    return {
        phase: value.state,
        run: value.run,
        step: text(value.step),
        outcome: text(value.outcome),
        error: text(value.error_code),
        report: record(value.report) ? value.report as GpuReport : null,
        text: text(value.text),
    };
};

// The answer of a start or a stop: `{state, run}`.
export const gpuCheckAfterAnswer = (view: GpuCheckView, value: unknown): GpuCheckView => {
    if (!record(value) || typeof value.run !== "number") return view;
    if (value.state === "running") return { ...view, phase: "running", run: value.run, error: null };
    // Refused (the app is closing): the next poll says why.
    return view.phase === "pending" ? { ...view, phase: "idle" } : view;
};

export type DeviceRow = { device: string; name: string | null; tts: GpuRun | null; asr: GpuRun | null };

// One row per device the check ran on, the CPU first, with its speaking and recognition runs.
export const deviceRows = (report: GpuReport | null): DeviceRow[] => {
    if (!report || !Array.isArray(report.devices)) return [];
    const find = (step: GpuStep | undefined, device: string) => (Array.isArray(step?.runs) ? step.runs.find(run => run.device === device) ?? null : null);
    return report.devices.map(entry => ({ device: entry.device, name: entry.name ?? null, tts: find(report.tts, entry.device), asr: find(report.asr, entry.device) }));
};

export const ISSUE_URL = "https://github.com/kein5/astarot/issues/new";
// GitHub refuses very long addresses; a longer report is pasted instead (it is on the clipboard).
export const ISSUE_URL_LIMIT = 7000;

// The title names the first GPU, so that reports of one GPU can be found together.
export const issueTitle = (report: GpuReport | null): string => {
    const gpu = report?.devices?.find(entry => entry.kind === "gpu" || entry.kind === "igpu");
    return `GPU report: ${gpu?.name ?? "no GPU"}`;
};

// The new issue with the GPU report form, the report filled in when the address stays short.
export const issueUrl = (report: GpuReport | null, reportText: string): { url: string; filled: boolean } => {
    const base = `${ISSUE_URL}?template=gpu_report.yml&title=${encodeURIComponent(issueTitle(report))}`;
    const filled = `${base}&report=${encodeURIComponent(reportText)}`;
    return filled.length <= ISSUE_URL_LIMIT ? { url: filled, filled: true } : { url: base, filled: false };
};
