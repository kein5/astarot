import * as legacyModelConsent from "../configs/legacyModelConsent.ts";
import * as sharedWindow from "../configs/ocrSharedWindow.ts";
import { atom } from "jotai/vanilla";
import { hooks, loadModule } from "./hookHarness.js";
import * as recovery from "../common/pendingRequestRecovery.ts";
import * as initialization from "../common/initializationFields.ts";
import * as exitExpectation from "../common/sidecarExitExpectation.ts";
import * as settingsResponses from "../common/settingsWriteResponses.ts";
import * as meterValue from "../common/meterValue.ts";
import * as utils from "../utils.ts";
import * as localAsrMigration from "../transcription/localAsrMigration.ts";
import * as virtualMicShapes from "../voice/virtualMic.ts";
import * as voiceErrorTextModule from "../voice/voiceErrorText.ts";

const messageFormat = { message: { prefix: "", suffix: "" }, separator: "\n",
    translation: { prefix: "", separator: "\n", suffix: "" }, translation_first: false };

export const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
export const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

export const loadBridgeStore = async (runtime = hooks()) => {
    const subscriptions = [];
    const jotai = { atom, getDefaultStore: () => runtime.store,
        useAtomValue: target => { subscriptions.push(target); return runtime.store.get(target); },
        useSetAtom: target => value => runtime.store.set(target, value),
    };
    const stores = await loadModule(new URL("../store.ts", import.meta.url), runtime, {
        jotai,
        "./_test_data.ts": {}, "@ui_configs": {},
        "./common/vrPanelTooltip": { keepNewestVrLayout: (_, next) => next },
        "./voice/settingsNavigation": { requestSettingsNavigation: action => action() },
        "./common/pendingRequestRecovery.ts": recovery,
        "./common/meterValue.ts": meterValue,
        "./common/initializationFields.ts": initialization,
    });
    return { runtime, stores, jotai, subscriptions };
};

const noop = () => {};
const stubApi = (values = {}) => new Proxy({ __esModule: true, ...values }, {
    get: (target, key) => key in target ? target[key] : typeof key === "string" && key.startsWith("use") ? () => stubApi() : noop,
});

export const loadBridgeRoutes = async (loadCommon = async () => ({}), i18n = null, modelDownloads = null, overrides = {}) => {
    const subject = await loadBridgeStore();
    const { runtime, stores, jotai } = subject;
    const notices = [], reads = [];
    const notification = {
        showNotification_Error: (key, options) => notices.push({ type: "error", key, options }),
        showNotification_Warning: (key, options) => notices.push({ type: "warning", key, options }),
        showNotification_Success: noop, showNotification_SaveSuccess: noop, dismissNotification: noop,
    };
    const common = stubApi({
        useNotificationStatus: () => notification,
        useIsBackendReady: stores.useStore_IsBackendReady,
        useIsSoftwareUpdating: stores.useStore_IsSoftwareUpdating,
        ...await loadCommon(subject),
    });
    const send = async endpoint => { reads.push(endpoint); return true; };
    const settingsLogics = await loadModule(new URL("../configs/config_page_setter/useSettingsLogics.js", import.meta.url), runtime, {
        "@store": stores, "@utils": utils, "@logics_common": common,
        "../../voice/saveBar": { setSaveBarEntry: noop },
    });
    const settings = await loadModule(new URL("../configs/config_page_setter/ui_config_setter.js", import.meta.url), runtime, {
        jotai, "@store": stores, "../../common/pendingRequestRecovery.ts": recovery,
        "../../../views/vr/vr_layout.json": {},
        "@ui_configs": { ui_configs: { send_message_format_parts: messageFormat, received_message_format_parts: messageFormat },
            ctranslate2_weight_type_status: [] },
        "./useSettingsLogics": settingsLogics,
    });
    const configs = stubApi({ ...Object.fromEntries([...new Set(settings.SETTINGS_ARRAY.map(setting => setting.Category))]
        .map(category => [`use${category}`, settings.createCategoryHook(category)])),
        ocrStartErrorKey: code => sharedWindow.startErrorKey(code, runtime.store.get(stores.Atom_OcrSharedWindow).data),
        ...overrides.configs });
    const languages = await loadModule(new URL("../main/useLanguageSettings.js", import.meta.url), runtime, {
        "@store": stores, "@ui_configs": { translator_status: [] },
        "./languageMutations": { canChangeLanguageSettings: () => true, createLanguageRequestId: () => "test" },
    });
    const main = stubApi({ ...languages, ...overrides.main });
    const transcriptionConsent = await loadModule(new URL("../transcription/useTranscriptionConsent.ts", import.meta.url), runtime);
    const translationSetup = await loadModule(new URL("../translation/useTranslationSetup.ts", import.meta.url), runtime);
    const ocrSetup = await loadModule(new URL("../ocr/useOcrSetup.ts", import.meta.url), runtime);
    const errors = await loadModule(new URL("../_useBackendErrorHandling.js", import.meta.url), runtime, {
        "@logics_common": common, "@logics_main": main, "@logics_configs": configs,
        "@useI18n": { useI18n: () => i18n ? { t: i18n.t.bind(i18n), i18n } : { t: key => key, i18n: { exists: () => false } } },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./ui_configs": { ui_configs: {} }, "./configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "./configs/legacyModelConsent": legacyModelConsent,
        "./transcription/useTranscriptionConsent": transcriptionConsent,
        "./translation/useTranslationSetup": translationSetup,
        "./ocr/useOcrSetup": ocrSetup,
    });
    const feature = values => stubApi({ send, reset: noop, backendStopped: noop, ...values });
    const voice = { useVoice: () => feature({ settings: null, status: {} }) };
    const speech = { useSpeechServers: () => feature({ state: {}, pending: {} }) };
    const downloads = modelDownloads ?? { useModelDownloads: () => feature({ state: { jobs: {} }, hardware: {}, pending: null }) };
    const realtime = { useRealtimeASR: () => feature({ state: {} }) };
    const runtimes = { activeSetupPhases: [], useVcRuntimes: () => feature({ state: { jobs: {} }, pending: false }) };
    // The real hook: its routes are the notice and the old Whisper weights (#288). Its own
    // hook slots, on the same store, so a test can read it without disturbing the routes' render.
    const localRuntime = hooks();
    localRuntime.store = runtime.store;
    const localAsr = await loadModule(new URL("../transcription/useLocalAsrMigration.js", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./localAsrMigration.ts": localAsrMigration,
    });
    const virtualMic = await loadModule(new URL("../voice/useVirtualMic.js", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./virtualMic.ts": virtualMicShapes,
    });
    const firstRunSetup = await loadModule(new URL("../setup/useFirstRunSetup.js", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
    });
    const routes = await loadModule(new URL("../useReceiveRoutes.js", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => i18n ? { t: i18n.t.bind(i18n), i18n } : { t: key => key, i18n: { exists: () => false } } },
        "./voice/voiceErrorText.ts": voiceErrorTextModule,
        "@store": stores, "@logics_common": common, "@logics_main": main, "@logics_configs": configs,
        "./transcription/useRealtimeASR": realtime, "./transcription/useLocalAsrMigration": localAsr, "./voice/useVirtualMic": virtualMic, "./voice/useVoice": voice,
        "./setup/useFirstRunSetup": firstRunSetup,
        "./voice/useSpeechServers": speech, "./voice/useModelDownloads": downloads, "./voice/useVcRuntimes": runtimes,
        "./translation/useTranslationCatalog": { useTranslationCatalog: () => feature({ catalog: null, pending: null, fail: noop }) },
        "./flow/useIoFlow": { useIoFlow: () => feature({}) },
        "./flow/useGpuMemory": { useGpuMemory: () => feature({}) },
        "./_useBackendErrorHandling": errors,
        "./configs/config_page_setter/ui_config_setter": settings,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./common/pendingRequestRecovery.ts": recovery,
        "./common/initializationFields.ts": initialization,
        "./common/sidecarExitExpectation.ts": exitExpectation,
        "./common/settingsWriteResponses.ts": settingsResponses,
        "./main/languageMutations": { receiveLanguageMutation: noop, resetLanguageMutations: noop, isLanguageMutation: () => false },
    });
    return { ...subject, notices, reads, localAsr: () => localRuntime.render(localAsr.useLocalAsrMigration), virtualMic: () => localRuntime.render(virtualMic.useVirtualMic),
        firstRunSetup: () => localRuntime.render(firstRunSetup.useFirstRunSetup),
        ocrSetup: () => runtime.render(ocrSetup.useOcrSetup), translationSetup: () => runtime.render(translationSetup.useTranslationSetup),
        ...runtime.render(routes.useReceiveRoutes) };
};
