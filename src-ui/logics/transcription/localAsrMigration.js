// The move from the removed Whisper engine to speech.cpp (#288): what the one-time
// notice and the settings show. Pure functions, so they can be tested without React.

// The old weights as the backend reports them, or null for a shape it never sends.
export const normalizeWeights = value => {
    if (!value || typeof value !== "object" || !Number.isSafeInteger(value.total_bytes) || value.total_bytes < 0
        || !Array.isArray(value.folders) || !value.folders.every(name => typeof name === "string")) return null;
    return { total_bytes: value.total_bytes, folders: value.folders };
};

// What a delete request did: the bytes it freed and the folders it could not remove.
export const normalizeOutcome = value => {
    const weights = normalizeWeights(value);
    if (!weights || !Number.isSafeInteger(value.freed_bytes) || value.freed_bytes < 0 || !Array.isArray(value.failed)) return null;
    return { freed_bytes: value.freed_bytes, failed: value.failed.filter(name => typeof name === "string") };
};

export const hasOldWeights = weights => (weights?.folders?.length ?? 0) > 0;

// Binary MB/GB with three significant digits, as the model download review shows sizes.
export const weightsSize = bytes => {
    const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    const gigabytes = value >= 1024 ** 3;
    const amount = Number((value / 1024 ** (gigabytes ? 3 : 2)).toPrecision(3));
    return `${amount.toLocaleString("en-US")} ${gigabytes ? "GB" : "MB"}`;
};

// Whether the speech server's asr profile has each model the bundled ASR server needs;
// null until the settings are known.
export const asrModels = settings => {
    const row = settings?.profiles?.asr;
    if (!row) return null;
    const set = value => typeof value === "string" && value.trim() !== "";
    return { model: set(row.model), vad_model: set(row.vad_model) };
};
