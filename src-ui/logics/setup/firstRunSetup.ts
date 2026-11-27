// The first-run setup (#557): what the basic features still lack, and the one sequence that
// prepares local speech recognition after a single consent.
//
// The sequence is derived again from the saved settings and the download state every time
// something changes, so it can stop anywhere and start again where it stopped. Each model is
// downloaded into the backend's staging folder, checked against its pinned size and SHA-256, and
// only then written into the settings ("apply"), which keeps the previous working settings when
// a step fails (#517). Nothing here downloads without the consent given in the dialog.

import type { CatalogEntry } from "../voice/modelCatalog";
import { isSwitchShown, pickedPresets } from "../configs/usagePresets.ts";

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

// The inputs whose speech the setup prepares recognition for (#1308 ★2, decided on 2026-11-28): Mic
// input's and Listening's, as the main screen shows their switches for the chosen uses
// (usagePresets.ts). Neither shown, or the uses not known yet, counts as both.
export interface SetupSources {
    readonly mic: boolean;
    readonly speaker: boolean;
}
export const BOTH_SOURCES: SetupSources = Object.freeze({ mic: true, speaker: true });
export const setupSources = (presets: unknown): SetupSources => {
    const picked = pickedPresets(presets);
    const mic = isSwitchShown(picked, "transcription_send"), speaker = isSwitchShown(picked, "transcription_receive");
    return mic || speaker ? { mic, speaker } : BOTH_SOURCES;
};

// The recognition model the setup recommends for the inputs in use (#1308 ★2). Both: speech.cpp's
// own for the screen's language, with Listening's own after it when that one cannot tell the
// language (#1242). One alone: one model that tells the language, so that one model is enough.
export const recommendedRecognizer = (catalog: SetupCatalog, language: unknown, sources: SetupSources = BOTH_SOURCES): SetupEntry | null =>
    sources.mic && sources.speaker ? recommendedAsr(catalog, language) : detectingRecognizer(catalog) ?? recommendedAsr(catalog, language);

// One step of the recognition setup.
// "listening": Listening's own recognition model (#1242). onPc: the model's files are on the PC
// already; they are checked and used, never downloaded (#1263, #1308 S-6).
export type SetupStep =
    | { kind: "model"; target: "asr" | "listening" | "vad"; entry: SetupEntry; onPc?: boolean }
    | { kind: "server" }
    | { kind: "engine" };

// The steps the setup will take, decided when the dialog shows its consent: models whose path
// is still empty, then the bundled server, then the engine. A path the user already set is kept.
// asr: the recognition model chosen in the setup (#955); the recommended one for the inputs in use
// when none is (#1308 ★2). When it cannot tell the language and both inputs are in use, Listening's
// own model comes after it, in the same consent (#1242). downloaded: the models on the PC, which are
// used without downloading (#1308 S-6).
export const setupPlan = ({ catalog, language, engine, server, paths, asr: chosen, sources = BOTH_SOURCES, downloaded }:
    { catalog: SetupCatalog; language: unknown; engine: unknown; server: unknown; paths: AsrPaths; asr?: SetupEntry | null;
        sources?: SetupSources; downloaded?: Readonly<Record<string, unknown>> }): SetupStep[] | null => {
    const asr = chosen ?? recommendedRecognizer(catalog, language, sources), vad = vadEntry(catalog);
    if (!asr || !vad || !paths) return null;
    const steps: SetupStep[] = [];
    const model = (target: "asr" | "listening" | "vad", entry: SetupEntry): SetupStep =>
        ({ kind: "model", target, entry, ...(downloaded?.[entry.id] ? { onPc: true } : {}) });
    if (!set(paths.model)) {
        steps.push(model("asr", asr));
        const listening = sources.mic && sources.speaker ? recommendedListening(catalog, asr) : null;
        if (listening && listening.id !== asr.id && !set(paths.listening_model)) steps.push(model("listening", listening));
    }
    if (!set(paths.vad_model)) steps.push(model("vad", vad));
    if (server !== "bundled") steps.push({ kind: "server" });
    if (engine !== LOCAL_ENGINE) steps.push({ kind: "engine" });
    return steps;
};

// The models of a plan, for the consent: what will be downloaded and how large it is. Those on the
// PC already are used without a download, and listed apart (onPcModels, #1308 S-6).
export const planModels = (plan: SetupStep[] | null | undefined): SetupEntry[] =>
    (plan ?? []).flatMap(step => step.kind === "model" && !step.onPc ? [step.entry] : []);
export const onPcModels = (plan: SetupStep[] | null | undefined): SetupEntry[] =>
    (plan ?? []).flatMap(step => step.kind === "model" && step.onPc ? [step.entry] : []);
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
    // onPc: the model's files are checked, not downloaded (#1263, #1308 S-6).
    | { kind: "start"; entry: SetupEntry; onPc?: boolean }
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
    return { kind: "start", entry, ...(step.onPc && { onPc: true }) };
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

// What the recognition's line in the setup's findings says while it needs setting up (#1308 N-3):
// which of the inputs in use has no recognition model, or else that the VAD is missing. Listening
// without a model of its own uses Mic input's. Null when neither applies (the engine or the server
// is what is left): the general words then.
export const missingRecognition = (paths: AsrPaths, sources: SetupSources = BOTH_SOURCES): "mic_speaker" | "mic" | "speaker" | "vad" | null => {
    const mic = !set(paths?.model);
    const speaker = mic && !set(paths?.listening_model);
    const missing = { mic: mic && sources.mic, speaker: speaker && sources.speaker };
    if (missing.mic && missing.speaker) return "mic_speaker";
    if (missing.mic) return "mic";
    if (missing.speaker) return "speaker";
    return set(paths?.vad_model) ? null : "vad";
};
