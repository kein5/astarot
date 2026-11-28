import { hooks, loadModule } from "./hookHarness.ts";
import type { HookRuntime } from "./hookHarness.ts";
import { loadBridgeSettings, loadBridgeStore } from "./bridgeHarness.ts";
import { createPendingRequestRecovery, featureResyncReads } from "../common/pendingRequestRecovery.ts";
import * as initialization from "../common/initializationFields.ts";
import * as exitExpectation from "../common/sidecarExitExpectation.ts";
import { createSettingsWriteResponses } from "../common/settingsWriteResponses.ts";
import * as fieldErrors from "../configs/fieldErrors.ts";
import * as voiceErrorTextModule from "../voice/voiceErrorText.ts";
import type { ExitExpectingSession } from "../common/sidecarExitExpectation.ts";

// useReceiveRoutes.ts as it runs, with every hook it calls replaced by a recorder: each function a
// hook returns notes its name ("useVoice.updateStatus") and its arguments, so a test reads what the
// routes did with an answer. The routes' own code, the route table and the settings it is made
// from are the real ones.

// A call the routes made to a hook's function, a backend send (useStdoutToPython.asyncStdoutToPython)
// or a language mutation (languageMutations.receiveLanguageMutation).
export interface Call {
    name: string;
    args: unknown[];
}

// The values a hook returns besides its functions, by hook name (useVoice: { settings, status }).
export type HookValues = Record<string, Record<string, unknown>>;

export interface RecorderOptions {
    // Values for the hooks; those given replace the defaults below, which keep every poll idle.
    values?: HookValues;
    // The real settings list (ui_config_setter.ts), which makes most routes; without it, none.
    settings?: boolean;
    // Whether an endpoint is a language mutation (languageMutations.ts).
    isLanguageMutation?: (endpoint: string) => boolean;
    // Whether a translation key exists (i18next's exists).
    exists?: (key: string) => boolean;
    // Hooks to use in place of recorders, by name, loaded on the routes' own hook runtime.
    hooks?: (runtime: HookRuntime) => Promise<Record<string, () => unknown>>;
}

// A translation: the key, and the parameters when there are any.
export const translate = (key: string, params?: Record<string, unknown>) => params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const IDLE: HookValues = {
    useVoice: { settings: null, status: {} },
    useSpeechServers: { state: {}, pending: {} },
    useModelDownloads: { state: { jobs: {} }, hardware: {}, pending: null },
    useVcRuntimes: { state: { jobs: {} }, pending: false },
    useRealtimeASR: { state: {} },
    useVoiceAudition: { audition: { phase: "idle" } },
    useGpuCheck: { check: { phase: "idle" } },
};

// The part of the shared store (store.ts) the routes read and change.
export interface RoutesStore {
    backend_stopped?: boolean;
    backend_subprocess: unknown;
    backend_session: ExitExpectingSession | null;
    expired_speech: number | null;
}

// The phases of a runtime's setup that the routes poll for (useVcRuntimes.ts's activeSetupPhases).
export const ACTIVE_SETUP_PHASES = ["queued", "verifying"];

export const loadRecordedRoutes = async (options: RecorderOptions = {}) => {
    const calls: Call[] = [];
    const values: HookValues = { ...IDLE, ...options.values };
    const record = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); };
    // The same function for the same name on every render, as the hooks' useCallback keeps them.
    const functions = new Map<string, (...args: unknown[]) => void>();
    const recorded = (name: string) => {
        const known = functions.get(name);
        if (known) return known;
        const made = record(name);
        functions.set(name, made);
        return made;
    };
    // What a hook returns: its values, and for any other name a recorded function.
    const recorder = (hook: string): Record<string, unknown> => new Proxy<Record<string, unknown>>({}, {
        get: (_, key) => {
            if (typeof key !== "string") return undefined;
            const own = values[hook];
            return own && key in own ? own[key] : recorded(`${hook}.${key}`);
        },
    });
    const runtime = hooks();
    const real = await options.hooks?.(runtime) ?? {};
    // A module of hooks: its own values, the real hooks given, and for any other name use... a hook
    // that returns a recorder.
    const namespace = (own: Record<string, unknown> = {}) => new Proxy<Record<string | symbol, unknown>>({ __esModule: true, ...own }, {
        get: (target, key) => {
            if (key in target) return target[key];
            if (typeof key !== "string") return undefined;
            if (key in real) return real[key];
            return key.startsWith("use") ? () => recorder(key) : undefined;
        },
    });
    const store: RoutesStore = {
        backend_subprocess: null, backend_session: null, expired_speech: null,
    };
    const settings = options.settings ? (await loadBridgeSettings(await loadBridgeStore())).SETTINGS_ARRAY : [];
    const recovery = createPendingRequestRecovery(), writes = createSettingsWriteResponses();
    const exists = options.exists ?? (() => false);
    const module = await loadModule<typeof import("../useReceiveRoutes.ts")>(new URL("../useReceiveRoutes.ts", import.meta.url), runtime, {
        "@store": { store },
        "@useI18n": { useI18n: () => ({ t: translate, i18n: { exists, getFixedT: (language: string) => (key: string) => `${language}:${key}` } }) },
        "@useStdoutToPython": { useStdoutToPython: () => recorder("useStdoutToPython") },
        "@logics_common": namespace(), "@logics_main": namespace(), "@logics_configs": namespace(),
        "./transcription/useRealtimeASR": namespace(), "./voice/useVirtualMic": namespace(),
        "./voice/useVoiceAudition": namespace(), "./voice/useStopVoice": namespace(),
        "./support/useGpuCheck": namespace(), "./setup/useFirstRunSetup": namespace(),
        "./talk_ai/useTalkAiSession": namespace(),
        "./voice/useVoice": namespace(), "./voice/useSpeechServers": namespace(),
        "./voice/useModelDownloads": namespace(), "./translation/useTranslationCatalog": namespace(),
        "./transcription/useTranscriptionCatalog": namespace(),
        "./voice/useVcRuntimes": namespace({ activeSetupPhases: ACTIVE_SETUP_PHASES }),
        "./flow/useIoFlow": namespace(), "./flow/useGpuMemory": namespace(),
        "./_useBackendErrorHandling": { _useBackendErrorHandling: () => recorder("_useBackendErrorHandling") },
        "./configs/config_page_setter/ui_config_setter": { SETTINGS_ARRAY: settings },
        "./common/pendingRequestRecovery.ts": { pendingRequestRecovery: recovery, featureResyncReads },
        "./common/initializationFields.ts": initialization,
        "./common/sidecarExitExpectation.ts": exitExpectation,
        "./common/settingsWriteResponses.ts": { settingsWriteResponses: writes },
        "./configs/fieldErrors.ts": fieldErrors,
        "./voice/voiceErrorText.ts": voiceErrorTextModule,
        "./main/languageMutations": {
            receiveLanguageMutation: record("languageMutations.receiveLanguageMutation"),
            resetLanguageMutations: record("languageMutations.resetLanguageMutations"),
            isLanguageMutation: options.isLanguageMutation ?? (() => false),
        },
    });
    // Drawn again, as after a hook's values changed: the routes and their effects of this render.
    let routes = runtime.render(module.useReceiveRoutes);
    const render = () => { routes = runtime.render(module.useReceiveRoutes); };
    // The arguments of each call to one function, in order.
    const argsOf = (name: string) => calls.filter(call => call.name === name).map(call => call.args);
    // The names called, in order.
    const names = () => calls.map(call => call.name);
    return { calls, argsOf, names, values, store, recovery, writes, runtime, render, routeTable: module.ROUTE_META_LIST,
        staticRouteTable: module.STATIC_ROUTE_META_LIST,
        receiveRoutes: (message: unknown) => routes.receiveRoutes(message),
        backendStopped: () => routes.backendStopped(),
        // The answer as the backend sends it.
        receive: (endpoint: string, status: number, result?: unknown) => routes.receiveRoutes({ endpoint, status, result }),
        clear: () => { calls.length = 0; } };
};
export type RecordedRoutes = Awaited<ReturnType<typeof loadRecordedRoutes>>;
