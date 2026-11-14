// What the selected engines still lack before their switches can turn on.
// The UI already knows this from the model lists and the server settings, so the first
// screen can say it with a way to act, instead of a startup warning that names a settings path.
const missingWeight = (engine, wanted, weights, selected) => {
    if (engine !== wanted) return null;
    const weight = (weights || []).find(item => item.id === selected);
    return weight && !weight.is_downloaded ? weight : null;
};

// The local engine on the bundled server needs the asr profile's model and VAD model.
// They are reviewed and downloaded with consent in Settings → Speech recognition, so this
// need opens those settings ("settings"); it never downloads by itself. Unknown settings ask for nothing.
const missingLocalModels = (engine, realtimeServer, asrProfile) => {
    if (engine !== "SpeechCpp" || realtimeServer !== "bundled" || !asrProfile) return false;
    const set = value => typeof value === "string" && value.trim() !== "";
    return !set(asrProfile.model) || !set(asrProfile.vad_model);
};

export const setupNeeds = ({ translationEngine, translationWeights, translationWeight,
    transcriptionEngine, realtimeServer, asrProfile }) => {
    const needs = [];
    const translation = missingWeight(translationEngine, "CTranslate2", translationWeights, translationWeight);
    if (translation) needs.push({ id: "translation", weight: translation, action: "review" });
    if (missingLocalModels(transcriptionEngine, realtimeServer, asrProfile)) needs.push({ id: "transcription", weight: null, action: "settings" });
    return needs;
};

// "pending" until the first byte, then a whole percentage; null when nothing is being fetched.
export const downloadProgress = weight => Number.isFinite(weight?.progress) ? Math.min(100, Math.floor(weight.progress))
    : weight?.is_pending ? "pending" : null;
