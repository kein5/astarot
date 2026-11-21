// How the model catalog page groups and labels the download catalog (models/model_downloads).
// One card per model, each with its file types (quantizations); the backend's `profile`,
// `speech` and `state.downloaded` are read as they are, never computed again here.

export type CatalogProfile = {
    summary: string;
    languages: string[];
    recommended_for: string[];
    memory_bytes: number | null;
    memory_measured_on: string | null;
    tier: "light" | "medium" | "heavy" | null;
    cpu: string;
    gpu: string;
};
export type CatalogEntry = {
    id: string;
    target: string;
    name: string;
    total_bytes: number;
    profile?: CatalogProfile | null;
    speech?: { name: string; label: string; type: string; default: boolean } | null;
};
export type CatalogFamily<T extends CatalogEntry = CatalogEntry> = { key: string; rows: T[] };
export type DownloadJob = { phase: string; paths?: Record<string, string> };
export type DownloadStatus = "working" | "ready" | "in_use" | "downloaded" | "not_downloaded";

const ACTIVE = ["queued", "downloading", "verifying", "cancelling"];

// The model a row is a file of: speech.cpp's name for recognizers, the profile's summary key for
// the speech models pinned in catalog.py (one per name), the row itself otherwise (RVC).
export const familyKey = (entry: CatalogEntry): string => entry.speech?.name ?? entry.profile?.summary ?? entry.id;

// Catalog names are "<model> · <file type>".
export const familyLabel = (entry: CatalogEntry): string => entry.speech?.label ?? entry.name.split(" · ")[0];
export const variantLabel = (entry: CatalogEntry): string =>
    entry.speech?.type?.toUpperCase() ?? (entry.name.split(" · ").slice(1).join(" · ") || entry.name);

// The rows of one target as cards, in catalog order (the first row of a model is the file
// speech.cpp fetches for its name).
export function catalogFamilies<T extends CatalogEntry>(rows: T[]): CatalogFamily<T>[] {
    const families: CatalogFamily<T>[] = [];
    for (const row of rows) {
        const key = familyKey(row);
        const family = families.find(item => item.key === key);
        if (family) family.rows.push(row);
        else families.push({ key, rows: [row] });
    }
    return families;
}

// The file a card shows before the user picks one: the one in use, then the one that fits the
// free GPU memory, then the default (speech.cpp's own, or the one with a recommendation).
export function firstVariant<T extends CatalogEntry>(rows: T[], recommended: string | null | undefined, inUse: (entry: T) => boolean): T {
    return rows.find(inUse)
        ?? rows.find(entry => entry.id === recommended)
        ?? rows.find(entry => entry.speech?.default)
        ?? rows.find(entry => (entry.profile?.recommended_for?.length ?? 0) > 0)
        ?? rows[0];
}

// A model the user registered under a name (models/model_downloads/user_models.py, #403).
// The backend checks the files; `status` is its answer, never computed again here.
// The speech output models (TTS). The manual's table lists each one with its check (#566), so
// each card says it too, checked or not yet.
const SPEECH_OUTPUT: readonly string[] = ["japanese", "multilingual"];
type GuidedEntry = { target: string; guidance?: { reference_memory_bytes?: number | null; validation?: { state: string } | null } | null };

// Whether a card says where its model was checked (native/ops/src/downloads/guidance.rs). A model
// with a measured memory always does, beside the figure. Without one the record stands on its own
// when it says something: a check that passed (the voice changer's), or a speech model's check
// still to come. Other models without a figure (speech recognition, voice activity…) say nothing.
export const showsValidation = (entry: GuidedEntry): boolean => {
    const guidance = entry.guidance;
    if (!guidance?.validation) return false;
    if (typeof guidance.reference_memory_bytes === "number") return true;
    return guidance.validation.state === "passed" || SPEECH_OUTPUT.includes(entry.target);
};

export type UserModel = {
    id: string;
    target: string;
    name: string;
    paths: Record<string, string>;
    total_bytes: number;
    registered_at: string | null;
    status: "ok" | "missing" | "changed";
};
export type UserModelStatus = "in_use" | "registered" | "missing" | "changed";

// The targets a model of one's own may be registered for, and the file kinds each takes:
// the model file first (required), then the RVC index (optional).
export const USER_MODEL_FILES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
    japanese: [["model", ".gguf"]],
    multilingual: [["model", ".gguf"]],
    asr: [["model", ".gguf"]],
    vad: [["model", ".gguf"]],
    diarization: [["model", ".gguf"]],
    rvc: [["model", ".pth"], ["index", ".index"]],
};
export const USER_MODEL_NAME_LIMIT = 80;

// What a registered model's card says. "in_use" needs the saved path to be its file, as for
// a download; a file that is gone or was changed is shown so before anything else.
export function userModelStatus(model: UserModel, expected: { model?: string } | undefined): UserModelStatus {
    if (model.status === "missing" || model.status === "changed") return model.status;
    return expected?.model && model.paths.model === expected.model ? "in_use" : "registered";
}

// A path as typed or pasted: Windows' "Copy as path" wraps it in double quotes.
export const cleanPath = (value: string): string => {
    const text = value.trim();
    return text.length > 1 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).trim() : text;
};

// The request for /run/register_user_model, or the reason it cannot be sent yet.
export function registrationRequest(target: string, name: string, paths: Record<string, string>):
    { request: { target: string; name: string; paths: Record<string, string> } } | { problem: string } {
    const kinds = USER_MODEL_FILES[target];
    if (!kinds) return { problem: "target" };
    const cleanName = name.trim();
    if (!cleanName) return { problem: "name_missing" };
    if ([...cleanName].length > USER_MODEL_NAME_LIMIT) return { problem: "name_long" };
    const chosen: Record<string, string> = {};
    for (const [role, suffix] of kinds) {
        const path = cleanPath(paths[role] ?? "");
        if (!path) {
            if (role === "model") return { problem: "model_missing" };
            continue;
        }
        if (!path.toLowerCase().endsWith(suffix)) return { problem: `${role}_kind` };
        chosen[role] = path;
    }
    return { request: { target, name: cleanName, paths: chosen } };
}

// What the card says about one file. "in_use" needs the saved path (`expected.model`) to be the
// downloaded file: a file that is on disk but not set anywhere is only "downloaded".
export function downloadStatus(entry: CatalogEntry, job: DownloadJob | undefined,
    downloaded: Record<string, Record<string, string>> | undefined, expected: { model?: string } | undefined): DownloadStatus {
    if (job && ACTIVE.includes(job.phase)) return "working";
    if (job?.phase === "ready") return "ready";
    const paths = downloaded?.[entry.id] ?? (job?.phase === "applied" ? job.paths : undefined);
    if (paths?.model && expected?.model && paths.model === expected.model) return "in_use";
    if (paths || job?.phase === "applied") return "downloaded";
    return "not_downloaded";
}
