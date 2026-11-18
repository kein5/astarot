// The languages the backend checks the subtitle fonts for
// (`/get/data/overlay_font_missing_languages`), as language tags for their display names.
const CHECKED_LANGUAGE_TAGS: Readonly<Partial<Record<string, string>>> = {
    "Japanese": "ja",
    "Korean": "ko",
    "Chinese Simplified": "zh-Hans",
    "Chinese Traditional": "zh-Hant",
};

// The parts of Intl used here. Either may be missing; the English names are used instead.
export type NamingIntl = Partial<Pick<typeof Intl, "DisplayNames" | "ListFormat">>;

// "Japanese and Korean" in the UI language; the English names where Intl cannot name them.
export const missingLanguagesText = (languages: readonly string[], ui_language: string | null | undefined,
    intl: NamingIntl = globalThis.Intl): string => {
    const locale = ui_language || "en";
    const names = languages.map(language => {
        if (!intl.DisplayNames) return language;
        try {
            const display = new intl.DisplayNames([locale], { type: "language", fallback: "none" });
            return display.of(CHECKED_LANGUAGE_TAGS[language] ?? language) ?? language;
        } catch {
            return language;
        }
    });
    if (!intl.ListFormat) return names.join(", ");
    try {
        return new intl.ListFormat(locale, { type: "conjunction" }).format(names);
    } catch {
        return names.join(", ");
    }
};
