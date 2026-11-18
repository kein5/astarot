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
