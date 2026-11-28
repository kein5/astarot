// Listening's own recognition model on the bundled server (#1242, decided on 2026-11-27): Mic input
// keeps the model for one's own voice, and Listening may use another, such as one that tells the
// language the other side speaks. The settings keep it in the asr profile's `listening_model`; empty,
// Listening uses Mic input's model from the same server.
//
// Listening's model is chosen among the recognition models on the PC: a choice is checked as the
// catalog's "Use this model" checks a download (#1263), then applied for Listening alone
// (`"source": "speaker"`). Nothing is downloaded here.

import type { ModelCatalogRow, ModelDownloadCatalog, ModelDownloadJob } from "../voice/useModelDownloads";
import type { SpeechServerProfileSettings } from "../voice/useSpeechServers";
import type { CaptionSource } from "./realtimeCaptionState";

// The choice of Mic input's model for Listening too.
export const SAME = "";

type Downloaded = Readonly<Record<string, Readonly<Record<string, string>>>> | undefined;
type AsrProfile = Pick<SpeechServerProfileSettings, "model" | "listening_model"> | null | undefined;

export interface ListeningChoice {
    // Listening has a model of its own, another file than Mic input's.
    apart: boolean;
    // The file Listening's model is ("" for none of its own).
    path: string;
    // The catalog's entries of Listening's and Mic input's models, when they are downloads.
    current: ModelCatalogRow | null;
    mic: ModelCatalogRow | null;
    // The recognition models on the PC that Listening may use.
    choices: readonly ModelCatalogRow[];
}

// Whether Listening has a model of its own, another file than Mic input's, which a second server
// (`asr_listening`) runs (#1242). As the core's `listening_apart` reads the saved settings.
export const listeningApart = (asr: AsrProfile): boolean => {
    const path = asr?.listening_model ?? "";
    return path !== "" && path !== (asr?.model ?? "");
};

export const listeningChoice = (catalog: ModelDownloadCatalog | null | undefined, downloaded: Downloaded, asr: AsrProfile): ListeningChoice => {
    const pathOf = (row: ModelCatalogRow) => downloaded?.[row.id]?.model ?? "";
    const choices = (catalog?.models ?? []).filter(row => row.target === "asr" && pathOf(row) !== "");
    const path = asr?.listening_model ?? "", micPath = asr?.model ?? "";
    const find = (file: string) => file ? choices.find(row => pathOf(row) === file) ?? null : null;
    return { apart: listeningApart(asr), path, current: find(path), mic: find(micPath), choices };
};

// The catalog's entry of the model Listening uses (#1298): its own, or Mic input's when it shares
// Mic input's. Null when that model is not a download of the catalog (a file of one's own).
export const listeningRow = (choice: ListeningChoice): ModelCatalogRow | null => choice.apart ? choice.current : choice.mic;

// The languages a recognition model of the catalog takes, "auto" first when it tells the language:
// the catalog's own, from speech.cpp. Null without an entry to read them from. Both inputs' choices
// on the bundled server come from them (#1242, #1298).
export const catalogLanguages = (row: ModelCatalogRow | null): string[] | null => {
    const speech = row?.speech;
    if (!speech?.languages) return null;
    return [...(speech.detects ? ["auto"] : []), ...speech.languages];
};

// A check this page asked for: the model and the job the state showed when it asked.
export interface ListeningAsk {
    id: string;
    before: string | null;
}

// The apply of a checked model for Listening, once its check is ready; null until then.
export const listeningApply = (asked: ListeningAsk | null, jobs: Readonly<Record<string, ModelDownloadJob | undefined>>, path: string) => {
    if (!asked) return null;
    const job = jobs[asked.id];
    if (!job?.job_id || job.job_id === asked.before || job.phase !== "ready") return null;
    return { id: asked.id, job_id: job.job_id, expected: { model: path }, source: "speaker" as const };
};

// A check asked for one input's model (#1308 ★1, decided on 2026-11-28): Mic input's and Listening's
// models are chosen side by side, each among the recognition models on the PC.
export interface SourceAsk extends ListeningAsk {
    source: CaptionSource;
}

// The apply of a checked model for the input it was chosen for, once its check is ready; null until
// then. Mic input's is checked against its saved model and changes it alone; Listening's against its
// own (`"source": "speaker"`), as above.
export const sourceApply = (asked: SourceAsk | null, jobs: Readonly<Record<string, ModelDownloadJob | undefined>>,
    paths: { readonly mic: string; readonly speaker: string }) => {
    const apply = listeningApply(asked, jobs, asked?.source === "mic" ? paths.mic : paths.speaker);
    if (!apply || asked?.source !== "mic") return apply;
    return { id: apply.id, job_id: apply.job_id, expected: apply.expected };
};

// The phases of a job that has not ended yet (useModelDownloads).
const ACTIVE: readonly string[] = ["queued", "downloading", "verifying", "cancelling"];

// What a check asked for one input has come to: the apply once it is ready (sourceApply), "ended"
// once it ended another way (its files changed, it was stopped), null while it runs or before it
// starts. Mic input's and Listening's fields and the recognition models' cards end their wait
// with it, so a failed check leaves neither waiting for good.
export const sourceOutcome = (asked: SourceAsk | null, jobs: Readonly<Record<string, ModelDownloadJob | undefined>>,
    paths: { readonly mic: string; readonly speaker: string }) => {
    if (!asked) return null;
    const job = jobs[asked.id];
    if (!job?.job_id || job.job_id === asked.before || ACTIVE.includes(job.phase)) return null;
    return sourceApply(asked, jobs, paths) ?? "ended";
};

// The states of a recognition server that keeps its model: one that prepares, runs or stops.
const RUNNING: readonly string[] = ["preparing", "ready", "stopping"];

// Whether a recognition server of the bundled speech.cpp keeps its model now: Mic input's (asr), or
// Listening's own (asr_listening, #1290). The core refuses an apply while one does
// (model_target_busy), so the choices of each input wait for it, in the fields and on the cards.
export const recognitionServerRuns = (servers: Readonly<Record<string, { readonly state?: string } | undefined>>) =>
    ["asr", "asr_listening"].some(name => RUNNING.includes(servers[name]?.state ?? ""));

// Which inputs use a recognition model file, by its path (#1308 ★1): Mic input's model, and
// Listening's own or Mic input's when Listening shares it. The catalog marks a model in use by them.
export const sourcesByPath = (asr: AsrProfile): Readonly<Record<string, readonly CaptionSource[]>> => {
    const used: Record<string, CaptionSource[]> = {};
    const mic = asr?.model?.trim() ?? "", own = asr?.listening_model?.trim() ?? "";
    const add = (path: string, source: CaptionSource) => {
        if (path) used[path] = [...(used[path] ?? []), source];
    };
    add(mic, "mic");
    add(own || mic, "speaker");
    return used;
};
