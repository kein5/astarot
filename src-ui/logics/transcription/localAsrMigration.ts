// The move from the removed Whisper engine to speech.cpp (#288): what the one-time
// notice and the settings show. Pure functions, so they can be tested without React.

// The old weights: their total size and the folders that hold them.
export type OldWeights = { total_bytes: number; folders: string[] };
// What a delete request did.
export type OldWeightsOutcome = { freed_bytes: number; failed: string[] };

// The backend's reply for the old weights, and after a delete the same with what it
// freed. The shape is checked before use; anything else reads as null.
export type OldWeightsReply = { total_bytes: number; folders: unknown } | null | undefined;
export type OldWeightsDeleteReply = { total_bytes: number; folders: unknown; freed_bytes: number; failed: unknown } | null | undefined;

// The old weights as the backend reports them, or null for a shape it never sends.
export const normalizeWeights = (value: OldWeightsReply): OldWeights | null => {
    if (!value || typeof value !== "object" || !Number.isSafeInteger(value.total_bytes) || value.total_bytes < 0
        || !Array.isArray(value.folders) || !value.folders.every((name: unknown) => typeof name === "string")) return null;
    return { total_bytes: value.total_bytes, folders: value.folders };
};

// What a delete request did: the bytes it freed and the folders it could not remove.
// `value!`: normalizeWeights returns null for a missing value, so it is there past that check.
export const normalizeOutcome = (value: OldWeightsDeleteReply): OldWeightsOutcome | null => {
    const weights = normalizeWeights(value);
    if (!weights || !Number.isSafeInteger(value!.freed_bytes) || value!.freed_bytes < 0 || !Array.isArray(value!.failed)) return null;
    return { freed_bytes: value!.freed_bytes, failed: value!.failed.filter((name: unknown) => typeof name === "string") };
};

export const hasOldWeights = (weights: { folders?: unknown[] | null } | null | undefined): boolean => (weights?.folders?.length ?? 0) > 0;

// Binary MB/GB with three significant digits, as the model download review shows sizes.
export const weightsSize = (bytes: number): string => {
    const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    const gigabytes = value >= 1024 ** 3;
    const amount = Number((value / 1024 ** (gigabytes ? 3 : 2)).toPrecision(3));
    return `${amount.toLocaleString("en-US")} ${gigabytes ? "GB" : "MB"}`;
};

// The speech server's settings, as far as asrModels reads them.
export type SpeechServerSettings = { profiles?: { asr?: { model?: unknown; vad_model?: unknown } | null } | null } | null | undefined;

// Whether the speech server's asr profile has each model the bundled ASR server needs;
// null until the settings are known.
export const asrModels = (settings: SpeechServerSettings): { model: boolean; vad_model: boolean } | null => {
    const row = settings?.profiles?.asr;
    if (!row) return null;
    const set = (value: unknown): boolean => typeof value === "string" && value.trim() !== "";
    return { model: set(row.model), vad_model: set(row.vad_model) };
};
