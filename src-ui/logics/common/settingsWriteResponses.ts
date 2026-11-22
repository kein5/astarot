import { pendingRequestRecovery } from "./pendingRequestRecovery.ts";
import type { BackendResponse } from "./pendingRequestRecovery.ts";

const endpoints = new Set([
    "voice_settings", "direct_voice_settings", "speech_server_settings", "realtime_asr_settings", "hotkeys",
    "openai_compatible_auth_key_and_url", "custom_whisper_auth_key_and_url",
    "overlay_small_log_settings", "overlay_large_log_settings",
    "mic_word_filter", "send_message_format_parts", "received_message_format_parts",
    "osc_ip_address", "osc_port", "websocket_host", "websocket_port", "websocket_tls", "ocr_window_title",
    "obs_browser_source_port", "obs_browser_source_max_messages", "obs_browser_source_display_duration",
    "obs_browser_source_fadeout_duration", "obs_browser_source_font_size", "obs_browser_source_font_color",
    "obs_browser_source_font_outline_thickness", "obs_browser_source_font_outline_color", "rvc_block_ms",
].map(name => `/set/data/${name}`).concat([
    // A new connection key: the button says it is done only when the backend says so.
    "/run/regenerate_websocket_auth_token",
    // The dictionary written out (#792): the button says the file's name, or that it failed.
    "/run/export_vocabulary",
]));
const textEndpoints = new Set([
    "deepl_auth_key", "plamo_auth_key", "gemini_auth_key", "openai_auth_key", "groq_auth_key", "openrouter_auth_key",
    "lmstudio_url", "openai_compatible_url", "openai_compatible_auth_key", "ollama_url",
    "google_cloud_auth_key", "papago_client_id", "papago_auth_key",
    "groq_whisper_auth_key", "openai_whisper_auth_key", "custom_whisper_url", "custom_whisper_auth_key", "deepgram_auth_key",
].flatMap(name => [`/set/data/${name}`, `/delete/data/${name}`]));

// One setting write waiting for its reply. response settles with the reply, or false
// when the write failed or the session stopped.
export interface SettingsWriteRequest {
    endpoint: string;
    response: Promise<BackendResponse | false>;
    resolve: (response: BackendResponse | false) => void;
    // The write may have reached the backend, so its reply may still come.
    uncertain?: boolean;
}

export interface SettingsWriteResponses {
    begin(endpoint: string): SettingsWriteRequest | false | null;
    fail(request: SettingsWriteRequest | false | null | undefined, attempted: boolean): void;
    receive(response: BackendResponse): void;
    stop(): void;
}

// These setters reply in FIFO order. Keep timed-out owners until their reply:
// a GET or a later write must never confirm an earlier, uncertain save.
export function createSettingsWriteResponses(): SettingsWriteResponses {
    const queues = new Map<string, SettingsWriteRequest[]>();
    const begin = (endpoint: string) => {
        if (!endpoints.has(endpoint) && !textEndpoints.has(endpoint)) return null;
        const queue = queues.get(endpoint) ?? [];
        // Delivery is unknown after a transport failure. A new response could
        // belong to either write, so wait for that reply or a session restart.
        if (queue.some(request => request.uncertain)) return false;
        // response and resolve are set on the next line; the Promise executor runs at once.
        const request = { endpoint } as SettingsWriteRequest;
        request.response = new Promise(resolve => { request.resolve = resolve; });
        queue.push(request);
        queues.set(endpoint, queue);
        return request;
    };
    const fail = (request: SettingsWriteRequest | false | null | undefined, attempted: boolean) => {
        if (!request) return;
        request.resolve(false);
        request.uncertain = attempted;
        if (!attempted) {
            const queue = queues.get(request.endpoint);
            const index = queue?.indexOf(request) ?? -1;
            if (queue && index >= 0) queue.splice(index, 1);
        }
    };
    const receive = (response: BackendResponse) => {
        const queue = queues.get(response.endpoint);
        queue?.shift()?.resolve(response);
        if (!queue?.length) queues.delete(response.endpoint);
    };
    const stop = () => {
        for (const queue of queues.values()) for (const request of queue) request.resolve(false);
        queues.clear();
    };
    return { begin, fail, receive, stop };
}

export const settingsWriteResponses = createSettingsWriteResponses();
pendingRequestRecovery.register({ stop: settingsWriteResponses.stop });
