// One language slot of a preset tab (selected_your_languages / selected_target_languages).
export interface LanguageSlot {
    language?: string;
    country?: string;
    enable?: boolean;
}

// Whether a turned-on target language is the language spoken. The country does not count:
// English (US) to English (UK) is still the same language. The backend (the core's
// languages.rs) and the VR language window decide the same way, and pick the local engine then.
export const isSameLanguageSelected = (
    your: LanguageSlot | undefined, targets: Record<string, LanguageSlot> | undefined,
): boolean => {
    const spoken = your?.language;
    if (!spoken) return false;
    return Object.values(targets ?? {}).some(target => target?.enable === true && target.language === spoken);
};
