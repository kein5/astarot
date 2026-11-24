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
    models?: readonly { id?: unknown; target?: unknown }[] | null;
}

// The quantization variants a built-in model may be published in (Variant::ALL in
// native/translate-onnx).
const VARIANTS = ["float32", "float16", "int8", "int4"];
const BUILTIN_SUFFIX = "-ct2-int8";

// The download catalog's ids of a built-in weight, one per variant: `m2m100_418M-ct2-int8` →
// `m2m100-418m-onnx-int8`… (translation_onnx::catalog_id in the core). The settings keep the
// CTranslate2 names; a user's model (`user:`, and `custom:` of earlier versions) has none.
export const translationCatalogIds = (weightType: unknown): string[] => {
    if (typeof weightType !== "string" || weightType.includes(":") || !weightType.endsWith(BUILTIN_SUFFIX)) return [];
    const model = weightType.slice(0, -BUILTIN_SUFFIX.length).toLowerCase().replace(/[_.]/g, "-");
    return VARIANTS.map(variant => `${model}-onnx-${variant}`);
};

// Whether a translation model can be downloaded: the catalog lists a translation model made
// from this CTranslate2 weight (a variant of the same model).
// null while the catalog is unknown, so nothing is hidden before it arrives.
export const translationDownloadable = (catalog: TranslationCatalog | null | undefined, weightType: unknown): boolean | null => {
    if (!catalog) return null;
    const ids = translationCatalogIds(weightType);
    return (catalog.models ?? []).some(model => model.target === "translation" && typeof model.id === "string" && ids.includes(model.id));
};

// "pending" until the first byte, then a whole percentage; null when nothing is being fetched.
export const downloadProgress = (weight: DownloadState | null | undefined): DownloadProgress =>
    Number.isFinite(weight?.progress) ? Math.min(100, Math.floor((weight as DownloadState).progress as number))
        : weight?.is_pending ? "pending" : null;
