// The term dictionary's entries as the core keeps them (#446; native/core/src/voice_settings.rs,
// `parse_term` and `normalize_vocabulary`): "written=reading,reading". The core checks every
// entry again when the settings are saved; these rules only let the form say at once which lines
// it can take.

export const MAX_USER_TERMS = 100;
const MAX_WRITTEN = 48;
const MAX_READING = 32;
const MAX_READINGS = 8;

const length = (text: string): number => [...text].length;

// The canonical entry, or null when the core would refuse it.
export const parseTerm = (value: string): string | null => {
    if (/[\u0000-\u001f\u007f]/.test(value)) return null;
    const trimmed = value.trim();
    const at = trimmed.indexOf("=");
    const [writtenPart, readingPart] = at < 0 ? [trimmed, ""] : [trimmed.slice(0, at), trimmed.slice(at + 1)];
    const written = writtenPart.split(/\s+/).filter(Boolean).join(" ");
    const readings = readingPart.trim() ? readingPart.split(",").map(reading => reading.trim()) : [];
    if (!written || length(written) > MAX_WRITTEN || written.includes(",") || readings.length > MAX_READINGS
        || readings.some(reading => !reading || length(reading) > MAX_READING || reading.includes("="))) return null;
    return readings.length ? `${written}=${readings.join(",")}` : written;
};

// The written form an entry is told apart by, without regard to letter case.
export const writtenKey = (term: string): string => term.split("=")[0].trim().toLowerCase();

export type BulkResult = {
    terms: string[];
    added: number;
    // Lines whose written form is in the dictionary already (or earlier in the text).
    duplicates: number;
    // Lines the core would refuse.
    invalid: number;
    // Lines left out because the dictionary was full.
    over: number;
    // The refused and the left-out lines, as typed, to be put right and added again.
    rest: string[];
};

// The lines of `text` added after `terms`, one entry a line. Blank lines are skipped.
export const addTerms = (terms: readonly string[], text: string): BulkResult => {
    const result: BulkResult = { terms: [...terms], added: 0, duplicates: 0, invalid: 0, over: 0, rest: [] };
    const seen = new Set(terms.map(writtenKey));
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const term = parseTerm(line);
        if (term === null) {
            result.invalid += 1;
            result.rest.push(line);
        } else if (seen.has(writtenKey(term))) {
            result.duplicates += 1;
        } else if (result.terms.length >= MAX_USER_TERMS) {
            result.over += 1;
            result.rest.push(line);
        } else {
            seen.add(writtenKey(term));
            result.terms.push(term);
            result.added += 1;
        }
    }
    return result;
};

// The user's entries as text, one a line, in the form the bulk add takes back.
export const termsText = (terms: readonly string[]): string => terms.map(term => `${term}\n`).join("");

// ------------------------------------------------------------------------- built-in terms (#792)
// The built-in VRChat terms ship with the app (/get/data/builtin_vocabulary). The user does not
// edit that list: their changes lie over it, so a newer app's list still reaches them.
// - Readings changed: one of the user's terms with the built-in term's written form. The core
//   puts the user's term before the built-in one of the same written form, so it wins.
// - Taken out: the written form in `removed`. The core leaves that built-in term out.
// A built-in term neither changed nor taken out follows the list of the app in use, also when a
// newer version adds terms or puts readings right.

// The vocabulary as the settings keep it (useRealtimeASR's RealtimeAsrVocabulary).
export type Vocabulary = {
    readonly builtin?: boolean;
    readonly terms: readonly string[];
    readonly removed?: readonly string[];
};

export type BuiltinState = "builtin" | "changed" | "removed";

export type BuiltinRow = {
    // The written form, as the built-in list writes it.
    written: string;
    // The readings in use: the user's when they changed them.
    readings: string[];
    state: BuiltinState;
    // The term as the app ships it.
    shipped: string;
};

export const writtenOf = (term: string): string => term.split("=")[0];
export const readingsOf = (term: string): string[] => {
    const at = term.indexOf("=");
    return at < 0 ? [] : term.slice(at + 1).split(",").filter(Boolean);
};

const keysOf = (terms: readonly string[]) => new Set(terms.map(writtenKey));

// The built-in terms with the user's changes over them, in the order the app ships them.
export const builtinRows = (builtin: readonly string[], vocabulary: Vocabulary): BuiltinRow[] => {
    const removed = new Set((vocabulary.removed ?? []).map(written => written.trim().toLowerCase()));
    const own = new Map(vocabulary.terms.map(term => [writtenKey(term), term] as const));
    return builtin.map(shipped => {
        const key = writtenKey(shipped);
        const changed = own.get(key);
        const state: BuiltinState = changed !== undefined ? "changed" : removed.has(key) ? "removed" : "builtin";
        return { written: writtenOf(shipped), readings: readingsOf(changed ?? shipped), state, shipped };
    });
};

// The user's own terms, without those that change a built-in one (those are listed with the
// built-in terms). With the built-in terms off, or before their list arrives, all of them.
export const ownTerms = (builtin: readonly string[] | null, vocabulary: Vocabulary): string[] => {
    if (!builtin || vocabulary.builtin === false) return [...vocabulary.terms];
    const keys = keysOf(builtin);
    return vocabulary.terms.filter(term => !keys.has(writtenKey(term)));
};

const withoutKey = (terms: readonly string[], key: string) => terms.filter(term => writtenKey(term) !== key);
const withoutRemoved = (removed: readonly string[] | undefined, key: string) =>
    (removed ?? []).filter(written => written.trim().toLowerCase() !== key);

// The vocabulary with `removed` left out when nothing is taken out, as the core saves it.
const settled = (vocabulary: Vocabulary, terms: readonly string[], removed: readonly string[]): Vocabulary => {
    const { removed: _, ...rest } = vocabulary;
    return removed.length ? { ...rest, terms: [...terms], removed: [...removed] } : { ...rest, terms: [...terms] };
};

// Readings as typed: separated by ",", "、" or "，".
export const readingsText = (readings: readonly string[]): string => readings.join("、");
const typedReadings = (text: string): string => text.replace(/[、，]/g, ",");

export type ReadingsChange =
    | { ok: true; vocabulary: Vocabulary }
    // invalid: the readings break the rules of a term. full: the user's terms are at their limit.
    | { ok: false; reason: "invalid" | "full" };

// A built-in term with these readings. The readings it ships with take the user's change away.
export const changeReadings = (vocabulary: Vocabulary, shipped: string, text: string): ReadingsChange => {
    const written = writtenOf(shipped);
    const typed = typedReadings(text).trim();
    const term = parseTerm(typed ? `${written}=${typed}` : written);
    if (term === null || writtenKey(term) !== writtenKey(shipped)) return { ok: false, reason: "invalid" };
    const key = writtenKey(shipped);
    const removed = withoutRemoved(vocabulary.removed, key);
    if (term === shipped) return { ok: true, vocabulary: settled(vocabulary, withoutKey(vocabulary.terms, key), removed) };
    const at = vocabulary.terms.findIndex(row => writtenKey(row) === key);
    if (at < 0 && vocabulary.terms.length >= MAX_USER_TERMS) return { ok: false, reason: "full" };
    const terms = at < 0 ? [...vocabulary.terms, term] : vocabulary.terms.map((row, index) => index === at ? term : row);
    return { ok: true, vocabulary: settled(vocabulary, terms, removed) };
};

// A built-in term taken out, with any change of its readings.
export const takeOut = (vocabulary: Vocabulary, shipped: string): Vocabulary => {
    const key = writtenKey(shipped);
    const removed = withoutRemoved(vocabulary.removed, key);
    return settled(vocabulary, withoutKey(vocabulary.terms, key), [...removed, writtenOf(shipped)]);
};

// A built-in term as the app ships it: put back, and its readings' change undone.
export const restoreBuiltin = (vocabulary: Vocabulary, shipped: string): Vocabulary => {
    const key = writtenKey(shipped);
    return settled(vocabulary, withoutKey(vocabulary.terms, key), withoutRemoved(vocabulary.removed, key));
};

// Every built-in term as the app ships it. The user's own terms stay.
export const restoreAllBuiltin = (vocabulary: Vocabulary, builtin: readonly string[]): Vocabulary => {
    const keys = keysOf(builtin);
    return settled(vocabulary, vocabulary.terms.filter(term => !keys.has(writtenKey(term))), []);
};
