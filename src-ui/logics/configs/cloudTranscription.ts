import { openai_auth_key_url, groq_auth_key_url, deepgram_auth_key_url } from "../ui_configs.ts";

// The part of the generated settings' names that names the engine (GroqWhisperAuthKey, ...).
export type CloudTranscriptionBase = "GroqWhisper" | "OpenAIWhisper" | "Deepgram" | "CustomWhisper";
// The part of the endpoints' and locale keys' names that names the engine (groq_whisper_auth_key, ...).
export type CloudTranscriptionKey = "groq_whisper" | "openai_whisper" | "deepgram" | "custom_whisper";

export type CloudTranscriptionEngine = {
    id: string;
    base: CloudTranscriptionBase;
    key: CloudTranscriptionKey;
    webpage_url?: string;
    has_url?: boolean;
    // The user's own connection rather than a service the app provides (#414): a Whisper
    // server they run or rent, at the URL they enter. The page marks it as theirs.
    own?: boolean;
};

// The API speech recognition engines (#414): the services the app provides, then the user's own
// server, in the order the settings list them. `id` is the backend engine name, `base` names
// the generated settings (e.g. GroqWhisperAuthKey), `key` the locale keys under
// config_page.transcription.
export const CLOUD_TRANSCRIPTION_ENGINES: CloudTranscriptionEngine[] = [
    { id: "Groq_Whisper", base: "GroqWhisper", key: "groq_whisper", webpage_url: groq_auth_key_url },
    { id: "OpenAI_Whisper", base: "OpenAIWhisper", key: "openai_whisper", webpage_url: openai_auth_key_url },
    { id: "Deepgram", base: "Deepgram", key: "deepgram", webpage_url: deepgram_auth_key_url },
    { id: "Custom_Whisper", base: "CustomWhisper", key: "custom_whisper", has_url: true, own: true },
];
