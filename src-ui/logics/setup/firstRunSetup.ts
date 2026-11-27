// The first-run setup (#557): what the basic features still lack, and the one sequence that
// prepares local speech recognition after a single consent.
//
// The sequence is derived again from the saved settings and the download state every time
// something changes, so it can stop anywhere and start again where it stopped. Each model is
// downloaded into the backend's staging folder, checked against its pinned size and SHA-256, and
// only then written into the settings ("apply"), which keeps the previous working settings when
// a step fails (#517). Nothing here downloads without the consent given in the dialog.

import type { CatalogEntry } from "../voice/modelCatalog";

export type SetupEntry = CatalogEntry & {
    provider?: string;
    license?: string;
    licenses?: readonly string[];
    // The model's page (its card), and what its license restricts (modelRestrictions.ts).
    source?: string;
    restrictions?: unknown;
};

export type SetupCatalog = { catalog_version?: string; models?: readonly SetupEntry[] } | null | undefined;

export type AsrPaths = { model?: unknown; vad_model?: unknown; listening_model?: unknown } | null | undefined;

// What the recognition needs, as the setup sees it.
// "cloud": another engine was chosen; it needs a key, not a download, and is left alone.
// "own_server": speech.cpp on a server of the user's own; its models are the server's.
// "ready": speech.cpp on the bundled server with both model paths set.
// "needs_setup": nothing chosen yet, or the bundled server without its models.
export type RecognitionState = "cloud" | "own_server" | "ready" | "needs_setup" | "unknown";

const LOCAL_ENGINE = "SpeechCpp";
const ACTIVE = ["queued", "downloading", "verifying", "cancelling"];

const set = (value: unknown): boolean => typeof value === "string" && value.trim() !== "";

export const recognitionState = ({ engine, server, paths }: { engine: unknown; server: unknown; paths: AsrPaths }): RecognitionState => {
    if (engine === undefined || (engine === LOCAL_ENGINE && (server === undefined || !paths))) return "unknown";
    if (engine !== null && engine !== LOCAL_ENGINE) return "cloud";
    if (engine === LOCAL_ENGINE && server === "external") return "own_server";
    if (engine === LOCAL_ENGINE && server === "bundled" && set(paths?.model) && set(paths?.vad_model)) return "ready";
    return "needs_setup";
};

// The UI language's primary subtag ("ja-JP" → "ja").
const primary = (language: unknown): string => typeof language === "string" ? language.split(/[-_]/)[0].toLowerCase() : "";

// The recognition model speech.cpp recommends first for this language: the file it fetches for
// the model's name. Languages without a recommendation get the one for English.
export const recommendedAsr = (catalog: SetupCatalog, language: unknown): SetupEntry | null => {
    const rows = (catalog?.models ?? []).filter(entry => entry.target === "asr" && (entry.profile?.recommended_for?.length ?? 0) > 0);
    const pick = (code: string) => rows.find(entry => entry.profile?.recommended_for?.includes(code) && entry.speech?.default !== false)
        ?? rows.find(entry => entry.profile?.recommended_for?.includes(code));
    return pick(primary(language)) ?? pick("en") ?? null;
};

export const vadEntry = (catalog: SetupCatalog): SetupEntry | null => (catalog?.models ?? []).find(entry => entry.target === "vad") ?? null;

// Whether a recognition model tells the language it hears (the catalog's flag, #1242).
export const detectsLanguage = (entry: SetupEntry | null | undefined): boolean => entry?.speech?.detects === true;

// The recognizer offered where a model has to tell the language (#1242): of those that tell it, the
// one speech.cpp recommends for the most languages, the file it fetches first.
export const detectingRecognizer = (catalog: SetupCatalog): SetupEntry | null => {
    const reach = (entry: SetupEntry) => entry.profile?.recommended_for?.length ?? 0;
    const rows = (catalog?.models ?? []).filter(entry => entry.target === "asr" && detectsLanguage(entry) && entry.speech?.default !== false && reach(entry) > 0);
    return rows.reduce<SetupEntry | null>((best, entry) => !best || reach(entry) > reach(best) ? entry : best, null);
};

// Listening's model when the one for one's own voice cannot tell the language (decided on
// 2026-11-27, #1242): Listening hears the other side, whose language is not known, and starts on
// "auto". A model that tells the language serves both: none then.
export const recommendedListening = (catalog: SetupCatalog, asr: SetupEntry | null | undefined): SetupEntry | null =>
    !asr || detectsLanguage(asr) ? null : detectingRecognizer(catalog);

// One step of the recognition setup.
// "listening": Listening's own recognition model (#1242).
export type SetupStep =
    | { kind: "model"; target: "asr" | "listening" | "vad"; entry: SetupEntry }
    | { kind: "server" }
    | { kind: "engine" };

// The steps the setup will take, decided when the dialog shows its consent: models whose path
// is still empty, then the bundled server, then the engine. A path the user already set is kept.
// asr: the recognition model chosen in the setup (#955); the recommended one when none is. When it
// cannot tell the language, Listening's own model comes after it, in the same consent (#1242).
export const setupPlan = ({ catalog, language, engine, server, paths, asr: chosen }:
    { catalog: SetupCatalog; language: unknown; engine: unknown; server: unknown; paths: AsrPaths; asr?: SetupEntry | null }): SetupStep[] | null => {
    const asr = chosen ?? recommendedAsr(catalog, language), vad = vadEntry(catalog);
    if (!asr || !vad || !paths) return null;
    const steps: SetupStep[] = [];
    if (!set(paths.model)) {
        steps.push({ kind: "model", target: "asr", entry: asr });
        const listening = recommendedListening(catalog, asr);
        if (listening && listening.id !== asr.id && !set(paths.listening_model)) steps.push({ kind: "model", target: "listening", entry: listening });
    }
    if (!set(paths.vad_model)) steps.push({ kind: "model", target: "vad", entry: vad });
    if (server !== "bundled") steps.push({ kind: "server" });
    if (engine !== LOCAL_ENGINE) steps.push({ kind: "engine" });
    return steps;
};

// The models of a plan, for the consent: what will be downloaded and how large it is.
export const planModels = (plan: SetupStep[] | null | undefined): SetupEntry[] =>
    (plan ?? []).flatMap(step => step.kind === "model" ? [step.entry] : []);
export const planBytes = (plan: SetupStep[] | null | undefined): number =>
    planModels(plan).reduce((total, entry) => total + (Number.isFinite(entry.total_bytes) ? entry.total_bytes : 0), 0);

export type DownloadJob = { job_id?: string; phase?: string; error_code?: string | null; received_bytes?: number; total_bytes?: number };

export type RunView = {
    engine: unknown;
    server: unknown;
    paths: AsrPaths;
    jobs: Record<string, DownloadJob | undefined>;
    // The model ids whose download this run has asked for, each with the job id the state showed
    // when it asked (null for none): an older job's outcome is not this run's. And the job ids
    // this run has asked to apply.
    started: Readonly<Record<string, string | null>>;
    applied: readonly string[];
};

export type NextAction =
    | { kind: "start"; entry: SetupEntry }
    // source: "speaker" for Listening's own model (#1242).
    | { kind: "apply"; entry: SetupEntry; jobId: string; expected: { model: string }; source?: "speaker" }
    | { kind: "server" }
    | { kind: "engine" }
    | { kind: "wait" }
    | { kind: "failed"; step: number; code: string }
    | { kind: "done" };

// The settings field a model step fills.
const savedValue = (target: "asr" | "listening" | "vad", paths: AsrPaths): unknown =>
    target === "asr" ? paths?.model : target === "listening" ? paths?.listening_model : paths?.vad_model;

export const stepDone = (step: SetupStep, view: Pick<RunView, "engine" | "server" | "paths">): boolean => {
    if (step.kind === "server") return view.server === "bundled";
    if (step.kind === "engine") return view.engine === LOCAL_ENGINE;
    return set(savedValue(step.target, view.paths));
};

const savedPath = (target: "asr" | "listening" | "vad", paths: AsrPaths): string => {
    const value = savedValue(target, paths);
    return typeof value === "string" ? value : "";
};

// What to do next: the first step not yet done decides. A download this run started that
// ended in failure or was cancelled stops the run there; "やり直す" starts a new run, which
// asks for it again. A finished download is applied once; its saved path then ends the step.
export const nextAction = (plan: SetupStep[], view: RunView): NextAction => {
    const index = plan.findIndex(step => !stepDone(step, view));
    if (index < 0) return { kind: "done" };
    const step = plan[index];
    if (step.kind !== "model") return { kind: step.kind };
    const { entry } = step;
    const job = view.jobs[entry.id];
    const asked = Object.hasOwn(view.started, entry.id);
    // The job this run started: a new job id since the start was asked for.
    const ours = asked && !!job?.job_id && job.job_id !== view.started[entry.id];
    if (job && ACTIVE.includes(job.phase ?? "")) return { kind: "wait" };
    if (job?.phase === "ready" && job.job_id) {
        return view.applied.includes(job.job_id) ? { kind: "wait" }
            : { kind: "apply", entry, jobId: job.job_id, expected: { model: savedPath(step.target, view.paths) },
                ...(step.target === "listening" && { source: "speaker" as const }) };
    }
    if (ours && ["failed", "cancelled"].includes(job?.phase ?? "")) {
        return { kind: "failed", step: index, code: job?.error_code || (job?.phase === "cancelled" ? "cancelled" : "download_failed") };
    }
    // Asked and not answered yet, or applied and waiting for the saved path to come back.
    if (asked) return { kind: "wait" };
    return { kind: "start", entry };
};

// The state one step shows in the dialog.
export type StepState = "done" | "working" | "waiting" | "failed";
export const stepState = (plan: SetupStep[], index: number, view: RunView, failedAt: number | null): StepState => {
    const step = plan[index];
    if (stepDone(step, view)) return "done";
    if (failedAt === index) return "failed";
    const first = plan.findIndex(item => !stepDone(item, view));
    return first === index && failedAt === null && (Object.keys(view.started).length + view.applied.length > 0) ? "working" : "waiting";
};

// What the setup can still prepare: the local recognition, and the translation's model when the
// selected one can be downloaded (#936, the need's "review"). The first screen leads to the setup
// while either is left, also when the recognition is ready and only the translation is missing.
export interface SetupWork {
    recognition: boolean;
    translation: boolean;
}
export const setupWork = (recognition: RecognitionState, translationAction: unknown): SetupWork =>
    ({ recognition: recognition === "needs_setup", translation: translationAction === "review" });
export const hasSetupWork = (work: SetupWork): boolean => work.recognition || work.translation;

// Whether the first screen's line to the setup stands out: still pending, the settings known, and
// something left that it prepares. The setup never opens by itself (#935); the line is drawn to
// stand out instead, and the user opens it.
export const setupSuggested = (pending: unknown, work: SetupWork): boolean => pending === true && hasSetupWork(work);

// Whether another start-up dialog (the virtual microphone guide) should still wait: the setup is
// pending and its state for this run is not known yet, or it is open.
export const setupComesFirst = ({ notice, settled }: { notice: unknown; settled: unknown }): boolean =>
    notice === true && settled !== true;
