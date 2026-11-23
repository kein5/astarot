import assert from "node:assert/strict";
import * as sharedWindow from "../configs/ocrSharedWindow.ts";
import { atom } from "jotai/vanilla";
import type { Atom, PrimitiveAtom, WritableAtom } from "jotai/vanilla";
import type { ReactNode } from "react";
import type { AtomState, NotificationOptions } from "../store.ts";
import type { i18n as I18n } from "i18next";
import { hooks, loadModule } from "./hookHarness.ts";
import type { HookRuntime } from "./hookHarness.ts";
import * as recovery from "../common/pendingRequestRecovery.ts";
import * as initialization from "../common/initializationFields.ts";
import * as exitExpectation from "../common/sidecarExitExpectation.ts";
import * as settingsResponses from "../common/settingsWriteResponses.ts";
import * as meterValue from "../common/meterValue.ts";
import * as utils from "../utils.ts";
import * as virtualMicShapes from "../voice/virtualMic.ts";
import * as voiceAuditionShapes from "../voice/voiceAudition.ts";
import * as stopVoiceShapes from "../voice/stopVoice.ts";
import * as gpuCheckShapes from "../support/gpuCheck.ts";
import * as voiceErrorTextModule from "../voice/voiceErrorText.ts";
import * as translatorLabel from "../main/translatorLabel.ts";

const messageFormat = { message: { prefix: "", suffix: "" }, separator: "\n",
    translation: { prefix: "", separator: "\n", suffix: "" }, translation_first: false };

export const deferred = <T = unknown>() => {
    // The executor runs at once, so both are set before deferred returns.
    let resolve: (value: T) => void = () => {}, reject: (reason?: unknown) => void = () => {};
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
export const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

export const loadBridgeStore = async (runtime: HookRuntime = hooks()) => {
    const subscriptions: Atom<unknown>[] = [];
    const jotai = { atom, getDefaultStore: () => runtime.store,
        useAtomValue: <T>(target: Atom<T>) => { subscriptions.push(target); return runtime.store.get(target); },
        useSetAtom: <T>(target: WritableAtom<T, [T], void>) => (value: T) => runtime.store.set(target, value),
    };
    const stores = await loadModule<typeof import("../store.ts")>(new URL("../store.ts", import.meta.url), runtime, {
        jotai,
        "@ui_configs": {},
        "./common/vrPanelTooltip": { keepNewestVrLayout: (_: unknown, next: unknown) => next },
        "./voice/settingsNavigation": { requestSettingsNavigation: (action: () => unknown) => action() },
        "./common/pendingRequestRecovery.ts": recovery,
        "./common/meterValue.ts": meterValue,
        "./common/initializationFields.ts": initialization,
    });
    return { runtime, stores, jotai, subscriptions };
};

const noop = () => {};
type Stub = Record<string | symbol, unknown>;
// A module of hooks: what it is given, and for any other name a hook (use...) that returns another
// such module, or a function that does nothing.
const stubApi = (values: Record<string, unknown> = {}): Stub => new Proxy<Stub>({ __esModule: true, ...values }, {
    get: (target, key) => key in target ? target[key] : typeof key === "string" && key.startsWith("use") ? () => stubApi() : noop,
});

type BridgeStore = Awaited<ReturnType<typeof loadBridgeStore>>;
interface BridgeOverrides {
    configs?: Record<string, unknown>;
    main?: Record<string, unknown>;
}
// A notice the routes showed: its text (a translation key, or an element such as TranslatedNotice)
// and its options, as useNotificationStatus takes them.
export interface Notice {
    type: "error" | "warning";
    key: ReactNode;
    options: NotificationOptions | undefined;
}

// A notice's text when it is a text, as most are; the test fails there when the notice is missing or
// its text is an element. Reading a missing notice's key stopped with a TypeError before.
export function noticeText(notice: Notice | undefined): string {
    assert.ok(notice, "no notice");
    assert.equal(typeof notice.key, "string", "the notice's text is not a text");
    return typeof notice.key === "string" ? notice.key : "";
}

// A setting's atom in the store's registry, under its Atom_ name. The settings list makes each one
// a primitive atom of the setting's state, which the setting's hook writes; the registry keeps them
// as unknown. This overload is the one place that says so.
export function settingAtom<T = unknown>(registry: Readonly<Record<string, unknown>>, name: string): PrimitiveAtom<AtomState<T>>;
export function settingAtom(registry: Readonly<Record<string, unknown>>, name: string): unknown {
    const target = registry[name];
    if (typeof target !== "object" || target === null) throw new TypeError(`the registry has no ${name}`);
    return target;
}

// The settings list (ui_config_setter.ts) on a bridge store, with its hooks' logic: the settings
// the routes are made from, and the category hooks that take their answers.
export const loadBridgeSettings = async ({ runtime, stores, jotai }: BridgeStore, common: Record<string, unknown> = stubApi()) => {
    const settingsLogics = await loadModule<typeof import("../configs/config_page_setter/useSettingsLogics.ts")>(new URL("../configs/config_page_setter/useSettingsLogics.ts", import.meta.url), runtime, {
        "@store": stores, "@utils": utils, "@logics_common": common,
        "../../voice/saveBar": { setSaveBarEntry: noop },
    });
    return await loadModule<typeof import("../configs/config_page_setter/ui_config_setter.ts")>(new URL("../configs/config_page_setter/ui_config_setter.ts", import.meta.url), runtime, {
        jotai, "@store": stores, "../../common/pendingRequestRecovery.ts": recovery,
        "../../../views/vr/vr_layout.json": {},
        "@ui_configs": { ui_configs: { send_message_format_parts: messageFormat, received_message_format_parts: messageFormat },
            ctranslate2_weight_type_status: [] },
        "./useSettingsLogics": settingsLogics,
    });
};

export const loadBridgeRoutes = async (
    loadCommon: (subject: BridgeStore) => Promise<Record<string, unknown>> = async () => ({}),
    i18n: I18n | null = null, modelDownloads: Record<string, unknown> | null = null, overrides: BridgeOverrides = {},
) => {
    const subject = await loadBridgeStore();
    const { runtime, stores } = subject;
    const notices: Notice[] = [], reads: string[] = [];
    const useI18n = () => i18n ? { t: i18n.t.bind(i18n), i18n } : { t: (key: string) => key, i18n: { exists: () => false } };
    const notification = {
        showNotification_Error: (key: ReactNode, options?: NotificationOptions) => notices.push({ type: "error", key, options }),
        showNotification_Warning: (key: ReactNode, options?: NotificationOptions) => notices.push({ type: "warning", key, options }),
        showNotification_Success: noop, showNotification_SaveSuccess: noop, dismissNotification: noop,
    };
    const common = stubApi({
        useNotificationStatus: () => notification,
        useIsBackendReady: stores.useStore_IsBackendReady,
        useIsSoftwareUpdating: stores.useStore_IsSoftwareUpdating,
        ...await loadCommon(subject),
    });
    const send = async (endpoint: string) => { reads.push(endpoint); return true; };
    const settings = await loadBridgeSettings(subject, common);
    const configs = stubApi({ ...Object.fromEntries([...new Set(settings.SETTINGS_ARRAY.map(setting => setting.Category))]
        .map(category => [`use${category}`, settings.createCategoryHook(category)])),
        ocrStartErrorKey: (code: string) => sharedWindow.startErrorKey(code, runtime.store.get(stores.Atom_OcrSharedWindow).data),
        ...overrides.configs });
    const languages = await loadModule<typeof import("../main/useLanguageSettings.ts")>(new URL("../main/useLanguageSettings.ts", import.meta.url), runtime, {
        "@store": stores, "@ui_configs": { translator_status: [] },
        "./languageMutations": { canChangeLanguageSettings: () => true, createLanguageRequestId: () => "test" },
    });
    const main = stubApi({ ...languages, ...overrides.main });
    const transcriptionConsent = await loadModule<typeof import("../transcription/useTranscriptionConsent.ts")>(new URL("../transcription/useTranscriptionConsent.ts", import.meta.url), runtime);
    const translationSetup = await loadModule<typeof import("../translation/useTranslationSetup.ts")>(new URL("../translation/useTranslationSetup.ts", import.meta.url), runtime);
    const ocrSetup = await loadModule<typeof import("../ocr/useOcrSetup.ts")>(new URL("../ocr/useOcrSetup.ts", import.meta.url), runtime);
    const errors = await loadModule<typeof import("../_useBackendErrorHandling.ts")>(new URL("../_useBackendErrorHandling.ts", import.meta.url), runtime, {
        "@logics_common": common, "@logics_main": main, "@logics_configs": configs,
        "@useI18n": { useI18n },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./ui_configs": { ui_configs: {} }, "./configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "./main/translatorLabel": translatorLabel,
        "./transcription/useTranscriptionConsent": transcriptionConsent,
        "./translation/useTranslationSetup": translationSetup,
        "./ocr/useOcrSetup": ocrSetup,
    });
    const feature = (values: Record<string, unknown>) => stubApi({ send, reset: noop, backendStopped: noop, ...values });
    const voice = { useVoice: () => feature({ settings: null, status: {} }) };
    const speech = { useSpeechServers: () => feature({ state: {}, pending: {} }) };
    const downloads = modelDownloads ?? { useModelDownloads: () => feature({ state: { jobs: {} }, hardware: {}, pending: null }) };
    const realtime = { useRealtimeASR: () => feature({ state: {} }) };
    const runtimes = { activeSetupPhases: [], useVcRuntimes: () => feature({ state: { jobs: {} }, pending: false }) };
    // The real hooks below get their own hook slots, on the same store, so a test can read them
    // without disturbing the routes' render.
    const localRuntime = hooks();
    localRuntime.store = runtime.store;
    const virtualMic = await loadModule<typeof import("../voice/useVirtualMic.ts")>(new URL("../voice/useVirtualMic.ts", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./virtualMic.ts": virtualMicShapes,
    });
    const firstRunSetup = await loadModule<typeof import("../setup/useFirstRunSetup.ts")>(new URL("../setup/useFirstRunSetup.ts", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
    });
    // The voice audition (#415): the real hook, which sends what the cards press.
    const sent: [string, unknown][] = [];
    const voiceAudition = await loadModule<typeof import("../voice/useVoiceAudition.ts")>(new URL("../voice/useVoiceAudition.ts", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string, data?: unknown) => { sent.push([endpoint, data]); return true; } }) },
        "./voiceAudition.ts": voiceAuditionShapes,
    });
    // The top bar's stop (#937): the real hook, which sends the press and takes its answer.
    const stopVoice = await loadModule<typeof import("../voice/useStopVoice.ts")>(new URL("../voice/useStopVoice.ts", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./stopVoice.ts": stopVoiceShapes,
    });
    // The GPU check (#288): the real hook.
    const gpuCheck = await loadModule<typeof import("../support/useGpuCheck.ts")>(new URL("../support/useGpuCheck.ts", import.meta.url), localRuntime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
        "./gpuCheck.ts": gpuCheckShapes,
    });
    const routes = await loadModule<typeof import("../useReceiveRoutes.ts")>(new URL("../useReceiveRoutes.ts", import.meta.url), runtime, {
        "@useI18n": { useI18n },
        "./voice/voiceErrorText.ts": voiceErrorTextModule,
        "@store": stores, "@logics_common": common, "@logics_main": main, "@logics_configs": configs,
        "./transcription/useRealtimeASR": realtime, "./voice/useVirtualMic": virtualMic, "./voice/useVoice": voice,
        "./setup/useFirstRunSetup": firstRunSetup, "./voice/useVoiceAudition": voiceAudition, "./support/useGpuCheck": gpuCheck,
        "./voice/useStopVoice": stopVoice,
        "./voice/useSpeechServers": speech, "./voice/useModelDownloads": downloads, "./voice/useVcRuntimes": runtimes,
        "./translation/useTranslationCatalog": { useTranslationCatalog: () => feature({ catalog: null, pending: null, fail: noop }) },
        "./transcription/useTranscriptionCatalog": { useTranscriptionCatalog: () => feature({ catalog: null, pending: null, fail: noop }) },
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
    return { ...subject, notices, reads, routeTable: routes.ROUTE_META_LIST, virtualMic: () => localRuntime.render(virtualMic.useVirtualMic),
        firstRunSetup: () => localRuntime.render(firstRunSetup.useFirstRunSetup),
        voiceAudition: () => localRuntime.render(voiceAudition.useVoiceAudition), auditionSent: sent,
        stopVoice: () => localRuntime.render(stopVoice.useStopVoice),
        gpuCheck: () => localRuntime.render(gpuCheck.useGpuCheck),
        ocrSetup: () => runtime.render(ocrSetup.useOcrSetup), translationSetup: () => runtime.render(translationSetup.useTranslationSetup),
        ...runtime.render(routes.useReceiveRoutes) };
};
