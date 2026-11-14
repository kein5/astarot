// Keep the reviewed manifest with the request; a saved selection is not consent.
export const legacyDownloadRequest = (entry, consent) => {
    if (consent !== true || !entry?.manifest_version || !entry?.weight_type) return null;
    return { weight_type: entry.weight_type, consent: true, manifest_version: entry.manifest_version };
};

export const legacyReviewSize = (entry, t) => {
    // Match the legacy list's binary MB/GB convention and compact precision
    // (141 MB, 1.42 GB), while deriving the value from the pinned total.
    const gigabytes = entry.total_bytes >= 1024 ** 3;
    const amount = Number((entry.total_bytes / 1024 ** (gigabytes ? 3 : 2)).toPrecision(3));
    return t("legacy_model_downloads.size_with_approx", {
        bytes: t("legacy_model_downloads.exact_bytes", { bytes: entry.total_bytes.toLocaleString("en-US") }),
        size: `${amount.toLocaleString("en-US")} ${gigabytes ? "GB" : "MB"}`,
    });
};

export const clearLegacyConsentPending = (rows, weight_type) => rows.map(item =>
    item.id === weight_type ? { ...item, is_pending: false, progress: null } : item);

export const clearLegacyDownloadFailure = (rows, data) => rows.map(item =>
    item.id === data?.weight_type && !data?.active_job_id
        && (!item.job_id || !data?.job_id || item.job_id === data.job_id)
        ? { ...item, is_pending: false, is_downloaded: false, progress: null }
        : item);

// Why a legacy download failed, as the backend reports it (a fixed code, never a
// path or an exception text), and whether trying again can help. Codes shared with
// the catalog downloads reuse their text; the rest are legacy only.
const SHARED_REASONS = new Set(["download_busy", "download_failed", "downloads_closed", "hash_mismatch",
    "insufficient_space", "size_mismatch", "unsafe_destination"]);
const LEGACY_REASONS = new Set(["cancelled", "download_deadline", "verification_failed"]);
// Another download of the same model is running, or the backend is closing: a retry now would be refused.
const NOT_RETRYABLE = new Set(["download_busy", "downloads_closed"]);
export const legacyDownloadFailure = data => {
    const reason = typeof data?.reason === "string" ? data.reason : "";
    const reasonKey = SHARED_REASONS.has(reason) ? `model_downloads.errors.${reason}`
        : LEGACY_REASONS.has(reason) ? `legacy_model_downloads.errors.${reason}`
            : "model_downloads.errors.download_failed";
    const retryable = typeof data?.weight_type === "string" && data.weight_type !== ""
        && !data?.active_job_id && !NOT_RETRYABLE.has(reason);
    return { reasonKey, retryable };
};
