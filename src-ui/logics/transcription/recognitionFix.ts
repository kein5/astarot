// The refusals of the speech recognition switches that the main screen fixes where they appear
// (#1225, decided A on 2026-11-26): instead of a notice that names a settings page, a dialog with
// the actions that fix them. Mic transcription and Listening share the same causes, so both get it.
//
// - "models": the bundled ASR server has no recognition or VAD model. The fix is the first-run
//   setup, which shows the models it downloads and their size, downloads them after consent and
//   applies them; the bundled server then serves that model to the switches.
// - "language": the model does not take the language chosen for the source ("auto" for a model
//   that cannot tell the language). The fix is to choose one of the model's languages, which the
//   refusal lists, or, on the bundled server, to get a model that tells the language by itself.
//   For Listening that model is Listening's own (#1242): Mic input keeps its model.
// - "share": Listening's own model does not fit beside Mic input's (#1242, decided on 2026-11-27).
//   The fix is one model for both: Listening uses Mic input's again.
// - "server": the bundled speech recognition server did not start, or stopped (#1308 N-14). Its words
//   say why. A server that was busy, slow or gone is tried again; one whose model, device or driver
//   failed is fixed in its settings, which the dialog opens.
//
// Nothing here downloads: a download starts only from a review that shows its size, after consent.

import type { CaptionSource } from "./realtimeCaptionState";
import type { TranscriptionEndpoint } from "./useTranscriptionConsent";
import { detectingRecognizer } from "../setup/firstRunSetup.ts";
import type { SetupCatalog, SetupEntry } from "../setup/firstRunSetup.ts";

export type RecognitionFixKind = "models" | "language" | "share" | "server";

export interface RecognitionFix {
    endpoint: TranscriptionEndpoint;
    // The switch's source: "mic" for Mic transcription, "speaker" for Listening.
    source: CaptionSource;
    kind: RecognitionFixKind;
    // The refusal's reason (details.reason), as the core sent it.
    reason: string;
    // The languages the model takes (details.languages), for "language".
    languages: readonly string[];
    // "auto" was chosen and the model cannot tell the language by itself.
    auto: boolean;
}

const MODEL_REASONS: readonly string[] = ["realtime_asr_model_missing", "realtime_vad_model_missing"];
const LANGUAGE_REASONS: readonly string[] = ["realtime_language_auto_unsupported", "realtime_language_unsupported"];
// The bundled server's failures the dialog offers a fix for (#1308 N-14), and those of them that
// another try may get past.
const SERVER_REASONS: readonly string[] = ["speech_server_start_failed", "speech_server_exited", "speech_server_device_failed",
    "speech_server_vulkan_missing", "speech_server_out_of_memory", "speech_server_start_timeout", "speech_server_model_invalid",
    "speech_server_autostart_off", "speech_server_not_ready", "speech_server_busy"];
const RETRY_REASONS: readonly string[] = ["speech_server_busy", "speech_server_start_timeout", "speech_server_exited", "speech_server_not_ready"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const sourceOf = (endpoint: string): CaptionSource | null =>
    endpoint === "/set/enable/transcription_send" ? "mic" : endpoint === "/set/enable/transcription_receive" ? "speaker" : null;

// The fix for a switch's refusal (TRANSCRIPTION_SEND_NOT_READY / TRANSCRIPTION_RECEIVE_NOT_READY),
// or null when the main screen has nothing to offer but the notice.
export const recognitionFixOf = (endpoint: string, details: unknown): RecognitionFix | null => {
    const source = sourceOf(endpoint);
    const reason = isRecord(details) && typeof details.reason === "string" ? details.reason : "";
    if (!source || !reason) return null;
    const switchEndpoint = endpoint as TranscriptionEndpoint;
    if (MODEL_REASONS.includes(reason)) return { endpoint: switchEndpoint, source, kind: "models", reason, languages: [], auto: false };
    if (reason === "realtime_asr_models_do_not_fit") return { endpoint: switchEndpoint, source, kind: "share", reason, languages: [], auto: false };
    if (SERVER_REASONS.includes(reason)) return { endpoint: switchEndpoint, source, kind: "server", reason, languages: [], auto: false };
    if (!LANGUAGE_REASONS.includes(reason)) return null;
    const listed = isRecord(details) && Array.isArray(details.languages) ? details.languages : [];
    const languages = [...new Set(listed.filter((code): code is string => typeof code === "string" && code !== "" && code !== "auto"))];
    return { endpoint: switchEndpoint, source, kind: "language", reason, languages, auto: reason === "realtime_language_auto_unsupported" };
};

// The model offered to tell the language by itself: the catalog says which models do (#1242), and
// the one speech.cpp recommends for the most languages is offered, as the first-run setup does.
export const detectingAsr = (catalog: SetupCatalog): SetupEntry | null => detectingRecognizer(catalog);

// The language first offered: the UI's when the model takes it, else the first it lists.
export const firstLanguage = (languages: readonly string[], uiLanguage: unknown): string => {
    const ui = typeof uiLanguage === "string" ? uiLanguage.split(/[-_]/)[0].toLowerCase() : "";
    return languages.includes(ui) ? ui : languages[0] ?? "";
};

// The settings with the source's language changed, the rest as saved.
export const withLanguage = <T extends { mic: { language: string }; speaker: { language: string } }>(settings: T, source: CaptionSource, language: string): T =>
    ({ ...settings, [source]: { ...settings[source], language } });

// Where Settings shows the source's language (RealtimeASRSettings.tsx), for "open the setting".
export const languageSettingId = (source: CaptionSource): string => `realtime_${source}_language`;

// Whether the switch is tried again to fix a server's failure (#1308 N-14): it was busy, slow or gone.
export const retriesServer = (fix: RecognitionFix): boolean => fix.kind === "server" && RETRY_REASONS.includes(fix.reason);

// Where a server's failure is fixed: whether a switch may start the server, or its models and device.
export const serverSettingId = (reason: string): string => reason === "speech_server_autostart_off" ? "asr_server" : "speechcpp_section";
