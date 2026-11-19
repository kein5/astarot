// The translation catalog (#413): what translates, in two groups. "engine" holds the models
// that run on an inference engine on this PC, "api" the APIs the app calls. Each group lists
// the entries the app ships ("builtin"), model folders put in translation-models ("folder")
// and the entries the user added ("user"). The backend checks everything; this module only
// shapes the requests and refuses what cannot pass before it is sent.
import { cleanPath } from "../voice/modelCatalog.ts";

export type CatalogOrigin = "builtin" | "folder" | "user";
export type EntryStatus = "ok" | "missing" | "unsupported";

export type EngineItem = {
    id: string;
    origin: CatalogOrigin;
    name: string;
    runtime: string;
    weight: string;
    available: boolean;
    in_use: boolean;
    non_commercial?: boolean;
    // The model's folder, or for the `llamacpp` runtime its GGUF file.
    folder?: string;
    languages?: string[];
    // `llamacpp`: the device (`auto`, `cpu` or a Vulkan device) and whether llama.cpp's server
    // is set up.
    device?: string;
    server_ready?: boolean;
    status?: EntryStatus;
};

export type ApiItem = {
    id: string;
    origin: CatalogOrigin;
    name: string;
    kind?: "cloud" | "local_server";
    available?: boolean;
    protocol?: string;
    url?: string;
    model?: string;
    // Whether the key store holds the entry's key.
    has_key?: boolean;
    // The key store did not take the key: the app holds it until it closes, and tries again.
    key_in_memory?: boolean;
    in_use?: boolean;
    status?: EntryStatus;
};

export type TranslationCatalog = {
    engine: EngineItem[];
    api: ApiItem[];
    runtimes: string[];
    protocols: string[];
    error_code?: string;
    warning?: string;
};

export const ENTRY_NAME_LIMIT = 80;
const URL_LIMIT = 2048;
const MODEL_LIMIT = 200;
const LANGUAGE_CODE = /^[A-Za-z0-9_-]{1,32}$/;

// The runtime of a translation LLM (TranslateGemma) on llama.cpp's server (ADR-015): one GGUF
// file instead of a folder, and the device to run it on.
export const LLAMACPP = "llamacpp";
// The devices the form offers; the backend also takes a Vulkan device by name (`Vulkan1`).
export const LLAMA_DEVICES = ["auto", "cpu"] as const;

export type EngineForm = { name: string; folder: string; runtime: string; languages: string; device?: string };
export type ApiForm = { name: string; url: string; model: string; auth_key: string; protocol: string };
type Checked<T> = { request: T } | { problem: string };

const checkName = (name: string): string | { problem: string } => {
    const clean = name.trim();
    if (!clean) return { problem: "name_missing" };
    if ([...clean].length > ENTRY_NAME_LIMIT) return { problem: "name_long" };
    return clean;
};

// "ja, en ja" → ["ja", "en"]: codes separated by commas or spaces, duplicates dropped.
export const languageCodes = (text: string): string[] | null => {
    const codes = [...new Set(text.split(/[\s,、]+/).filter(Boolean))];
    return codes.every(code => LANGUAGE_CODE.test(code)) ? codes : null;
};

type EngineRequest = { group: "engine"; name: string; runtime: string; folder: string; languages: string[]; device?: string };

// The request for /run/register_translation_catalog_entry of an engine entry. A `llamacpp`
// entry names a .gguf file and its device.
export function engineRequest(form: EngineForm): Checked<EngineRequest> {
    const name = checkName(form.name);
    if (typeof name !== "string") return name;
    const runtime = form.runtime || "onnx";
    const llamacpp = runtime === LLAMACPP;
    const folder = cleanPath(form.folder);
    if (!folder) return { problem: llamacpp ? "file_missing" : "folder_missing" };
    if (llamacpp && !/\.gguf$/i.test(folder)) return { problem: "file_missing" };
    const languages = languageCodes(form.languages);
    if (!languages) return { problem: "languages_invalid" };
    const request: EngineRequest = { group: "engine", name, runtime, folder, languages };
    if (llamacpp) request.device = form.device || "auto";
    return { request };
}

// The request for /run/register_translation_catalog_entry of an API entry. The key goes to
// the backend once, which keeps it in the secret store; it is never shown again.
export function apiRequest(form: ApiForm): Checked<{ group: "api"; name: string; protocol: string; url: string; model: string; auth_key: string }> {
    const name = checkName(form.name);
    if (typeof name !== "string") return name;
    const url = form.url.trim();
    if (!url) return { problem: "url_missing" };
    if (url.length > URL_LIMIT || /\s/.test(url) || !/^https?:\/\//i.test(url)) return { problem: "url_invalid" };
    const model = form.model.trim();
    if ([...model].length > MODEL_LIMIT) return { problem: "model_long" };
    const auth_key = form.auth_key.trim();
    if (!auth_key) return { problem: "key_missing" };
    return { request: { group: "api", name, protocol: form.protocol || "openai_compatible", url, model, auth_key } };
}

// A user's local weight (`custom:<folder>` or `user:<id>`), as the settings name it.
export const isUsersWeight = (weight: string): boolean => weight.startsWith("custom:") || weight.startsWith("user:");

// The name to show for a local weight: an entry's own name, a folder's name, else the weight.
export function weightLabel(weight: string, catalog: TranslationCatalog | null | undefined): string {
    const item = catalog?.engine?.find(entry => entry.weight === weight);
    if (item && item.origin !== "builtin") return item.name;
    if (weight.startsWith("custom:")) return weight.slice("custom:".length);
    return weight;
}

// What an entry's card says, in order: a problem first, then whether it is in use. An API
// entry whose key the store never took has no key once the app was closed ("no_key").
// A translation LLM whose file is fine but whose llama.cpp server is not set up yet is
// "no_server": the server is fetched apart.
export function entryState(item: EngineItem | ApiItem): "unsupported" | "missing" | "unavailable" | "no_server" | "no_key" | "in_use" | "ready" {
    if (item.status === "unsupported" || item.status === "missing") return item.status;
    if ("weight" in item && item.origin === "user" && !item.available) return item.runtime === LLAMACPP && item.server_ready === false ? "no_server" : "unavailable";
    if ("has_key" in item && item.origin === "user" && item.has_key === false && !item.key_in_memory) return "no_key";
    return item.in_use ? "in_use" : "ready";
}
