// Whether text to speech still needs a model in 「モデルとサーバー」 (#1230): a voice that the bundled
// speech.cpp makes (Japanese unless an installed engine reads it, and the other languages) and
// whose model is not set. Settings that have not arrived yet need nothing, so the fold does not
// open before they are known.

export interface TtsVoiceChoice {
    japanese_engine?: unknown;
    japanese_server?: unknown;
    multilingual_server?: unknown;
}

export type TtsProfiles = Partial<Record<"japanese" | "multilingual", { model?: unknown } | undefined>>;

const ROLES = ["japanese", "multilingual"] as const;

export const ttsModelsNeeded = (voice: TtsVoiceChoice | null | undefined, profiles: TtsProfiles | null | undefined): boolean => {
    if (!voice || !profiles) return false;
    return ROLES.some(role => {
        // Japanese may come from an engine the user installed (ADR-008); the others are speech.cpp's.
        if (role === "japanese" && (voice.japanese_engine || "speechcpp") !== "speechcpp") return false;
        // The bundled server unless the settings name another, as the TTS page reads them.
        if ((voice[`${role}_server`] || "bundled") !== "bundled") return false;
        const model = profiles[role]?.model;
        return !(typeof model === "string" && model.trim() !== "");
    });
};
