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
