// The languages the backend checks the subtitle fonts for
// (`/get/data/overlay_font_missing_languages`), as language tags for their display names.
const CHECKED_LANGUAGE_TAGS = {
    "Japanese": "ja",
    "Korean": "ko",
    "Chinese Simplified": "zh-Hans",
    "Chinese Traditional": "zh-Hant",
};

// "Japanese and Korean" in the UI language; the English names where Intl cannot name them.
export const missingLanguagesText = (languages, ui_language, intl = globalThis.Intl) => {
    const locale = ui_language || "en";
    const names = languages.map(language => {
        try {
            const display = new intl.DisplayNames([locale], { type: "language", fallback: "none" });
            return display.of(CHECKED_LANGUAGE_TAGS[language] ?? language) ?? language;
        } catch {
            return language;
        }
    });
    try {
        return new intl.ListFormat(locale, { type: "conjunction" }).format(names);
    } catch {
        return names.join(", ");
    }
};
