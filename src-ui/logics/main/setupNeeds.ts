// What the selected engines still lack before their switches can turn on.
// The UI already knows this from the model lists and the server settings, so the first
// screen can say it with a way to act, instead of a startup warning that names a settings path.

// The download state a model entry may carry while it is fetched.
export interface DownloadState {
    progress?: unknown;
    is_pending?: unknown;
}

// One entry of a model list (for example the CTranslate2 weights).
export interface ModelWeight extends DownloadState {
    id?: unknown;
    is_downloaded?: unknown;
}

// The speech server's asr profile; only the two model paths are read here.
export interface AsrProfile {
    model?: unknown;
    vad_model?: unknown;
}

export interface SetupSelection {
    translationEngine?: unknown;
    translationWeights?: readonly ModelWeight[] | null;
    translationWeight?: unknown;
    transcriptionEngine?: unknown;
    realtimeServer?: unknown;
    asrProfile?: AsrProfile | null;
}

export type SetupNeed =
    | { id: "translation"; weight: ModelWeight; action: "review" }
    | { id: "transcription"; weight: null; action: "settings" };

// What downloadProgress returns.
export type DownloadProgress = number | "pending" | null;

const missingWeight = (engine: unknown, wanted: string, weights: readonly ModelWeight[] | null | undefined,
    selected: unknown): ModelWeight | null => {
    if (engine !== wanted) return null;
    const weight = (weights || []).find(item => item.id === selected);
    return weight && !weight.is_downloaded ? weight : null;
};

// The local engine on the bundled server needs the asr profile's model and VAD model.
// They are reviewed and downloaded with consent in Settings → Speech recognition, so this
// need opens those settings ("settings"); it never downloads by itself. Unknown settings ask for nothing.
const missingLocalModels = (engine: unknown, realtimeServer: unknown, asrProfile: AsrProfile | null | undefined): boolean => {
    if (engine !== "SpeechCpp" || realtimeServer !== "bundled" || !asrProfile) return false;
    const set = (value: unknown) => typeof value === "string" && value.trim() !== "";
    return !set(asrProfile.model) || !set(asrProfile.vad_model);
};

export const setupNeeds = ({ translationEngine, translationWeights, translationWeight,
    transcriptionEngine, realtimeServer, asrProfile }: SetupSelection): SetupNeed[] => {
    const needs: SetupNeed[] = [];
    const translation = missingWeight(translationEngine, "CTranslate2", translationWeights, translationWeight);
    if (translation) needs.push({ id: "translation", weight: translation, action: "review" });
    if (missingLocalModels(transcriptionEngine, realtimeServer, asrProfile)) needs.push({ id: "transcription", weight: null, action: "settings" });
    return needs;
};

// "pending" until the first byte, then a whole percentage; null when nothing is being fetched.
export const downloadProgress = (weight: DownloadState | null | undefined): DownloadProgress =>
    Number.isFinite(weight?.progress) ? Math.min(100, Math.floor((weight as DownloadState).progress as number))
        : weight?.is_pending ? "pending" : null;
