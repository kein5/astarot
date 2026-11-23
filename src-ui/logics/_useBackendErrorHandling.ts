import { useTranscriptionConsent } from "./transcription/useTranscriptionConsent";
import { useTranslationSetup } from "./translation/useTranslationSetup";
import { useOcrSetup } from "./ocr/useOcrSetup";
import { createElement } from "react";
import { translatorName } from "./main/translatorLabel";
import { useI18n } from "@useI18n";
import { useStdoutToPython } from "@useStdoutToPython";

import {
    useNotificationStatus,
    useVolume,
    useLLMConnection,
    useIsSoftwareUpdating,
} from "@logics_common";

import {
    useMainFunction,
} from "@logics_main";

import {
    useTranscription,

    useTranslation,

    useOthers,

    useOcr,
    ocrStartErrorKey,
    ocrShouldRestoreSharedWindow,
    useOcrSharedWindow,

    useAdvancedSettings,
} from "@logics_configs";
import { ui_configs } from "./ui_configs";
import { clearLegacyConsentPending } from "./configs/legacyModelConsent";
import { CLOUD_TRANSCRIPTION_ENGINES } from "./configs/cloudTranscription";
import type { CloudTranscriptionBase } from "./configs/cloudTranscription";

// A 400 answer, as useReceiveRoutes passes it on (docs/spec/cross-cutting.md): the code and the
// backend's English message, `data` (the value the refused request leaves in place, or what the
// error is about) and the whole answer.
export interface BackendErrorReport {
    error_code: string | undefined;
    message: string | undefined;
    data: unknown;
    endpoint: string;
    result: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;
// A field of a value the backend sent, read as `value?.[name]` reads it.
const fieldOf = (value: unknown, name: string): unknown => isRecord(value) ? value[name] : undefined;

// The value a refused request leaves in place. The 400 answer carries it in `data`, in the form
// the setting's or the switch's own answers have (docs/spec/cross-cutting.md), and it goes back
// to the setting as it came, unchecked, as the answers to the requests that succeeded do
// (useReceiveRoutes). This overload is the one place in this file that says so: the type is the
// one the update it is passed to takes.
function keptValue<T>(data: unknown): T;
function keptValue(data: unknown): unknown {
    return data;
}

const OCR_ERROR_KEYS = {
    OCR_DISABLED_ENGINE_UNAVAILABLE: "common_error.ocr_engine_unavailable",
    OCR_DISABLED_MODEL_LOAD_FAILED: "common_error.ocr_model_load_failed",
    OCR_DISABLED_UNSUPPORTED_LANGUAGE: "common_error.ocr_unsupported_language",
    OCR_DISABLED_MODEL_MISSING: "common_error.ocr_model_missing",
    OCR_DISABLED_WINDOW_NOT_FOUND: "common_error.ocr_window_not_found",
    OCR_DISABLED_CAPTURE_UNAVAILABLE: "common_error.ocr_capture_unavailable",
    OCR_DISABLED_UNKNOWN: "common_error.ocr_unknown",
};

const CLOUD_TRANSCRIPTION_BASES = Object.fromEntries(CLOUD_TRANSCRIPTION_ENGINES.map(engine => [engine.key, engine.base]));
// The engine an endpoint's name points to, e.g. "groq_whisper" in /set/data/groq_whisper_auth_key.
const cloudTranscriptionBase = (key: string | undefined): CloudTranscriptionBase | undefined =>
    key === undefined ? undefined : CLOUD_TRANSCRIPTION_BASES[key];

const UI_OWNED_SETTINGS = new Set(["main_window_geometry", "message_box_ratio"]);

const ENDPOINT_URL_ERRORS = new Set([
    "CONNECTION_LMSTUDIO_URL_INVALID",
    "CONNECTION_OLLAMA_URL_INVALID",
    "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID",
    "CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID",
    "CREDENTIAL_REENTRY_REQUIRED",
]);

// Saved URL repairs can arrive before the UI applies its saved language.
// Keep the key in the toast and subscribe to language changes when it renders.
const EndpointUrlErrorNotice = ({ translationKey, fallback }: { translationKey: string; fallback: string | undefined }) => {
    const { t, i18n } = useI18n();
    return i18n.exists(translationKey) ? t(translationKey) : fallback;
};

// A saved choice of a translation model the app no longer offers went back to the default (#565).
// Sent at start-up with the URL repairs, so it too is translated when it renders.
const RetiredWeightNotice = ({ retired, selected }: { retired: unknown; selected: unknown }) => {
    const { t } = useI18n();
    const name = (weight: unknown) => translatorName(typeof weight === "string" ? weight : "", null, t);
    return t("config_page.translation.ctranslate2_weight_type.retired_reset", { weight_type: name(retired), selected: name(selected) });
};

export const _useBackendErrorHandling = () => {
    const { t, i18n } = useI18n();
    const { showNotification_Error, showNotification_Warning } = useNotificationStatus();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { updateIsSoftwareUpdating } = useIsSoftwareUpdating();

    const { updateMicThresholdCheckStatus, updateSpeakerThresholdCheckStatus } = useVolume();
    const transcription = useTranscription();
    const transcriptionConsent = useTranscriptionConsent();
    const translationSetup = useTranslationSetup();
    const ocrSetup = useOcrSetup();
    const {
        updateMicRecordTimeout,
        updateMicPhraseTimeout,
        updateMicMaxWords,

        updateSpeakerRecordTimeout,
        updateSpeakerPhraseTimeout,
        updateSpeakerMaxWords,
    } = transcription;

    const { updateTranslationStatus, updateTranscriptionSendStatus, updateTranscriptionReceiveStatus, updateOcrCaptureStatus, setOcrCapture } = useMainFunction();
    const { updateOcrSourceLanguage } = useOcr();
    const { restore: restoreSharedWindow } = useOcrSharedWindow();

    const {
        updateDeepLAuthKey,

        updateGoogleCloudAuthKey,
        updatePapagoClientID,
        updatePapagoAuthKey,

        updatePlamoAuthKey,
        updateSelectedPlamoModel,

        updateGeminiAuthKey,
        updateSelectedGeminiModel,

        updateOpenAIAuthKey,
        updateSelectedOpenAIModel,

        updateGroqAuthKey,
        updateSelectedGroqModel,

        updateOpenRouterAuthKey,
        updateSelectedOpenRouterModel,

        updateLMStudioURL,
        updateSelectedLMStudioModel,

        updateOpenAICompatibleURL,
        updateOpenAICompatibleAuthKey,
        updateSelectedOpenAICompatibleModel,

        updateOllamaURL,
        updateSelectedOllamaModel,

        updateSelectedCTranslate2WeightType,
        updateCTranslate2WeightTypeStatus,
    } = useTranslation();

    const { updateEnableVrcMicMuteSync } = useOthers();

    const {
        updateOscIpAddress,
        updateOscPort,
        updateEnableWebsocket,
        updateWebsocketHost,
        updateWebsocketPort,
        updateWebsocketTls,
        updateEnableObsBrowserSource,
        updateObsBrowserSourcePort,
        updateObsBrowserSourceMaxMessages,
        updateObsBrowserSourceDisplayDuration,
        updateObsBrowserSourceFadeoutDuration,
        updateObsBrowserSourceFontSize,
        updateObsBrowserSourceFontColor,
        updateObsBrowserSourceFontOutlineThickness,
        updateObsBrowserSourceFontOutlineColor,
        updateRvcBlockMs,
    } = useAdvancedSettings();

    const {
        updateIsOllamaConnected,
        updateIsLMStudioConnected,
    } = useLLMConnection();

    const errorHandling_Backend = ({error_code, message, data, endpoint, result}: BackendErrorReport) => {
        // The sidecar's `message` is English for the log; show the UI language
        // when a translation exists for the code.
        const key = `backend_errors.${error_code}`;
        const localized = error_code !== undefined && ENDPOINT_URL_ERRORS.has(error_code)
            ? createElement(EndpointUrlErrorNotice, { translationKey: key, fallback: message })
            : typeof error_code === "string" && i18n.exists(key) ? t(key) : message;
        const settleObsLifecycleError = () => {
            // The cause can be a dependent service. `data` belongs to the
            // initiating endpoint, never to a field inferred from that cause.
            if (endpoint === "/set/data/websocket_host") updateWebsocketHost(keptValue(data));
            else if (endpoint === "/set/data/obs_browser_source_port") updateObsBrowserSourcePort(keptValue(data));
            else if (endpoint === "/set/enable/obs_browser_source" || endpoint === "/set/disable/obs_browser_source") {
                updateEnableObsBrowserSource(keptValue(data));
            }
            // Rollback may have disabled a service if its old address was
            // taken too. Read the dependent switches instead of guessing.
            asyncStdoutToPython("/get/data/websocket_server");
            asyncStdoutToPython("/get/data/obs_browser_source");
        };
        switch (error_code) {
            case "OVERLAY_RUNTIME_FAILED":
                showNotification_Error(localized, { category_id: error_code });
                asyncStdoutToPython("/get/data/overlay_small_log");
                asyncStdoutToPython("/get/data/overlay_large_log");
                asyncStdoutToPython("/get/data/overlay_vr_panel");
                break;
            case "OVERLAY_VR_PANEL_UNSUPPORTED":
                // Nothing was started or stopped; only the switch has to show what is saved.
                showNotification_Error(localized, { category_id: error_code });
                asyncStdoutToPython("/get/data/overlay_vr_panel");
                break;
            case "OVERLAY_FONT_NOT_FOUND":
                // The saved font stays; the list shows it again.
                showNotification_Warning(localized, { category_id: error_code });
                asyncStdoutToPython("/get/data/overlay_font_family");
                break;
            case "MESSAGE_OUTPUT_FAILED": {
                const outputs = ["osc", "overlay_small", "overlay_large", "clipboard", "ui", "websocket", "logger", "history", "tts"];
                const requested = fieldOf(data, "output");
                const output = typeof requested === "string" && outputs.includes(requested) ? requested : "unknown";
                showNotification_Warning(t(key, { output: t(`message_outputs.${output}`) }),
                    { category_id: `${error_code}.${output}` });
                break;
            }
            // ============================================================================
            // デバイス関連エラー (DEVICE_*)
            // ============================================================================
            case "DEVICE_NO_MIC":
                updateMicThresholdCheckStatus(false);
                showNotification_Error(t("common_error.no_device_mic"), { category_id: error_code });
                return;
            case "DEVICE_NO_SPEAKER":
                updateSpeakerThresholdCheckStatus(false);
                showNotification_Error(t("common_error.no_device_speaker"), { category_id: error_code });
                return;

            // ============================================================================
            // 翻訳関連エラー (TRANSLATION_*)
            // ============================================================================
            case "TRANSLATION_ENGINE_LIMIT":
                showNotification_Error(t("common_error.translation_limit"), { category_id: error_code });
                return;
            case "TRANSLATION_VRAM_CHAT":
            case "TRANSLATION_VRAM_MIC":
            case "TRANSLATION_VRAM_SPEAKER":
            case "TRANSLATION_VRAM_ENABLE":
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "TRANSLATION_MODEL_MISSING":
                updateTranslationStatus(keptValue(data));
                // The user pressed the switch: open the review that fetches the model,
                // where they are (main window, as the mic's engine choice does).
                // Any other request says what is missing.
                if (endpoint === "/set/enable/translation") translationSetup.open(true);
                else showNotification_Error(localized, { category_id: error_code });
                return;
            case "TRANSLATION_DISABLED_VRAM":
            case "TRANSLATION_MODEL_LOAD_FAILED":
                updateTranslationStatus(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "TRANSLATION_LANGUAGE_UNSUPPORTED": {
                // The backend already pushed the reset language selection; this
                // only explains why it changed.
                const languages = fieldOf(data, "languages") ?? [];
                showNotification_Warning(t("common_error.translation_language_unsupported", {
                    model: translatorName(fieldOf(data, "weight_type"), fieldOf(data, "engine"), t),
                    languages: Array.isArray(languages) ? languages.join(", ") : "",
                }), { category_id: error_code, hide_duration: null });
                return;
            }

            // ============================================================================
            // 音声認識関連エラー (TRANSCRIPTION_*)
            // ============================================================================
            case "TRANSCRIPTION_ENGINE_NOT_SELECTED":
            case "TRANSCRIPTION_ENGINE_UNAVAILABLE": {
                if (endpoint === "/set/enable/transcription_send") updateTranscriptionSendStatus(false);
                if (endpoint === "/set/enable/transcription_receive") updateTranscriptionReceiveStatus(false);
                const mode = error_code === "TRANSCRIPTION_ENGINE_NOT_SELECTED" ? "choose" : "settings";
                transcriptionConsent.open(endpoint, mode);
                if (mode !== "choose") showNotification_Error(localized, { category_id: error_code });
                return;
            }
            // Linux, and Windows with the local engine: the Mic/Speaker switch drives realtime
            // ASR, which is not configured or has stopped. details.reason names the next step.
            case "TRANSCRIPTION_SEND_NOT_READY":
            case "TRANSCRIPTION_RECEIVE_NOT_READY": {
                (error_code === "TRANSCRIPTION_SEND_NOT_READY" ? updateTranscriptionSendStatus : updateTranscriptionReceiveStatus)(false);
                const named = fieldOf(fieldOf(result, "details"), "reason");
                const reason = typeof named === "string" ? named : "";
                showNotification_Error(t(`realtime_toggle.${reason || "generic"}`, {
                    reason, defaultValue: t("realtime_toggle.generic", { reason }),
                }), { category_id: error_code });
                return;
            }

            // ============================================================================
            // OCR関連エラー (OCR_*)  開始できずバックエンドより強制的にOFFへ戻る
            // ============================================================================
            case "OCR_DISABLED_ENGINE_UNAVAILABLE":
            case "OCR_DISABLED_MODEL_LOAD_FAILED":
            case "OCR_DISABLED_UNSUPPORTED_LANGUAGE":
            case "OCR_DISABLED_MODEL_MISSING":
            case "OCR_DISABLED_WINDOW_NOT_FOUND":
            case "OCR_DISABLED_CAPTURE_UNAVAILABLE":
            case "OCR_DISABLED_UNKNOWN": {
                // 理由ごとに、次に何をすればよいか (モデルのダウンロード、VRChatの起動) を出す
                if (endpoint === "/set/data/ocr_source_language") {
                    updateOcrSourceLanguage(keptValue(data));
                } else {
                    updateOcrCaptureStatus(keptValue(data));
                }
                // The user pressed the switch: say what is missing where they are and lead to
                // the models section, whose review asks before downloading. A language change
                // made in the OCR settings already shows that section, so a notice is enough there.
                // The backend tells why the switch could not start on /run/enable_ocr_capture, and only
                // the switch (/set/enable/ocr_capture) starts it.
                if (error_code === "OCR_DISABLED_MODEL_MISSING"
                    && (endpoint === "/run/enable_ocr_capture" || endpoint === "/set/enable/ocr_capture")) {
                    ocrSetup.show();
                    return;
                }
                // On a Wayland desktop the window may exist and still not be found by name: that notice says how to share it.
                const notify = () => showNotification_Error(t(ocrStartErrorKey(error_code) ?? OCR_ERROR_KEYS[error_code], { defaultValue: message }), { category_id: error_code });
                // The user turned chat reading on and a window was shared before: share the window the
                // desktop remembers, then turn chat reading on once more. A second failure is reported.
                if (endpoint !== "/set/data/ocr_source_language" && ocrShouldRestoreSharedWindow(error_code)) {
                    // The switch waits meanwhile (OcrSharedWindowController), so settle it when giving up.
                    const giveUp = () => { updateOcrCaptureStatus(false); notify(); };
                    Promise.resolve(restoreSharedWindow()).then(shared => shared === true ? setOcrCapture(true) : giveUp(), giveUp);
                    return;
                }
                notify();
                return;
            }

            // ============================================================================
            // ウェイトダウンロード関連エラー (WEIGHT_*)
            // ============================================================================
            case "WEIGHT_DOWNLOAD_CONSENT_REQUIRED":
                if (endpoint === "/run/download_ctranslate2_weight") {
                    updateCTranslate2WeightTypeStatus(old => clearLegacyConsentPending(old.data, fieldOf(data, "weight_type")));
                }
                showNotification_Warning(t(fieldOf(data, "startup") ? "legacy_model_downloads.startup_skipped" : "backend_errors.WEIGHT_DOWNLOAD_CONSENT_REQUIRED",
                    { model: fieldOf(data, "weight_type") }), { category_id: `${error_code}:${fieldOf(data, "kind")}:${fieldOf(data, "weight_type")}`, hide_duration: null });
                return;
            case "WEIGHT_CTRANSLATE2_LICENSE_CONSENT_REQUIRED":
                // Normally unreachable: Config -> Translation asks before sending.
                // Undo the optimistic UI state of whichever request was refused.
                if (endpoint === "/set/data/selected_ctranslate2_weight_type") {
                    updateSelectedCTranslate2WeightType(keptValue(fieldOf(data, "selected")));
                } else {
                    updateCTranslate2WeightTypeStatus((old_status) => old_status.data.map((item) =>
                        item.id === fieldOf(data, "weight_type") ? { ...item, is_pending: false, progress: null } : item
                    ));
                }
                showNotification_Warning(t("common_error.ctranslate2_license_consent_required", { weight_type: translatorName(fieldOf(data, "weight_type"), null, t) }), { category_id: error_code });
                return;
            case "WEIGHT_CTRANSLATE2_NON_COMMERCIAL_NOTICE":
                showNotification_Warning(t("config_page.translation.ctranslate2_weight_type.non_commercial_notice", {
                    weight_type: translatorName(fieldOf(data, "weight_type"), null, t),
                    license: fieldOf(data, "license"),
                }), { category_id: error_code, hide_duration: null });
                return;
            case "WEIGHT_CTRANSLATE2_RETIRED":
                // The core already loaded the default; the selection the UI reads is the default.
                showNotification_Warning(createElement(RetiredWeightNotice, {
                    retired: fieldOf(data, "weight_type"), selected: fieldOf(data, "selected"),
                }), { category_id: error_code, hide_duration: null });
                return;

            // ============================================================================
            // ソフトウェア更新関連エラー (UPDATE_*)
            // ============================================================================
            case "UPDATE_SOFTWARE_DOWNLOAD":
                // インストーラを起動できなかった。更新中の表示のまま待ち続けないよう戻す
                updateIsSoftwareUpdating(false);
                showNotification_Error(t("common_error.failed_update_software"), { category_id: error_code });
                return;
            case "UPDATE_SOFTWARE_VERIFY":
                updateIsSoftwareUpdating(false);
                showNotification_Error(t("common_error.failed_update_software_verify"), { category_id: error_code });
                return;

            // ============================================================================
            // バリデーションエラー (VALIDATION_*)
            // ============================================================================
            case "VALIDATION_MIC_THRESHOLD":
                showNotification_Error(t("common_error.threshold_invalid_value", { min: ui_configs.mic_threshold_min, max: ui_configs.mic_threshold_max }), { category_id: error_code });
                return;
            case "VALIDATION_SPEAKER_THRESHOLD":
                showNotification_Error(t("common_error.threshold_invalid_value", { min: ui_configs.speaker_threshold_min, max: ui_configs.speaker_threshold_max }), { category_id: error_code });
                return;
            case "VALIDATION_MIC_RECORD_TIMEOUT":
                updateMicRecordTimeout(keptValue(data));
                showNotification_Error(t("common_error.invalid_value_mic_record_timeout", { mic_phrase_timeout_label: t("config_page.transcription.mic_phrase_timeout.label") }), { category_id: error_code });
                return;
            case "VALIDATION_MIC_PHRASE_TIMEOUT":
                updateMicPhraseTimeout(keptValue(data));
                showNotification_Error(t("common_error.invalid_value_mic_phrase_timeout", { mic_record_timeout_label: t("config_page.transcription.mic_record_timeout.label") }), { category_id: error_code });
                return;
            case "VALIDATION_MIC_MAX_PHRASES":
                updateMicMaxWords(keptValue(data));
                showNotification_Error(t("common_error.invalid_value_mic_max_phrase"), { category_id: error_code });
                return;
            case "VALIDATION_SPEAKER_RECORD_TIMEOUT":
                updateSpeakerRecordTimeout(keptValue(data));
                showNotification_Error(t("common_error.invalid_value_speaker_record_timeout", { speaker_phrase_timeout_label: t("config_page.transcription.speaker_phrase_timeout.label") }), { category_id: error_code });
                return;
            case "VALIDATION_SPEAKER_PHRASE_TIMEOUT":
                updateSpeakerPhraseTimeout(keptValue(data));
                showNotification_Error(t("common_error.invalid_value_speaker_phrase_timeout", { speaker_record_timeout_label: t("config_page.transcription.speaker_record_timeout.label") }), { category_id: error_code });
                return;
            case "VALIDATION_SPEAKER_MAX_PHRASES":
                updateSpeakerMaxWords(keptValue(data));
                showNotification_Error(t("common_error.invalid_value_speaker_max_phrase"), { category_id: error_code });
                return;
            case "VALIDATION_RVC_BLOCK_MS":
                updateRvcBlockMs(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "VALIDATION_INVALID_IP":
            case "VALIDATION_CANNOT_SET_IP":
                if (endpoint === "/set/data/websocket_host") {
                    updateWebsocketHost(keptValue(data));
                } else if (endpoint === "/set/data/osc_ip_address") {
                    updateOscIpAddress(keptValue(data));
                }
                showNotification_Error(localized, { category_id: error_code });
                return;
            // A setting the config refused. `data` is the refused value, so the
            // screen asks for the kept one again. Window geometry and the message
            // box ratio come from the window itself and are not re-applied.
            case "VALIDATION_CONFIG_VALUE_INVALID": {
                const name = endpoint?.match(/^\/set\/data\/(\w+)$/)?.[1];
                if (name && !UI_OWNED_SETTINGS.has(name)) asyncStdoutToPython(`/get/data/${name}`);
                showNotification_Error(t("common_error.invalid_config_value"), { category_id: error_code });
                return;
            }
            case "VALIDATION_OSC_PORT_INVALID":
                updateOscPort(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;

            // ============================================================================
            // 認証エラー (AUTH_*)
            // ============================================================================
            case "AUTH_DEEPL_LENGTH":
                updateDeepLAuthKey(keptValue(data));
                showNotification_Error(t("common_error.deepl_auth_key_invalid_length"), { category_id: error_code });
                return;
            case "AUTH_DEEPL_FAILED":
                updateDeepLAuthKey(keptValue(data));
                showNotification_Error(t("common_error.deepl_auth_key_failed_authentication"), { category_id: error_code });
                return;
            case "AUTH_GOOGLE_CLOUD_INVALID":
            case "AUTH_GOOGLE_CLOUD_FAILED":
                updateGoogleCloudAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "AUTH_PAPAGO_INVALID":
            case "AUTH_PAPAGO_FAILED":
                // The Client ID and the secret share the codes; the endpoint says which field to restore.
                if (endpoint === "/set/data/papago_client_id") updatePapagoClientID(keptValue(data ?? ""));
                else updatePapagoAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "AUTH_PLAMO_LENGTH":
            case "AUTH_PLAMO_FAILED":
                updatePlamoAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "AUTH_GEMINI_LENGTH":
            case "AUTH_GEMINI_FAILED":
                updateGeminiAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "AUTH_OPENAI_INVALID":
            case "AUTH_OPENAI_FAILED":
                updateOpenAIAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "AUTH_GROQ_INVALID":
            case "AUTH_GROQ_FAILED":
                updateGroqAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "AUTH_OPENROUTER_INVALID":
            case "AUTH_OPENROUTER_FAILED":
                updateOpenRouterAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            // Cloud transcription: the endpoint names the engine, e.g.
            // /set/data/groq_whisper_auth_key -> GroqWhisperAuthKey.
            case "TRANSCRIPTION_API_AUTH_FAILED": {
                const base = cloudTranscriptionBase(endpoint?.match(/^\/set\/data\/(\w+?)_auth_key(?:_and_url)?$/)?.[1]);
                if (base) transcription[`update${base}AuthKey`](keptValue(data ?? ""));
                showNotification_Error(t("common_error.transcription_api_auth_failed"), { category_id: error_code });
                return;
            }
            case "MODEL_TRANSCRIPTION_INVALID": {
                const base = cloudTranscriptionBase(endpoint?.match(/^\/set\/data\/selected_(\w+?)_model$/)?.[1]);
                if (base) transcription[`updateSelected${base}Model`](keptValue(data));
                showNotification_Error(t("common_error.transcription_model_invalid"), { category_id: error_code });
                return;
            }
            case "CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID":
                transcription.updateCustomWhisperURL(keptValue(data ?? ""));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "AUTH_OPENAI_COMPATIBLE_INVALID":
            case "AUTH_OPENAI_COMPATIBLE_FAILED":
                updateOpenAICompatibleAuthKey(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;

            // ============================================================================
            // モデル選択エラー (MODEL_*)
            // ============================================================================
            case "MODEL_PLAMO_INVALID":
                updateSelectedPlamoModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "MODEL_GEMINI_INVALID":
                updateSelectedGeminiModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "MODEL_OPENAI_INVALID":
                updateSelectedOpenAIModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "MODEL_GROQ_INVALID":
                updateSelectedGroqModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "MODEL_OPENROUTER_INVALID":
                updateSelectedOpenRouterModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "MODEL_LMSTUDIO_INVALID":
                updateSelectedLMStudioModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "MODEL_OPENAI_COMPATIBLE_INVALID":
                updateSelectedOpenAICompatibleModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "MODEL_OLLAMA_INVALID":
                updateSelectedOllamaModel(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;

            // ============================================================================
            // 接続エラー (CONNECTION_*)
            // ============================================================================
            case "CONNECTION_LMSTUDIO_FAILED":
                updateIsLMStudioConnected(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "CONNECTION_OLLAMA_FAILED":
                updateIsOllamaConnected(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "CONNECTION_LMSTUDIO_URL_INVALID":
                updateLMStudioURL(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "CONNECTION_OLLAMA_URL_INVALID":
                updateOllamaURL(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID":
                updateOpenAICompatibleURL(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "CREDENTIAL_REENTRY_REQUIRED":
                if (endpoint === "/set/data/openai_compatible_url") updateOpenAICompatibleURL(keptValue(data));
                else if (endpoint === "/set/data/custom_whisper_url") transcription.updateCustomWhisperURL(keptValue(data));
                else if (endpoint === "/set/data/papago_client_id") {
                    // The URL wording does not fit: a new Client ID needs the secret again.
                    updatePapagoClientID(keptValue(data));
                    showNotification_Error(t("config_page.translation.papago_client_id.reentry_required"), { category_id: error_code });
                    return;
                }
                showNotification_Error(localized, { category_id: error_code });
                return;

            // ============================================================================
            // WebSocketエラー (WEBSOCKET_*)
            // ============================================================================
            case "WEBSOCKET_HOST_INVALID":
            case "WEBSOCKET_PORT_UNAVAILABLE":
            case "WEBSOCKET_PORT_INVALID":
                if (error_code === "WEBSOCKET_HOST_INVALID") updateWebsocketHost(keptValue(data));
                else updateWebsocketPort(keptValue(data));
                // 変更に失敗して元のアドレスでも立て直せないと、サイドカーはサーバーと OBS をオフにする
                asyncStdoutToPython("/get/data/websocket_server");
                asyncStdoutToPython("/get/data/obs_browser_source");
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "WEBSOCKET_SERVER_UNAVAILABLE":
                if (endpoint === "/set/enable/obs_browser_source") settleObsLifecycleError();
                else if (endpoint === "/set/data/websocket_tls") {
                    // The servers could not restart with the new certificate and went back to the old one.
                    updateWebsocketTls(keptValue(data));
                    asyncStdoutToPython("/get/data/websocket_server");
                    asyncStdoutToPython("/get/data/obs_browser_source");
                } else updateEnableWebsocket(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            // Beyond this PC only over TLS. From the host field, the certificate fields, or at
            // startup, when a saved LAN host without a usable certificate went back to 127.0.0.1.
            case "WEBSOCKET_HOST_NEEDS_TLS":
                if (endpoint === "/set/data/websocket_tls") updateWebsocketTls(keptValue(data));
                else updateWebsocketHost(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "WEBSOCKET_HOST_RESET_WITHOUT_TLS":
                updateWebsocketHost(keptValue(data));
                showNotification_Warning(localized, { category_id: error_code, hide_duration: null });
                return;
            case "WEBSOCKET_TLS_INVALID":
                updateWebsocketTls(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;

            // ============================================================================
            // OBS Browser Sourceエラー (OBS_BROWSER_SOURCE_*)
            // ============================================================================
            case "OBS_BROWSER_SOURCE_HOST_UNAVAILABLE":
            case "OBS_BROWSER_SOURCE_PORT_INVALID":
            case "OBS_BROWSER_SOURCE_PORT_UNAVAILABLE":
            case "OBS_BROWSER_SOURCE_SERVER_UNAVAILABLE":
                settleObsLifecycleError();
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "OBS_BROWSER_SOURCE_MAX_MESSAGES_INVALID":
                updateObsBrowserSourceMaxMessages(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "OBS_BROWSER_SOURCE_DISPLAY_DURATION_INVALID":
                updateObsBrowserSourceDisplayDuration(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "OBS_BROWSER_SOURCE_FADEOUT_DURATION_INVALID":
                updateObsBrowserSourceFadeoutDuration(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "OBS_BROWSER_SOURCE_FONT_SIZE_INVALID":
                updateObsBrowserSourceFontSize(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "OBS_BROWSER_SOURCE_FONT_COLOR_INVALID":
                updateObsBrowserSourceFontColor(keptValue(data));
                showNotification_Error(t("common_error.invalid_hex_color", { brand_color_hex: ui_configs.brand_color_hex }), { category_id: error_code });
                return;
            case "OBS_BROWSER_SOURCE_FONT_OUTLINE_THICKNESS_INVALID":
                updateObsBrowserSourceFontOutlineThickness(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;
            case "OBS_BROWSER_SOURCE_FONT_OUTLINE_COLOR_INVALID":
                updateObsBrowserSourceFontOutlineColor(keptValue(data));
                showNotification_Error(t("common_error.invalid_hex_color", { brand_color_hex: ui_configs.brand_color_hex }), { category_id: error_code });
                return;

            // The VAD runs on the speech.cpp server of speech recognition. A switch refused while
            // that server is not set up keeps its saved value, read again; a recording that cannot
            // use it cuts by volume. details.reason names the next step when there is one.
            case "VAD_UNAVAILABLE": {
                const refused = endpoint === "/set/enable/mic_vad_filter" || endpoint === "/set/enable/speaker_vad_filter";
                if (refused) asyncStdoutToPython(endpoint.replace("/set/enable/", "/get/data/"));
                const named = fieldOf(fieldOf(result, "details"), "reason");
                const reason = typeof named === "string" ? named : "";
                const next = reason && i18n.exists(`realtime_toggle.${reason}`) ? t(`realtime_toggle.${reason}`) : "";
                const text = refused ? localized : t(key, { context: "recording" });
                showNotification_Warning(next ? `${text} ${next}` : text, { category_id: error_code });
                return;
            }

            // ============================================================================
            // VRC連携エラー (VRC_*)
            // ============================================================================
            case "VRC_MIC_MUTE_SYNC_OSC_DISABLED":
                updateEnableVrcMicMuteSync(keptValue(data));
                showNotification_Error(localized, { category_id: error_code });
                return;

            // ============================================================================
            // 汎用エラー (GENERAL_*)
            // ============================================================================
            // The API keys' store could not be read or written. The keys work for this run.
            // A key that did not move to the OS store still works where it was; a store that is
            // locked or not running needs the user's keyring, which the app does not open.
            case "SECRET_STORE_FAILED": {
                const reason = fieldOf(data, "reason");
                const context = fieldOf(data, "operation") === "migrate" ? "moving"
                    : reason === "unavailable" || reason === "locked" ? "os_store" : undefined;
                const text = context && i18n.exists(`${key}_${context}`) ? t(key, { context }) : localized;
                showNotification_Error(text, { hide_duration: null, category_id: error_code });
                return;
            }

            case "GENERAL_EXCEPTION":
            case "GENERAL_UNKNOWN":
                console.error(`Error occurred at endpoint: ${endpoint}\nerror_code: ${error_code}\nmessage: ${message}\nresult: ${JSON.stringify(result)}`);
                // 詳細はコンソールに出した。画面には英語の例外文ではなく、することとコードだけを出す
                showNotification_Error(t("common_error.unexpected_error", { code: error_code }), { hide_duration: null, category_id: error_code });
                return;

            default:
                console.error(`Invalid error_code or message: ${error_code}\nendpoint: ${endpoint}\nmessage: ${message}\nresult: ${JSON.stringify(result)}`);
                showNotification_Error(t("common_error.unexpected_error", { code: error_code ?? endpoint }), { hide_duration: null, category_id: error_code });
                return;
        }

    }

    return {
        errorHandling_Backend,
    }
};
