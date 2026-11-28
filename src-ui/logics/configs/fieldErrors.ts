// A settings field that saves by itself (#1111) says a refused save under the field, in the words
// the notice for that code used, and the notice is then not shown as well. Only the field's own
// save is quiet: a refusal that comes otherwise on the same endpoint, such as a saved address the
// core repaired at start-up, still raises its notice.

// How long a field waits for the answer to its save: as long as the fields wait before they say
// the save failed (useSaveButtonLogic and useSettingsDraft give up after five seconds).
export const INLINE_ANSWER_WAIT_MS = 5000;

// The saves fields wait for, by endpoint, oldest first. Each wait ends once: with the answer, or
// when it runs out, so it never outlives its save (#1324).
const awaiting = new Map<string, ReturnType<typeof setTimeout>[]>();

const endWait = (endpoint: string, wait: ReturnType<typeof setTimeout>): void => {
    const waits = awaiting.get(endpoint) ?? [];
    const index = waits.indexOf(wait);
    if (index < 0) return;
    clearTimeout(wait);
    waits.splice(index, 1);
    if (waits.length === 0) awaiting.delete(endpoint);
};

// A field sends its save to `endpoint` and will say a refusal itself. It calls what this returns
// when the save ends without a refusal (accepted, not sent, or not answered); an answer with any
// other status is a refusal, which takeInlineRefusal ends. Calling it again does nothing.
export const awaitInlineAnswer = (endpoint: string): (() => void) => {
    const wait: ReturnType<typeof setTimeout> = setTimeout(() => endWait(endpoint, wait), INLINE_ANSWER_WAIT_MS);
    awaiting.set(endpoint, [...(awaiting.get(endpoint) ?? []), wait]);
    return () => endWait(endpoint, wait);
};

// The receiving side asks this for every answer that is not a success, whatever its status
// (#1324): true when a field waits for it, whose wait it then ends, so the notice is skipped (the
// kept value is still put back).
export const takeInlineRefusal = (endpoint: string | undefined): boolean => {
    const wait = endpoint === undefined ? undefined : awaiting.get(endpoint)?.[0];
    if (endpoint === undefined || wait === undefined) return false;
    endWait(endpoint, wait);
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

// A form's save that says its own refusal under the form (#1111): `send` sends it to `endpoint`,
// the refusal skips the notice, and `say` gets the keys of the words to say (refusalKeys), or
// null once it is saved. The answer comes back as it is.
export const saveSaidInline = async <R>(endpoint: string, send: () => Promise<R> | R, say: (keys: string[] | null) => void): Promise<R> => {
    const settle = awaitInlineAnswer(endpoint);
    try {
        const response = await send();
        const reply = typeof response === "object" && response !== null ? response : null;
        const status = reply && "status" in reply ? reply.status : undefined;
        if (!(typeof status === "number" && status !== 200)) settle();
        say(status === 200 ? null : refusalKeys(errorCodeOf(reply && "result" in reply ? reply.result : undefined)));
        return response;
    } catch (error) {
        settle();
        say(refusalKeys(undefined));
        throw error;
    }
};
