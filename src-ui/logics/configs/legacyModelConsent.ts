// The reviewed manifest of a legacy model (weight_type), as the review dialog shows it.
export type LegacyModelEntry = { weight_type?: string; manifest_version?: string | number; total_bytes: number };

// The review of a built-in model, as the download catalog lists it under legacy_models
// (legacy_model_consent.py): the model, its source and license, and its tokenizer.
export type LegacyModelReview = LegacyModelEntry & {
    kind: string;
    weight_type: string;
    name: string;
    provider: string;
    repo: string;
    revision: string;
    license: string;
    non_commercial?: boolean;
    tokenizer?: { repo: string; revision: string; bundled?: boolean } | null;
    tokenizer_size_unknown?: boolean;
};

// The consented request for a legacy model download.
export type LegacyDownloadRequest = { weight_type: string; consent: true; manifest_version: string | number };

// i18next's t, as far as these helpers call it.
export type Translate = (key: string, params?: Record<string, unknown>) => string;

// A row of a legacy model list (id = weight_type).
export type LegacyModelRow = {
    id: string;
    is_pending?: boolean;
    is_downloaded?: boolean;
    progress?: number | null;
    job_id?: string | null;
};

// The `data` of a legacy download notice or error: {weight_type, job_id, downloaded, reason},
// plus active_job_id when the same model is already being downloaded.
export type LegacyDownloadData = {
    weight_type?: unknown;
    job_id?: unknown;
    active_job_id?: unknown;
    downloaded?: unknown;
    reason?: unknown;
} | null | undefined;

// Keep the reviewed manifest with the request; a saved selection is not consent.
export const legacyDownloadRequest = (entry: Partial<LegacyModelEntry> | null | undefined, consent: unknown): LegacyDownloadRequest | null => {
    if (consent !== true || !entry?.manifest_version || !entry?.weight_type) return null;
    return { weight_type: entry.weight_type, consent: true, manifest_version: entry.manifest_version };
};

export const legacyReviewSize = (entry: LegacyModelEntry, t: Translate): string => {
    // Match the legacy list's binary MB/GB convention and compact precision
    // (141 MB, 1.42 GB), while deriving the value from the pinned total.
    const gigabytes = entry.total_bytes >= 1024 ** 3;
    const amount = Number((entry.total_bytes / 1024 ** (gigabytes ? 3 : 2)).toPrecision(3));
    return t("legacy_model_downloads.size_with_approx", {
        bytes: t("legacy_model_downloads.exact_bytes", { bytes: entry.total_bytes.toLocaleString("en-US") }),
        size: `${amount.toLocaleString("en-US")} ${gigabytes ? "GB" : "MB"}`,
    });
};

export const clearLegacyConsentPending = <Row extends LegacyModelRow>(rows: Row[], weight_type: unknown): Row[] => rows.map(item =>
    item.id === weight_type ? { ...item, is_pending: false, progress: null } : item);

export const clearLegacyDownloadFailure = <Row extends LegacyModelRow>(rows: Row[], data: LegacyDownloadData): Row[] => rows.map(item =>
    item.id === data?.weight_type && !data?.active_job_id
        && (!item.job_id || !data?.job_id || item.job_id === data.job_id)
        ? { ...item, is_pending: false, is_downloaded: false, progress: null }
        : item);

// Why a legacy download failed, as the backend reports it (a fixed code, never a
// path or an exception text), and whether trying again can help. Codes shared with
// the catalog downloads reuse their text; the rest are legacy only.
const SHARED_REASONS = new Set(["download_busy", "download_failed", "downloads_closed", "hash_mismatch",
    "insufficient_space", "size_mismatch", "unsafe_destination"]);
const LEGACY_REASONS = new Set(["download_deadline", "verification_failed"]);
// Another download of the same model is running, or the backend is closing: a retry now would be refused.
const NOT_RETRYABLE = new Set(["download_busy", "downloads_closed"]);

export type LegacyDownloadFailure =
    | { notify: false; reasonKey: null; retryable: false }
    | { notify: true; reasonKey: string; retryable: boolean };

// A stopped download is not a failure: nothing is reported (`notify` false). Today the
// backend stops one only when the app closes or before it retries at startup.
export const legacyDownloadFailure = (data: LegacyDownloadData): LegacyDownloadFailure => {
    const reason = typeof data?.reason === "string" ? data.reason : "";
    if (reason === "cancelled") return { notify: false, reasonKey: null, retryable: false };
    const reasonKey = SHARED_REASONS.has(reason) ? `model_downloads.errors.${reason}`
        : LEGACY_REASONS.has(reason) ? `legacy_model_downloads.errors.${reason}`
            : "model_downloads.errors.download_failed";
    const retryable = typeof data?.weight_type === "string" && data.weight_type !== ""
        && !data?.active_job_id && !NOT_RETRYABLE.has(reason);
    return { notify: true, reasonKey, retryable };
};
