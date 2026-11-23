// The speech recognition APIs the user adds (#414): the API group of the speech recognition page,
// beside the providers the app ships. An entry is a Whisper-compatible endpoint with its model and
// its key; using it points the custom Whisper server engine at it. The backend checks everything;
// this module only shapes the requests and refuses what cannot pass before it is sent.
import { ENTRY_NAME_LIMIT } from "../translation/translationCatalog.ts";

export type AsrApiItem = {
    id: string;
    origin: "user";
    name: string;
    protocol: string;
    url: string;
    model: string;
    // Whether the key store holds the entry's key.
    has_key?: boolean;
    // The key store did not take the key: the app holds it until it closes, and tries again.
    key_in_memory?: boolean;
    // The custom Whisper server engine points at this entry now.
    in_use?: boolean;
    status?: "ok" | "unsupported";
};

export type TranscriptionCatalog = {
    api: AsrApiItem[];
    protocols: string[];
    error_code?: string;
    warning?: string;
};

export type AsrApiForm = { name: string; url: string; model: string; auth_key: string; protocol: string };
type AsrApiRequest = { name: string; protocol: string; url: string; model: string; auth_key: string };

const URL_LIMIT = 2048;
const MODEL_LIMIT = 200;

export function asrApiRequest(form: AsrApiForm): { request: AsrApiRequest } | { problem: string } {
    const name = form.name.trim();
    if (!name) return { problem: "name_missing" };
    if ([...name].length > ENTRY_NAME_LIMIT) return { problem: "name_long" };
    const url = form.url.trim();
    if (!url) return { problem: "url_missing" };
    if (url.length > URL_LIMIT || /\s/.test(url) || !/^https?:\/\//i.test(url)) return { problem: "url_invalid" };
    const model = form.model.trim();
    if ([...model].length > MODEL_LIMIT) return { problem: "model_long" };
    const auth_key = form.auth_key.trim();
    if (!auth_key) return { problem: "key_missing" };
    return { request: { name, protocol: form.protocol || "openai_compatible", url, model, auth_key } };
}

// What an entry's card says: a protocol this version cannot use, a key the store never took
// (gone once the app was closed), or whether the custom Whisper server points at it.
export function asrEntryState(item: AsrApiItem): "unsupported" | "no_key" | "in_use" | "ready" {
    if (item.status === "unsupported") return "unsupported";
    if (item.has_key === false && !item.key_in_memory) return "no_key";
    return item.in_use ? "in_use" : "ready";
}

export const isTranscriptionCatalog = (value: Partial<TranscriptionCatalog> | null | undefined): value is TranscriptionCatalog =>
    Array.isArray(value?.api);
