// The local translation's model in the first-run setup (#936): reviewed, downloaded and applied
// in the setup itself, as the recognition models are (firstRunSetup.ts). The model is the
// download catalog's entry of the selected translation model; applying it holds no path (the
// core finds verified downloads by catalog id) and marks the model downloaded, which ends the
// setup's need for it (setupNeeds.ts).
import { translationCatalogIds } from "../main/setupNeeds";
import type { DownloadJob, SetupCatalog, SetupEntry } from "./firstRunSetup.ts";

const ACTIVE = ["queued", "downloading", "verifying", "cancelling"];

// The catalog's model of the selected translation model (CTRANSLATE2_WEIGHT_TYPE): the first of
// its files the catalog lists. null when the catalog has none (the translator list is the way
// forward then) or is not known yet.
export const translationEntry = (catalog: SetupCatalog, weightType: unknown): SetupEntry | null => {
    for (const id of translationCatalogIds(weightType)) {
        const entry = catalog?.models?.find(model => model.id === id && model.target === "translation");
        if (entry) return entry;
    }
    return null;
};

// One run of the translation's preparation. started: the job id the state showed when the run
// asked for the download (null for none), so an older job's outcome is not this run's;
// undefined until it asks. applied: the job ids it asked to apply.
export interface TranslationRunView {
    job: DownloadJob | undefined;
    started: string | null | undefined;
    applied: readonly string[];
    // The setup no longer needs the model: it is on the PC and the translation can use it.
    ready: boolean;
}

export type TranslationAction =
    | { kind: "start" }
    | { kind: "apply"; jobId: string }
    | { kind: "wait" }
    | { kind: "failed"; code: string }
    | { kind: "done" };

// What the run does next. A download already finished (ready) is applied; one this run started
// that failed or was cancelled stops the run, and "やり直す" starts a new one.
export const translationNext = ({ job, started, applied, ready }: TranslationRunView): TranslationAction => {
    if (ready) return { kind: "done" };
    if (job && ACTIVE.includes(job.phase ?? "")) return { kind: "wait" };
    if (job?.phase === "ready" && job.job_id) return applied.includes(job.job_id) ? { kind: "wait" } : { kind: "apply", jobId: job.job_id };
    const asked = started !== undefined;
    const ours = asked && !!job?.job_id && job.job_id !== started;
    if (ours && ["failed", "cancelled"].includes(job?.phase ?? "")) {
        return { kind: "failed", code: job?.error_code || (job?.phase === "cancelled" ? "cancelled" : "download_failed") };
    }
    // Asked and not answered yet, or applied and waiting for the model to count as downloaded.
    if (asked) return { kind: "wait" };
    return { kind: "start" };
};
