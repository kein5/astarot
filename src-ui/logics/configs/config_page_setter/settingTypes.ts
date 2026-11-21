// The types of the settings made from SETTINGS_ARRAY (ui_config_setter.ts): each setting's value,
// how its entry is written, and the fields its category hook (useTranslation, useOcr, ...) returns.
//
// They live apart from SETTINGS_ARRAY because tests and tools/spec_catalog.py read that file's
// entries as text.
import type { AtomPayload, AtomState, UpdateOptions } from "@store";
import type { CTranslate2WeightStatus, ui_configs } from "@ui_configs";
import type { StdoutResult } from "@useStdoutToPython";
import type { DeviceOption } from "@utils";
import type vr_layout from "../../../views/vr/vr_layout.json";
import type { SettingLogicsTemplateId } from "../../common/initializationFields.ts";
import type { TelemetryPreview } from "../../common/telemetryRows.ts";
import type { ExperimentalFeatureValues } from "../experimentalFeatures.ts";
import type { OcrReadiness, OcrRegion, OcrRuntime } from "../ocrReadiness.ts";
import type { SETTINGS_ARRAY } from "./ui_config_setter";

export type SettingCategory = "Device" | "Appearance" | "Translation" | "Transcription" | "Ocr" | "Vr" | "Others"
    | "AdvancedSettings" | "ExperimentalFeatures" | "UsagePresets";

// The control the settings page shows for the setting.
export type SettingUiTemplateId = "list" | "select" | "toggle" | "slider" | "input" | "custom" | "object";

// How the backend's list becomes the setting's value (useSettingsLogics.ts, transformResponse).
export type SettingResponseTransform = "deviceOptionsToObject" | "arrayToObject" | "arrayToIdLabel" | "transformToIndexedArray";

// A /run/<endpoint> route: "from_backend" the backend sends it when the value changes on its side.
export type SettingRunDirection = "from_backend" | "to_backend";

// A device or model list, kept as { id: label } (response_transform). [] until the backend answers.
export type SettingOptions = Readonly<Record<string, string>> | [];

// One translation device (SELECTED_TRANSLATION_COMPUTE_DEVICE, docs/spec/data-and-persistence.md).
export interface TranslationComputeDevice {
    device: string;
    device_index: number;
    device_name: string;
    compute_types?: string[];
    // A GPU whose ONNX Runtime was set up during this run: used from the next start.
    restart_required?: boolean;
}

// A model the user added to the local translation, known only to the backend: a translation
// catalog entry ("user:<id>").
export interface CustomWeightStatus {
    id: string;
    is_custom: true;
    is_downloaded: boolean;
}

// What a download adds to a weight while it runs (useSettingsLogics.ts).
export interface WeightDownloadState {
    is_pending?: boolean;
    job_id?: string | null;
    progress?: number | null;
}

export type WeightTypeStatus = (CTranslate2WeightStatus | CustomWeightStatus) & WeightDownloadState;

// /run/download_progress_<endpoint>. progress is 0 to 1.
export interface WeightDownloadProgress {
    weight_type: string;
    job_id?: string | null;
    progress: number;
}

// /get/data/selectable_<endpoint>_type_dict: whether each weight is downloaded.
export type DownloadedWeights = Readonly<Record<string, boolean>>;

// /run/downloaded_<endpoint> and /run/download_<endpoint>: the weight's id, or the result.
export type WeightDownloaded = string | { weight_type?: string; downloaded?: boolean } | null | undefined;

export type OverlayLogSettings = typeof ui_configs.overlay_small_log_default_settings;
export type OverlayDesktopSettings = typeof ui_configs.overlay_desktop_default_settings;
export type MessageFormatParts = typeof ui_configs.send_message_format_parts;
export type VrPanelLayout = typeof vr_layout;

// Where the desktop caption window was dragged; null on both until it is.
export interface OverlayDesktopPlacement {
    x: number | null;
    y: number | null;
}

// Each setting's value, as its atom holds it. The backend sends these (docs/spec/); they are
// declared, not checked when they arrive, except for what /run/initialization_complete checks
// (initializationFields.ts). Credentials and the chosen models may be null when none is set.
export interface SettingValues {
    // Device
    SpeakerDeviceOptions: SettingOptions;
    SelectedSpeakerDeviceId: string;
    MicDeviceOptions: SettingOptions;
    SelectedMicDeviceId: string;
    EnableAutoMicSelect: boolean;
    MicHostList: SettingOptions;
    MicDeviceList: SettingOptions;
    SelectedMicHost: string;
    SelectedMicDevice: string;
    MicVadFilter: boolean;
    EnableAutomaticMicThreshold: boolean;
    MicThreshold: number;
    EnableAutoSpeakerSelect: boolean;
    SpeakerDeviceList: SettingOptions;
    SelectedSpeakerDevice: string;
    SpeakerVadFilter: boolean;
    VadAvailable: boolean;
    EnableAutomaticSpeakerThreshold: boolean;
    SpeakerThreshold: number;

    // Appearance
    UiLanguage: string;
    UiScaling: number;
    MessageLogUiScaling: number;
    SendMessageButtonType: string;
    CatalogLayout: string;
    ShowResendButton: boolean;
    SelectedFontFamily: string;
    Transparency: number;

    // Translation
    CTranslate2WeightTypeStatus: WeightTypeStatus[];
    SelectedCTranslate2WeightType: string;
    SelectedTranslationComputeType: string;
    SelectableTranslationComputeDeviceList: Readonly<Record<number, TranslationComputeDevice>> | [];
    // "" until the backend sends the device.
    SelectedTranslationComputeDevice: TranslationComputeDevice | "";
    DeepLAuthKey: string | null;
    GoogleCloudAuthKey: string | null;
    PapagoClientID: string;
    PapagoAuthKey: string | null;
    PlamoAuthKey: string | null;
    SelectablePlamoModelList: SettingOptions;
    SelectedPlamoModel: string | null;
    GeminiAuthKey: string | null;
    SelectableGeminiModelList: SettingOptions;
    SelectedGeminiModel: string | null;
    OpenAIAuthKey: string | null;
    SelectableOpenAIModelList: SettingOptions;
    SelectedOpenAIModel: string | null;
    GroqAuthKey: string | null;
    SelectableGroqModelList: SettingOptions;
    SelectedGroqModel: string | null;
    OpenRouterAuthKey: string | null;
    SelectableOpenRouterModelList: SettingOptions;
    SelectedOpenRouterModel: string | null;
    LMStudioURL: string;
    SelectableLMStudioModelList: SettingOptions;
    SelectedLMStudioModel: string | null;
    OpenAICompatibleURL: string;
    OpenAICompatibleAuthKey: string | null;
    SelectableOpenAICompatibleModelList: SettingOptions;
    SelectedOpenAICompatibleModel: string | null;
    OllamaURL: string;
    SelectableOllamaModelList: SettingOptions;
    SelectedOllamaModel: string | null;
    LLMTranslationTemperature: string;
    LLMTranslationInstructions: string;

    // Transcription
    MicRecordTimeout: number;
    MicPhraseTimeout: number;
    MicMaxWords: number;
    MicWordFilterList: string[];
    SpeakerRecordTimeout: number;
    SpeakerPhraseTimeout: number;
    SpeakerMaxWords: number;
    SelectedTranscriptionEngine: string | null;
    SelectableTranscriptionEngines: string[];
    GroqWhisperAuthKey: string | null;
    SelectableGroqWhisperModelList: SettingOptions;
    SelectedGroqWhisperModel: string | null;
    OpenAIWhisperAuthKey: string | null;
    SelectableOpenAIWhisperModelList: SettingOptions;
    SelectedOpenAIWhisperModel: string | null;
    CustomWhisperURL: string;
    CustomWhisperAuthKey: string | null;
    SelectableCustomWhisperModelList: SettingOptions;
    SelectedCustomWhisperModel: string | null;
    DeepgramAuthKey: string | null;
    SelectableDeepgramModelList: SettingOptions;
    SelectedDeepgramModel: string | null;
    MicAvgLogprob: number;
    MicNoSpeechProb: number;
    SpeakerAvgLogprob: number;
    SpeakerNoSpeechProb: number;

    // Ocr
    OcrWindowTitle: string;
    SelectableOcrSourceLanguageList: SettingOptions;
    OcrSourceLanguage: string;
    OcrPollIntervalMs: number;
    OcrMinConfidence: number;
    OcrBubbleMinTextLength: number;
    OcrCaptureRegion: OcrRegion;
    OcrVrCaptureRegion: OcrRegion;
    OcrCaptureStatus: OcrRuntime | null;
    OcrChatboxFilter: boolean;
    OcrUseChatboxDetector: boolean;
    OcrPortalRestoreToken: string;
    OcrReadiness: OcrReadiness | null;
    OcrModelReadiness: OcrReadiness | null;

    // Vr
    IsEnabledOverlaySmallLog: boolean;
    OverlaySmallLogSettings: OverlayLogSettings;
    IsEnabledOverlayLargeLog: boolean;
    OverlayLargeLogSettings: OverlayLogSettings;
    IsEnabledOverlayDesktop: boolean;
    OverlayDesktopSettings: OverlayDesktopSettings;
    OverlayDesktopPlacement: OverlayDesktopPlacement;
    IoFlowOverlaySettings: { desktop: boolean; count: number };
    OverlayShowOnlyTranslatedMessages: boolean;
    OverlayFontFamily: string;
    OverlayFontMissingLanguages: string[];
    IsEnabledOverlayVrPanel: boolean;
    OverlayVrPanelAnchor: string;
    OverlayVrPanelLocked: boolean;
    OverlayVrPanelFontSize: number;
    VrPanelLayout: VrPanelLayout;
    OverlayVrLauncherHand: string;
    OverlayVrLauncherAutoHide: boolean;
    OverlayVrTooltip: boolean;
    OverlayVrPanelOpacity: number;
    VoiceTypingMode: boolean;

    // Others
    EnableAutoClearMessageInputBox: boolean;
    EnableCheckSoftwareUpdates: boolean;
    EnableSendOnlyTranslatedMessages: boolean;
    EnableAutoExportMessageLogs: boolean;
    // "found", "not_found" or "unknown"; null until asked.
    VrchatOscPresence: string | null;
    EnableVrcMicMuteSync: boolean;
    EnableSendMessageToVrc: boolean;
    EnableNotificationVrcSfx: boolean;
    EnableSendReceivedMessageToVrc: boolean;
    SendMessageFormatParts: MessageFormatParts;
    ReceivedMessageFormatParts: MessageFormatParts;
    ConvertMessageToRomaji: boolean;
    ConvertMessageToHiragana: boolean;
    AutoDownloadModels: boolean;
    Telemetry: boolean;
    TelemetryNotice: { pending: boolean; enabled: boolean };
    // { endpoint, app_started, sent }; null until asked.
    TelemetryPreview: TelemetryPreview | null;

    // AdvancedSettings
    OscIpAddress: string;
    OscPort: number;
    EnableOscQuery: boolean;
    EnableWebsocket: boolean;
    WebsocketHost: string;
    WebsocketPort: number;
    WebsocketAuthToken: string;
    WebsocketTls: { cert_file: string; key_file: string };
    EnableObsBrowserSource: boolean;
    ObsBrowserSourcePort: number;
    ObsBrowserSourceMaxMessages: number;
    ObsBrowserSourceDisplayDuration: number;
    ObsBrowserSourceFadeoutDuration: number;
    ObsBrowserSourceFontSize: number;
    ObsBrowserSourceFontColor: string;
    ObsBrowserSourceFontOutlineThickness: number;
    ObsBrowserSourceFontOutlineColor: string;
    // The RVC conversion's block in ms (#531).
    RvcBlockMs: number;

    // ExperimentalFeatures
    ExperimentalFeatures: ExperimentalFeatureValues;
    TrayCompanionEdge: string;
    TrayCompanionMonitor: string;

    // UsagePresets: the ids the user picked; null until the backend answers.
    UsagePresets: string[] | null;
}

export type SettingName = keyof SettingValues;

// One entry of SETTINGS_ARRAY.
export interface SettingDefinition<N extends SettingName = SettingName> {
    Category: SettingCategory;
    Base_Name: N;
    default_value: SettingValues[N];
    ui_template_id: SettingUiTemplateId;
    logics_template_id: SettingLogicsTemplateId;
    add_endpoint_run_array?: readonly SettingRunDirection[];
    base_endpoint_name: string;
    response_transform?: SettingResponseTransform;
}

// Any one entry, its default value checked against its own setting's type.
export type AnySettingDefinition = { [N in SettingName]: SettingDefinition<N> }[SettingName];

// What the backend sends where a response_transform makes the value.
export interface SettingTransformInputs {
    deviceOptionsToObject: readonly DeviceOption[];
    arrayToObject: readonly string[];
    arrayToIdLabel: readonly unknown[];
    // Used by the translation devices only.
    transformToIndexedArray: readonly TranslationComputeDevice[];
}

// The entries as SETTINGS_ARRAY writes them: Category, Base_Name and logics_template_id as literals.
type Entry = (typeof SETTINGS_ARRAY)[number];
type EntryIn<C extends SettingCategory> = Extract<Entry, { Category: C }>;
type EntryWith<C extends SettingCategory, T extends SettingLogicsTemplateId> = Extract<EntryIn<C>, { logics_template_id: T }>;
type ValueOf<E extends Entry> = SettingValues[E["Base_Name"]];
// What the backend sends for the setting: the list a response_transform turns into the value, or the value.
type PayloadOf<E extends Entry> = E extends { response_transform: infer R extends SettingResponseTransform }
    ? SettingTransformInputs[R] : ValueOf<E>;

type Send = () => Promise<StdoutResult>;
// The value the setting's request carries, passed through to the backend as it is.
type SendValue = (value?: unknown) => Promise<StdoutResult>;
type Receive<P> = (payload: P) => void;

type Getters = "get_list" | "get_only" | "get_set" | "get_set_delete" | "toggle_enable_disable";
type Saved = "get_set" | "get_set_delete" | "toggle_enable_disable" | "weight_download_status";

// The fields useSettingsLogics makes for each setting of the category, named after it.
type SettingFields<C extends SettingCategory> =
    & { [E in EntryIn<C> as `current${E["Base_Name"]}`]: AtomState<ValueOf<E>> }
    & { [E in EntryIn<C> as `update${E["Base_Name"]}`]: (payload: AtomPayload<ValueOf<E>>, options?: UpdateOptions) => void }
    & { [E in EntryIn<C> as `updateFromBackend${E["Base_Name"]}`]: Receive<PayloadOf<E>> }
    & { [E in EntryWith<C, Getters> as `get${E["Base_Name"]}`]: Send }
    & { [E in EntryWith<C, "get_set" | "get_set_delete"> as `set${E["Base_Name"]}`]: SendValue }
    & { [E in EntryWith<C, Saved> as `setSuccess${E["Base_Name"]}`]: Receive<PayloadOf<E>> }
    & { [E in EntryWith<C, "get_set_delete"> as `delete${E["Base_Name"]}`]: SendValue }
    & { [E in EntryWith<C, "get_set_delete"> as `deleteSuccess${E["Base_Name"]}`]: Receive<PayloadOf<E>> }
    & { [E in EntryWith<C, "toggle_enable_disable"> as `toggle${E["Base_Name"]}`]: () => void }
    & { [E in EntryWith<C, "weight_download_status"> as `updateDownloadProgress${E["Base_Name"]}`]: Receive<WeightDownloadProgress> }
    & { [E in EntryWith<C, "weight_download_status"> as `updateDownloaded${E["Base_Name"]}`]: Receive<DownloadedWeights> }
    & { [E in EntryWith<C, "weight_download_status"> as `pending${E["Base_Name"]}`]: Receive<string> }
    & { [E in EntryWith<C, "weight_download_status"> as `downloaded${E["Base_Name"]}`]: Receive<WeightDownloaded> }
    // The reviewed consent (legacyModelConsent.ts), sent unchanged.
    & { [E in EntryWith<C, "weight_download_status"> as `download${E["Base_Name"]}`]: Receive<unknown> };

// The functions a category has besides its settings (useConfigFunctions).
export interface VrConfigFunctions {
    sendTextToOverlay: (text: string) => void;
}
export type ConfigFunctions = VrConfigFunctions | Record<never, never>;

// What a category hook (createCategoryHook) returns.
export type CategoryApi<C extends SettingCategory> = SettingFields<C> & (C extends "Vr" ? VrConfigFunctions : unknown);
