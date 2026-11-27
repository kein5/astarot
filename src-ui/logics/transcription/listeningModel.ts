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

export const listeningChoice = (catalog: ModelDownloadCatalog | null | undefined, downloaded: Downloaded, asr: AsrProfile): ListeningChoice => {
    const pathOf = (row: ModelCatalogRow) => downloaded?.[row.id]?.model ?? "";
    const choices = (catalog?.models ?? []).filter(row => row.target === "asr" && pathOf(row) !== "");
    const path = asr?.listening_model ?? "", micPath = asr?.model ?? "";
    const find = (file: string) => file ? choices.find(row => pathOf(row) === file) ?? null : null;
    return { apart: path !== "" && path !== micPath, path, current: find(path), mic: find(micPath), choices };
};

// The languages Listening's own model takes, "auto" first when it tells the language: the catalog's
// own, from speech.cpp. Null without an entry to read them from.
export const listeningLanguages = (row: ModelCatalogRow | null): string[] | null => {
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
