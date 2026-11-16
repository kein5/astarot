// i18next's t and exists, as far as voiceErrorText calls them.
export type Translate = (key: string, params?: Record<string, unknown>) => string;
export type KeyExists = (key: string) => boolean;

// The main screen's notice for a voice code: its sentence with the code kept for support, from
// voice_ui.errors or, failing that, voice.input_errors (the voice pages' list). A code with no
// sentence, or text that is not a code, is shown as it is with the page to check. Codes are
// lower case, but a few of the backend's error codes are upper case (VOICE_SETTINGS_INVALID).
export const voiceErrorText = (code: string, page: string, t: Translate, exists: KeyExists): string => {
    if (/^[A-Za-z0-9_]+$/.test(code)) {
        for (const key of [`voice_ui.errors.${code}`, `voice.input_errors.${code}`]) {
            if (exists(key)) return `${t(key)} (${code})`;
        }
    }
    return `${code} · ${t("voice_ui.check_settings", { page })}`;
};
