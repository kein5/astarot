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

// ------------------------------------------------------------------------ the whole dictionary
// One list of the dictionary in use: the user's own terms, then the built-in terms with the user's
// changes over them. New terms are added from the list itself; a term added with a built-in
// term's written form changes that term's readings (the user's term of that written form wins).

export type RowState = BuiltinState | "own";

export type DictionaryRow = {
    written: string;
    readings: string[];
    state: RowState;
    // The term the row stands for: the user's own entry, or the built-in term as it ships.
    term: string;
};

// The rows in the order the core uses them: the user's own terms first, then the built-in ones
// (while they are on and their list has arrived).
export const dictionaryRows = (builtin: readonly string[] | null, vocabulary: Vocabulary): DictionaryRow[] => {
    const own = ownTerms(builtin, vocabulary).map((term): DictionaryRow => ({ written: writtenOf(term), readings: readingsOf(term), state: "own", term }));
    if (!builtin || vocabulary.builtin === false) return own;
    return [...own, ...builtinRows(builtin, vocabulary).map((row): DictionaryRow => ({ written: row.written, readings: row.readings, state: row.state, term: row.shipped }))];
};

// The term of a written form and readings as typed, or null when the rules of a term refuse it.
const typedTerm = (written: string, readings: string): string | null => {
    // A "=" in the written form would move part of it into the readings: refused.
    if (written.includes("=")) return null;
    const typed = typedReadings(readings).trim();
    return parseTerm(typed ? `${written}=${typed}` : written);
};

// One of the user's own terms with these readings, in its place.
export const changeOwnReadings = (vocabulary: Vocabulary, own: string, text: string): ReadingsChange => {
    const term = typedTerm(writtenOf(own), text);
    if (term === null) return { ok: false, reason: "invalid" };
    const key = writtenKey(own);
    return { ok: true, vocabulary: { ...vocabulary, terms: vocabulary.terms.map(row => writtenKey(row) === key ? term : row) } };
};

// One of the user's own terms deleted.
export const deleteOwn = (vocabulary: Vocabulary, own: string): Vocabulary =>
    ({ ...vocabulary, terms: withoutKey(vocabulary.terms, writtenKey(own)) });

export type AddResult =
    // added: a new term of the user's. builtin: the readings of the built-in term of that written form.
    | { ok: true; vocabulary: Vocabulary; kind: "added" | "builtin" }
    // duplicate: the dictionary has that written form already, with those readings.
    | { ok: false; reason: "invalid" | "full" | "duplicate" };

// A term added from the list: the written form and its readings as typed.
export const addTerm = (vocabulary: Vocabulary, builtin: readonly string[] | null, written: string, readings: string): AddResult => {
    const term = typedTerm(written, readings);
    if (term === null) return { ok: false, reason: "invalid" };
    const key = writtenKey(term);
    const shipped = builtin && vocabulary.builtin !== false ? builtin.find(row => writtenKey(row) === key) : undefined;
    if (shipped !== undefined) {
        const before = builtinRows([shipped], vocabulary)[0];
        const changed = changeReadings(vocabulary, shipped, readings);
        if (!changed.ok) return changed;
        const after = builtinRows([shipped], changed.vocabulary)[0];
        // The same readings of a term in use: nothing to add.
        if (before.state !== "removed" && before.readings.join(",") === after.readings.join(",")) return { ok: false, reason: "duplicate" };
        return { ok: true, vocabulary: changed.vocabulary, kind: "builtin" };
    }
    if (vocabulary.terms.some(row => writtenKey(row) === key)) return { ok: false, reason: "duplicate" };
    if (vocabulary.terms.length >= MAX_USER_TERMS) return { ok: false, reason: "full" };
    return { ok: true, vocabulary: { ...vocabulary, terms: [...vocabulary.terms, term] }, kind: "added" };
};

// ------------------------------------------------------------------------ a dictionary file
// The file the settings page writes out (the core's `vocabulary_file`) and reads back: the
// dictionary in use, one term a line, "written=reading,reading", as the built-in terms' data file
// has them. Lines starting with "#" are notes. Reading a file makes the dictionary in use the
// file's terms (#792):
// - a line that is a built-in term as it ships keeps that term as it ships, following a newer app;
// - a line with a built-in term's written form and other readings changes that term's readings;
// - any other line is a term of the user's own;
// - a built-in term the file has no line for is taken out;
// - the user's own terms the file does not have go.
// Whether the built-in terms are used at all stays as it is: with them off, the file's built-in
// terms as they ship are not used either, and the rest still is.

// The largest file read: far more than 100 terms and their notes.
export const MAX_IMPORT_BYTES = 256 * 1024;

export type ImportResult = {
    vocabulary: Vocabulary;
    // The dictionary after the file: the user's own terms, the built-in terms with changed
    // readings, the built-in terms taken out.
    own: number;
    changed: number;
    removed: number;
    // Lines left: not in the form of a term, a written form a line above already has, and terms
    // over the limit of the user's terms.
    invalid: number;
    duplicate: number;
    over: number;
    // The file has no term: the dictionary is left as it is, not emptied.
    empty: boolean;
    // The dictionary is already what the file says.
    unchanged: boolean;
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

export const importVocabulary = (vocabulary: Vocabulary, builtin: readonly string[], text: string): ImportResult => {
    const shipped = new Map(builtin.map(term => [writtenKey(term), term]));
    const terms: string[] = [];
    // The written forms the file has a line for, kept or not.
    const named = new Set<string>();
    const result = { own: 0, changed: 0, removed: 0, invalid: 0, duplicate: 0, over: 0 };
    let kept = 0;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const term = parseTerm(line);
        if (term === null) { result.invalid += 1; continue; }
        const key = writtenKey(term);
        if (named.has(key)) { result.duplicate += 1; continue; }
        named.add(key);
        const ships = shipped.get(key);
        if (ships === term) { kept += 1; continue; }
        // A line over the limit is left, and a built-in term it names stays as it ships.
        if (terms.length >= MAX_USER_TERMS) { result.over += 1; continue; }
        terms.push(term);
        if (ships === undefined) result.own += 1;
        else result.changed += 1;
    }
    if (!terms.length && !kept) {
        return { vocabulary, ...result, own: 0, changed: 0, removed: 0, empty: true, unchanged: true };
    }
    const taken = builtin.filter(term => !named.has(writtenKey(term))).map(writtenOf);
    result.removed = taken.length;
    // The same terms taken out, in whatever order they were, are kept as they are.
    const keys = (list: readonly string[]) => [...new Set(list.map(written => written.trim().toLowerCase()))].sort();
    const sameTaken = sameList(keys(taken), keys((vocabulary.removed ?? []).filter(written => shipped.has(written.trim().toLowerCase()))));
    const removed = sameTaken ? vocabulary.removed ?? [] : taken;
    const next = settled(vocabulary, terms, removed);
    const unchanged = sameList(next.terms, vocabulary.terms) && sameList(next.removed ?? [], vocabulary.removed ?? []);
    return { vocabulary: next, ...result, empty: false, unchanged };
};
