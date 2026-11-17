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
    // Whether the selected translation model can be downloaded (translationDownloadable);
    // null or undefined while the download catalog has not arrived.
    translationDownloadable?: boolean | null;
    transcriptionEngine?: unknown;
    realtimeServer?: unknown;
    asrProfile?: AsrProfile | null;
}

// "review" opens the download review. "choose" opens the translator list instead: the
// model cannot be downloaded yet, so another engine is the way forward.
export type SetupNeed =
    | { id: "translation"; weight: ModelWeight; action: "review" | "choose" }
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

export const setupNeeds = ({ translationEngine, translationWeights, translationWeight, translationDownloadable,
    transcriptionEngine, realtimeServer, asrProfile }: SetupSelection): SetupNeed[] => {
    const needs: SetupNeed[] = [];
    const translation = missingWeight(translationEngine, "CTranslate2", translationWeights, translationWeight);
    if (translation) needs.push({ id: "translation", weight: translation,
        action: translationDownloadable === false && downloadProgress(translation) === null ? "choose" : "review" });
    if (missingLocalModels(transcriptionEngine, realtimeServer, asrProfile)) needs.push({ id: "transcription", weight: null, action: "settings" });
    return needs;
};

// The download catalog, as far as it is read here.
export interface TranslationCatalog {
    legacy_models?: readonly { kind?: unknown; weight_type?: unknown }[] | null;
    models?: readonly { target?: unknown }[] | null;
}

// Whether a translation model can be downloaded: the catalog reviews this CTranslate2
// weight, or lists a model for the translation engine (the review then offers those).
// null while the catalog is unknown, so nothing is hidden before it arrives.
export const translationDownloadable = (catalog: TranslationCatalog | null | undefined, weightType: unknown): boolean | null => {
    if (!catalog) return null;
    if ((catalog.legacy_models ?? []).some(item => item.kind === "ctranslate2" && item.weight_type === weightType)) return true;
    return (catalog.models ?? []).some(model => model.target === "translation");
};

// "pending" until the first byte, then a whole percentage; null when nothing is being fetched.
export const downloadProgress = (weight: DownloadState | null | undefined): DownloadProgress =>
    Number.isFinite(weight?.progress) ? Math.min(100, Math.floor((weight as DownloadState).progress as number))
        : weight?.is_pending ? "pending" : null;
