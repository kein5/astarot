import { languageCodes } from "./languageCodes.ts";

// A selectable language as the backend and settings store it (English names).
export interface LanguageEntry {
    language?: string;
    country?: string;
    code?: string;
}

export interface LanguageOption {
    id: string;
    label: string;
}

export interface LocalizedLanguageName {
    language: string;
    country: string;
    label: string;
}

interface LanguageTagParts {
    language?: string;
    region?: string;
}

export interface LanguagePickEvent {
    key: string;
    keyCode?: number;
    isComposing?: boolean;
    nativeEvent?: { isComposing?: boolean };
}

export type LanguageNames = ReturnType<typeof createLanguageNames>;

// Display metadata only. Always pass the original entry to selection callbacks.
export function createLanguageNames(uiLanguage?: string | null, intl: typeof Intl = globalThis.Intl) {
    const displayNames = (type: Intl.DisplayNamesType) => {
        try { return new intl.DisplayNames([uiLanguage || "en"], { type, fallback: "none" }); }
        catch { return null; }
    };
    const languages = displayNames("language");
    const regions = displayNames("region");
    let collator: Intl.Collator | undefined;
    try { collator = new intl.Collator(uiLanguage || "en", { sensitivity: "base" }); }
    catch { /* Keep the supplied order when collation is unavailable. */ }
    const display = <F>(names: Intl.DisplayNames | null, code: string | undefined, fallback: F): string | F => {
        if (!code) return fallback;
        try { return names?.of(code) || fallback; }
        catch { return fallback; }
    };
    const parsedTags = new Map<string | undefined, LanguageTagParts>();
    const parts = (code: string | undefined): LanguageTagParts => {
        if (parsedTags.has(code)) return parsedTags.get(code)!;
        try {
            // An undefined code throws here and falls through to the empty result.
            const tag = new intl.Locale(code as string);
            // Retain the script to distinguish simplified/traditional Chinese.
            const result = { language: [tag.language, tag.script].filter(Boolean).join("-"), region: tag.region };
            parsedTags.set(code, result);
            return result;
        } catch { return {}; }
    };
    // languageCodes[undefined] reads the missing key "undefined", as in JavaScript.
    const codeFor = (entry: LanguageEntry | null | undefined): string | undefined => entry?.code || (entry?.country ? languageCodes[entry.language as string]?.[entry.country]
        : Object.values(languageCodes[entry?.language as string] ?? {})[0]);
    const name = (entry: LanguageEntry | null | undefined): LocalizedLanguageName => {
        const tag = parts(codeFor(entry));
        const language = display(languages, tag.language, entry?.language ?? "");
        const country = entry?.country ? display(regions, tag.region, entry.country) : "";
        return { language, country, label: country ? `${language} (${country})` : language };
    };
    const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").toLowerCase().trim();
    const searchText = (entry: LanguageEntry | null | undefined) => {
        const localized = name(entry);
        return normalize([localized.label, localized.language, localized.country,
            entry?.language, entry?.country, `${entry?.language ?? ""} (${entry?.country ?? ""})`].join(" "));
    };
    const matches = (entry: LanguageEntry | null | undefined, query: unknown) => {
        const text = searchText(entry);
        return normalize(query).split(/\s+/).every(word => text.includes(word));
    };
    const sorted = <T extends LanguageEntry | null | undefined>(entries: Iterable<T>): T[] => [...entries].sort((a, b) => collator?.compare(name(a).label, name(b).label) ?? 0);
    // Settings with a language-only English identity (OCR), including legacy selections.
    const language = (english: string | null | undefined) => {
        const code = Object.values(languageCodes[english as string] ?? {})[0];
        return display(languages, parts(code).language, english ?? "");
    };
    // Realtime ASR and UI-language settings already use BCP-47 codes as IDs.
    const fromCode = (code: string | undefined, fallback?: string | null) => {
        const tag = parts(code);
        const english = tag.language && Object.keys(languageCodes).find(key =>
            Object.values(languageCodes[key]).some(value => parts(value).language === tag.language));
        fallback ??= english || code;
        const label = display(languages, tag.language, fallback);
        const region = display(regions, tag.region, "");
        return region ? `${label} (${region})` : label;
    };
    const uiOptions = <T extends LanguageOption>(options: readonly T[]) => options.map(option => {
        const label = fromCode(option.id, option.label);
        // Keep autonyms so users can recover from choosing an unfamiliar UI language.
        return { ...option, label: label === option.label ? label : `${label} / ${option.label}` };
    });
    return { name, matches, searchText, sorted, language, fromCode, uiOptions };
}

// Enter while an IME is committing Japanese text must not select a language.
export const isLanguagePickKey = (event: LanguagePickEvent) => event.key === "Enter"
    && !event.nativeEvent?.isComposing && !event.isComposing && event.keyCode !== 229;
