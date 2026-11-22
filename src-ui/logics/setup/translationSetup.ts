// The local translation's model in the first-run setup (#936): reviewed, downloaded and applied
// in the setup itself, as the recognition models are (firstRunSetup.ts). As the recognition's
// section offers the model the setup recommends, this one offers the built-in default model (its
// license allows any use), and switches the selected model to it when another one is selected,
// as the recognition's section switches the server and the engine. Applying the download holds
// no path (the core finds verified downloads by catalog id) and marks the model downloaded;
// once the selected model is on the PC, the setup's need for it ends (setupNeeds.ts).
import { translationCatalogIds } from "../main/setupNeeds";
import { ctranslate2_weight_type_status } from "../ui_configs";
import type { DownloadJob, SetupCatalog, SetupEntry } from "./firstRunSetup.ts";

const ACTIVE = ["queued", "downloading", "verifying", "cancelling"];

// The catalog's model of a translation model (CTRANSLATE2_WEIGHT_TYPE): the first of its files
// the catalog lists. null when the catalog has none or is not known yet.
export const translationEntry = (catalog: SetupCatalog, weightType: unknown): SetupEntry | null => {
    for (const id of translationCatalogIds(weightType)) {
        const entry = catalog?.models?.find(model => model.id === id && model.target === "translation");
        if (entry) return entry;
    }
    return null;
};

// The model the setup recommends: the built-in default (M2M100 418M).
const DEFAULT_WEIGHT = ctranslate2_weight_type_status.find(item => item.is_default) ?? ctranslate2_weight_type_status[0];
export const DEFAULT_TRANSLATION_WEIGHT = DEFAULT_WEIGHT.id;

// What the setup's section prepares while the selected model is not on the PC. entry: the
// model to download (null when the default is on the PC already and only the choice changes).
// switches: the selected model is another one, so the run selects the default once it is on
// the PC. null when the catalog has no default model or is not known yet: the setup then only
// points to the Translation settings.
export interface TranslationOffer {
    weight: string;
    name: string;
    entry: SetupEntry | null;
    switches: boolean;
}
export const translationOffer = (catalog: SetupCatalog, selected: unknown, downloaded: readonly string[]): TranslationOffer | null => {
    const weight = DEFAULT_TRANSLATION_WEIGHT;
    const switches = selected !== weight;
    if (downloaded.includes(weight)) return switches ? { weight, name: DEFAULT_WEIGHT.name, entry: null, switches } : null;
    const entry = translationEntry(catalog, weight);
    return entry ? { weight, name: entry.name, entry, switches } : null;
};

// One run of the translation's preparation. started: the job id the state showed when the run
// asked for the download (null for none), so an older job's outcome is not this run's;
// undefined until it asks. applied: the job ids it asked to apply.
export interface TranslationRunView {
    job: DownloadJob | undefined;
    started: string | null | undefined;
    applied: readonly string[];
    // The setup no longer needs the model: the selected one is on the PC and the translation can use it.
    ready: boolean;
    // The offered model is on the PC.
    modelReady: boolean;
    // The run selects the offered model once it is on the PC, and has asked to.
    switches: boolean;
    switched: boolean;
}

export type TranslationAction =
    | { kind: "start" }
    | { kind: "apply"; jobId: string }
    | { kind: "switch" }
    | { kind: "wait" }
    | { kind: "failed"; code: string }
    | { kind: "done" };

// What the run does next. A download already finished (ready) is applied; one this run started
// that failed or was cancelled stops the run, and "やり直す" starts a new one. Once the offered
// model is on the PC, the run selects it (once) when another one is selected.
export const translationNext = ({ job, started, applied, ready, modelReady, switches, switched }: TranslationRunView): TranslationAction => {
    if (ready) return { kind: "done" };
    if (modelReady) return switches && !switched ? { kind: "switch" } : { kind: "wait" };
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
