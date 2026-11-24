// A settings field that saves by itself (#1111) says a refused save under the field, in the words
// the notice for that code used, and the notice is then not shown as well. Only the field's own
// save is quiet: a refusal that comes otherwise on the same endpoint, such as a saved address the
// core repaired at start-up, still raises its notice.
const awaiting = new Map<string, number>();

// A field sends its save to `endpoint` and will say a refusal itself.
export const awaitInlineAnswer = (endpoint: string): void => {
    awaiting.set(endpoint, (awaiting.get(endpoint) ?? 0) + 1);
};

// The save ended without a refusal (accepted, not sent, or not answered in time).
export const settleInlineAnswer = (endpoint: string): void => {
    const left = (awaiting.get(endpoint) ?? 0) - 1;
    if (left > 0) awaiting.set(endpoint, left);
    else awaiting.delete(endpoint);
};

// The backend error handling asks this for a refusal: true when a field waits for it, which
// it then settles, so the notice is skipped (the kept value is still put back).
export const takeInlineRefusal = (endpoint: string | undefined): boolean => {
    if (endpoint === undefined || !awaiting.has(endpoint)) return false;
    settleInlineAnswer(endpoint);
    return true;
};

// Codes whose notice is worded outside backend_errors.
const COMMON_ERROR_KEYS: Readonly<Record<string, string>> = {
    AUTH_DEEPL_LENGTH: "common_error.deepl_auth_key_invalid_length",
    AUTH_DEEPL_FAILED: "common_error.deepl_auth_key_failed_authentication",
    TRANSCRIPTION_API_AUTH_FAILED: "common_error.transcription_api_auth_failed",
};

// The keys to say a refused save with, first to last: i18next takes the first one it has. A code
// with no words of its own falls back to the general "could not be saved".
export const refusalKeys = (code: string | undefined): string[] => [
    ...(code && COMMON_ERROR_KEYS[code] ? [COMMON_ERROR_KEYS[code]] : []),
    ...(code ? [`backend_errors.${code}`] : []),
    "config_page.auto_save.save_failed",
];

// The code of a refused answer (docs/spec/cross-cutting.md), when it has one.
export const errorCodeOf = (result: unknown): string | undefined => {
    const code = typeof result === "object" && result !== null && "error_code" in result ? result.error_code : undefined;
    return typeof code === "string" ? code : undefined;
};
