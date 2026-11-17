type Fields = Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): value is Fields => value !== null && typeof value === "object" && !Array.isArray(value);

// Moves unsaved edits onto a newer saved value, e.g. after a model path was
// applied. Fields the user did not edit follow the backend; edited fields keep
// the user's value. Key order follows `saved` so dirty checks stay stable.
// (The assertions below follow the `every(record)` check, which does not narrow each value.)
export const rebaseDraft = <T>(base: unknown, draft: T, saved: T): T => {
    if (same(draft, base)) return saved;
    if (![base, draft, saved].every(record)) return draft;
    return Object.fromEntries(Object.keys(saved as Fields).map(key => [key, rebaseDraft((base as Fields)[key], (draft as Fields)[key], (saved as Fields)[key])])) as T;
};
