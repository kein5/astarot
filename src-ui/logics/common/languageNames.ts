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
    // The tags a language code can name: the stored tag and its canonical form, in lower
    // case. The stored tags are the speech engine's, so Chinese is cmn-Hans-CN and Hebrew
    // iw-IL; their canonical forms zh-Hans-CN and he-IL are what people type.
    const tagsFor = (entry: LanguageEntry | null | undefined): string[] => {
        const code = codeFor(entry);
        if (!code) return [];
        let canonical: string | undefined;
        try { canonical = intl.getCanonicalLocales(code)[0]; }
        catch { /* A tag Intl does not accept is still matched as it is stored. */ }
        return [...new Set([code, canonical].filter((tag): tag is string => !!tag).map(tag => tag.toLowerCase()))];
    };
    // A code names a whole tag or its leading subtags: "ja", "zh-hant", "en-us" (or "en_us").
    // Only the whole query counts, so "ja" does not also need to be a part of a name.
    const matchesCode = (entry: LanguageEntry | null | undefined, query: unknown) => {
        const code = normalize(query).replace(/_/g, "-");
        if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code)) return false;
        return tagsFor(entry).some(tag => tag === code || tag.startsWith(`${code}-`));
    };
    const matches = (entry: LanguageEntry | null | undefined, query: unknown) => {
        if (matchesCode(entry, query)) return true;
        const text = searchText(entry);
        return normalize(query).split(/\s+/).every(word => text.includes(word));
    };
    const sorted = <T extends LanguageEntry | null | undefined>(entries: Iterable<T>): T[] => [...entries].sort((a, b) => collator?.compare(name(a).label, name(b).label) ?? 0);
    // The list a language picker shows for a query, in name order, except that the languages
    // whose code the query is come first: "ja" lists Japanese before Azerbaijani, whose name
    // also contains "ja", so Enter picks Japanese.
    const search = <T extends LanguageEntry | null | undefined>(entries: Iterable<T>, query: unknown): T[] => {
        const shown = sorted(entries).filter(entry => matches(entry, query));
        const named = shown.filter(entry => matchesCode(entry, query));
        return named.length ? [...named, ...shown.filter(entry => !named.includes(entry))] : shown;
    };
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
    return { name, matches, matchesCode, searchText, sorted, search, language, fromCode, uiOptions };
}

// Enter while an IME is committing Japanese text must not select a language.
export const isLanguagePickKey = (event: LanguagePickEvent) => event.key === "Enter"
    && !event.nativeEvent?.isComposing && !event.isComposing && event.keyCode !== 229;
