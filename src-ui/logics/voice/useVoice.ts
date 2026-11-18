import { atom, useAtom, useStore } from "jotai";
import type { PrimitiveAtom } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import type { StdoutResult } from "@useStdoutToPython";
import { pendingAfterVoiceFailure, stoppedVoiceStatus, stoppedDirectState } from "./pendingVoiceRequest.ts";
import type { PendingVoiceRequest } from "./pendingVoiceRequest.ts";
import { newerRoute, newerDirectState } from "./routeState";
import type { RouteSnapshot } from "./routeState";
import { acceptObservation, resetObservations } from "../common/polledState.ts";

// The voice replies of the core (native/core/src/controller/voice), as far as this hook reads
// them. They are not checked here; the settings pages read the other fields.

// /get/data/voice_settings.
export interface VoiceSettings {
    readonly [key: string]: unknown;
}

// /get/data/voice_status, polled. tts_generation counts the changes of the TTS switch.
export interface VoiceStatus extends RouteSnapshot {
    tts_generation?: number;
    tts_enabled?: unknown;
    tts_server_starting?: unknown;
}

// /get/data/direct_voice_state, polled. generation counts the changes of direct voice.
export interface DirectVoiceState extends RouteSnapshot {
    generation?: number;
    mode?: unknown;
    requested?: unknown;
    pending?: unknown;
    stopping?: unknown;
    error?: unknown;
    settings?: { readonly engine?: unknown; readonly [key: string]: unknown } | null;
}

// /get/data/voice_output_devices.
export interface VoiceOutputDevices {
    readonly devices: readonly unknown[];
    readonly error: unknown;
    readonly [key: string]: unknown;
}

// An input of direct voice. The four fields together name it; refreshing keeps them.
export interface VoiceSource {
    readonly cookie?: unknown;
    readonly serial?: unknown;
    readonly name?: unknown;
    readonly media_class?: unknown;
    readonly [key: string]: unknown;
}

// /get/data/direct_voice_sources: the inputs, and the microphone chosen on the Device page.
export interface DirectVoiceSources {
    readonly sources: readonly VoiceSource[];
    readonly error: unknown;
    readonly preferred?: VoiceSource | null;
    readonly [key: string]: unknown;
}

export type VoiceModelRole = "japanese" | "multilingual";

// /get/data/tts_model_options for one role, or the request still waiting for it (options null).
export interface ModelOptions {
    readonly request_id?: string;
    readonly role?: unknown;
    readonly options?: unknown;
    readonly [key: string]: unknown;
}

// /get/data/tts_engine_voices: the check of an installed speech engine (ADR-008).
export interface EngineVoices {
    readonly request_id?: string;
    readonly engine?: string;
    readonly pending?: boolean;
    readonly voices?: unknown;
    readonly connected?: unknown;
    readonly version?: unknown;
    readonly error_code?: unknown;
    readonly [key: string]: unknown;
}

// One check of the model catalog, kept per engine.
export interface EngineCheck {
    readonly request_id: string;
    readonly pending: boolean;
    readonly connected?: boolean;
    readonly version?: unknown;
    readonly error_code?: unknown;
}

// What the settings pages send with a request, as far as it is read here.
export interface VoiceRequestData {
    readonly role?: string;
    readonly engine?: string;
    readonly url?: unknown;
    readonly catalog?: unknown;
    readonly mode?: unknown;
    readonly options?: { readonly engine?: unknown } | null;
    readonly request_id?: string;
    readonly [key: string]: unknown;
}

// A switch request waiting for its answer: the generation it was sent at, and for direct
// voice the input that produces the voice.
type VoiceRequest = PendingVoiceRequest & { generation: number; owner?: unknown };

const settingsAtom = atom<VoiceSettings | null>(null), statusAtom = atom<VoiceStatus>({}), routeAtom = atom<RouteSnapshot>({});
const devicesAtom = atom<VoiceOutputDevices>({ devices: [], error: null }), errorAtom = atom<string | null>(null);
const directStateAtom = atom<DirectVoiceState>({}), directSourcesAtom = atom<DirectVoiceSources>({ sources: [], error: null }), directErrorAtom = atom<string | null>(null);
const selectedSourceAtom = atom(""), preferredSourceAtom = atom("");
const modelOptionsAtom = atom<Partial<Record<string, ModelOptions>>>({});
let optionsSequence = 0;
// The last check of an installed speech engine (ADR-008): pending until its answer arrives.
const engineVoicesAtom = atom<EngineVoices | null>(null);
let engineSequence = 0;
// The model catalog's own checks, one per engine, with the saved URL. They never replace the
// check of the engine being edited above, so the two places can be open together.
const engineChecksAtom = atom<Partial<Record<string, EngineCheck>>>({});
const CATALOG_CHECK = "catalog-";
const ttsPendingAtom = atom<VoiceRequest | null>(null), directPendingAtom = atom<VoiceRequest | null>(null), ttsErrorAtom = atom<string | null>(null);
// Keep the last producer through stopping/health failure, where backend mode is already off.
const directOwnerAtom = atom<unknown>(null);
const directDraftBlockedAtom = atom(false);
const inputOwner = (mode: unknown, engine: unknown): unknown => mode === "converted" ? engine || "rvc" : "passthrough";
const isModelRole = (role: unknown): role is VoiceModelRole => role === "japanese" || role === "multilingual";
// Keep the complete backend identity. Refresh never rebinds a selected name.
export const sourceKey = (id: VoiceSource) => JSON.stringify([id.cookie, id.serial, id.name, id.media_class]);

export const useVoice = () => {
    const atoms = useStore();
    const [modelOptions] = useAtom(modelOptionsAtom);
    const updateModelOptions = useCallback((value: ModelOptions | null | undefined) => {
        const previous = atoms.get(modelOptionsAtom);
        if (!value || !isModelRole(value.role) || previous[value.role]?.request_id !== value.request_id) return;
        atoms.set(modelOptionsAtom, { ...previous, [value.role]: value });
    }, [atoms]);
    const [engineVoices] = useAtom(engineVoicesAtom);
    // Only the answer to the newest check counts; an older one may be for another engine or URL.
    const updateEngineVoices = useCallback((value: EngineVoices | null | undefined) => {
        if (value?.request_id?.startsWith(CATALOG_CHECK)) {
            const checks = atoms.get(engineChecksAtom), engine = `${value.engine}`;
            if (checks[engine]?.request_id === value.request_id)
                atoms.set(engineChecksAtom, { ...checks, [engine]: { request_id: value.request_id, pending: false,
                    connected: !!value.connected, version: value.version ?? null, error_code: value.error_code ?? null } });
            return;
        }
        if (value && atoms.get(engineVoicesAtom)?.request_id === value.request_id) atoms.set(engineVoicesAtom, value);
    }, [atoms]);
    const [engineChecks] = useAtom(engineChecksAtom);
    const [settings, setSettings] = useAtom(settingsAtom);
    const [status] = useAtom(statusAtom);
    const [route] = useAtom(routeAtom);
    const [devices, updateDevices] = useAtom(devicesAtom);
    const [error, updateError] = useAtom(errorAtom);
    const [directState] = useAtom(directStateAtom);
    const [directOwner] = useAtom(directOwnerAtom);
    const [directDraftBlocked, setDirectDraftBlocked] = useAtom(directDraftBlockedAtom);
    const [directSources] = useAtom(directSourcesAtom);
    const [directError] = useAtom(directErrorAtom);
    const [selectedSource, setSelectedSource] = useAtom(selectedSourceAtom);
    const [ttsPending] = useAtom(ttsPendingAtom), [directPending] = useAtom(directPendingAtom), [ttsError] = useAtom(ttsErrorAtom);
    const updateTtsError = useCallback((value: string | null, endpoint?: string, status?: number) => {
        // OFF while a bundled server was starting cancels that ON; nothing to report.
        if (value === "tts_enable_cancelled") return;
        atoms.set(ttsErrorAtom, value);
        if (endpoint !== undefined && status !== undefined && [404, 423, 500].includes(status))
            atoms.set(ttsPendingAtom, pending => pendingAfterVoiceFailure(pending, endpoint) ?? null);
        if (value && endpoint === "/run/enable_tts" && atoms.get(ttsPendingAtom)?.intent)
            atoms.set(ttsPendingAtom, null);
    }, [atoms]);
    const updateDirectError = useCallback((value: string | null, endpoint?: string, status?: number) => {
        atoms.set(directErrorAtom, value);
        if (endpoint !== undefined && status !== undefined && [404, 423, 500].includes(status))
            atoms.set(directPendingAtom, pending => pendingAfterVoiceFailure(pending, endpoint) ?? null);
        if (value && endpoint === "/run/start_direct_voice" && atoms.get(directPendingAtom)?.intent)
            atoms.set(directPendingAtom, null);
    }, [atoms]);
    // The Device page Mic choice (backend `preferred`) is the default input. Follow it
    // until another input is picked here; never retarget an input that is running.
    const updateDirectSources = useCallback((value: DirectVoiceSources) => {
        atoms.set(directSourcesAtom, value);
        const next = value?.preferred ? sourceKey(value.preferred) : "", state = atoms.get(directStateAtom);
        if (!next || atoms.get(directPendingAtom) || state.requested || state.pending || state.stopping) return;
        const selected = atoms.get(selectedSourceAtom);
        if (selected === "" || selected === atoms.get(preferredSourceAtom)) atoms.set(selectedSourceAtom, next);
        atoms.set(preferredSourceAtom, next);
    }, [atoms]);
    const updateSettings = useCallback((value: VoiceSettings | null) => { setSettings(value); updateError(null); }, [setSettings, updateError]);
    const updateStatus = useCallback((value: VoiceStatus | null | undefined) => {
        const previous = atoms.get(statusAtom), generation = value?.tts_generation;
        if (!value || (previous.tts_generation != null && generation !== undefined && generation < previous.tts_generation) ||
            !acceptObservation(atoms, statusAtom, value)) return;
        atoms.set(statusAtom, newerRoute(previous, value));
        const waiting = atoms.get(ttsPendingAtom);
        if (waiting && generation !== undefined && generation > waiting.generation && value.tts_enabled === waiting.intent) {
            atoms.set(ttsPendingAtom, null);
            const reported = atoms.get(ttsErrorAtom);
            if (reported === "voice_request_unconfirmed" || reported === "backend_unavailable") atoms.set(ttsErrorAtom, null);
        }
    }, [atoms]);
    const updateRoute = useCallback((value: RouteSnapshot | null | undefined) => {
        if (acceptObservation(atoms, routeAtom, value)) atoms.set(routeAtom, previous => newerRoute(previous, value));
    }, [atoms]);
    const updateDirectState = useCallback((value: DirectVoiceState | null | undefined) => {
        if (!value || !acceptObservation(atoms, directStateAtom, value)) return;
        const previous = atoms.get(directStateAtom), next = newerDirectState(previous, value);
        atoms.set(directStateAtom, next);
        if (value.mode && value.mode !== "off")
            atoms.set(directOwnerAtom, inputOwner(value.mode, value.settings?.engine));
        const waiting = atoms.get(directPendingAtom), generation = value.generation;
        if (waiting && generation !== undefined && generation > waiting.generation &&
            ((!!value.requested === waiting.intent && (waiting.intent || (!value.pending && !value.stopping))) ||
             (waiting.intent && value.error))) {
            atoms.set(directPendingAtom, null);
            const reported = atoms.get(directErrorAtom);
            if (reported === "voice_request_unconfirmed" || reported === "backend_unavailable") atoms.set(directErrorAtom, null);
        }
    }, [atoms]);
    const { asyncStdoutToPython } = useStdoutToPython();
    const send = useCallback(async (endpoint: string, data?: VoiceRequestData): Promise<StdoutResult> => {
        if (endpoint === "/get/data/tts_model_options") {
            const request_id = `ui-${Date.now()}-${++optionsSequence}`;
            data = { ...data, request_id };
            atoms.set(modelOptionsAtom, { ...atoms.get(modelOptionsAtom), [`${data.role}`]: { request_id, options: null } });
        }
        if (endpoint === "/get/data/tts_engine_voices" && data?.catalog) {
            const request_id = `${CATALOG_CHECK}${Date.now()}-${++engineSequence}`;
            data = { engine: data.engine, url: data.url, request_id };
            atoms.set(engineChecksAtom, { ...atoms.get(engineChecksAtom), [`${data.engine}`]: { request_id, pending: true } });
        } else if (endpoint === "/get/data/tts_engine_voices") {
            const request_id = `ui-${Date.now()}-${++engineSequence}`;
            data = { ...data, request_id };
            atoms.set(engineVoicesAtom, { request_id, engine: data.engine, pending: true, voices: [] });
        }
        const ttsCommand = ["/run/enable_tts", "/run/disable_tts"].includes(endpoint);
        const directCommand = ["/run/start_direct_voice", "/run/stop_direct_voice"].includes(endpoint);
        const direct = endpoint.includes("direct_voice");
        const report: (value: string | null) => void = ttsCommand ? updateTtsError : direct ? updateDirectError : updateError;
        let pendingTarget: PrimitiveAtom<VoiceRequest | null> | undefined, pendingRequest: VoiceRequest | undefined;
        if (ttsCommand || directCommand) {
            report(null);
            const target = ttsCommand ? ttsPendingAtom : directPendingAtom;
            const request: VoiceRequest = { intent: endpoint === "/run/enable_tts" || endpoint === "/run/start_direct_voice",
                generation: (ttsCommand ? atoms.get(statusAtom).tts_generation : atoms.get(directStateAtom).generation) ?? -1 };
            if (directCommand) {
                request.owner = request.intent ? inputOwner(data?.mode, data?.options?.engine) : atoms.get(directOwnerAtom);
                atoms.set(directOwnerAtom, request.owner);
            }
            pendingTarget = target;
            pendingRequest = request;
            atoms.set(target, request);
            const confirm = () => {
                if (atoms.get(target) !== request) return;
                // ON may be loading a bundled server's model, which takes longer than 5 s.
                if (ttsCommand && request.intent && atoms.get(statusAtom).tts_server_starting === true) {
                    setTimeout(confirm, 1000);
                    return;
                }
                report("voice_request_unconfirmed");
            };
            setTimeout(confirm, 5000);
        } else if (endpoint.startsWith("/set/") || endpoint === "/run/mute_voice" || endpoint === "/run/resume_voice") report(null);
        const ok = await asyncStdoutToPython(endpoint, data);
        if (ok === false) {
            // A delayed transport failure must not clear a newer command's owner.
            if (pendingTarget && atoms.get(pendingTarget) === pendingRequest) atoms.set(pendingTarget, null);
            const engineVoices = atoms.get(engineVoicesAtom);
            if (data?.request_id && engineVoices?.request_id === data.request_id)
                atoms.set(engineVoicesAtom, { ...engineVoices, pending: false, connected: false, error_code: "backend_unavailable" });
            const checks = atoms.get(engineChecksAtom), engine = `${data?.engine}`;
            if (data?.request_id && checks[engine]?.request_id === data.request_id)
                atoms.set(engineChecksAtom, { ...checks, [engine]: { request_id: data.request_id, pending: false, connected: false, error_code: "backend_unavailable" } });
            report("backend_unavailable");
        }
        return ok;
    }, [atoms, updateError, updateTtsError, updateDirectError]);
    const backendStopped = useCallback(() => {
        atoms.set(ttsPendingAtom, null); atoms.set(directPendingAtom, null);
        atoms.set(statusAtom, stoppedVoiceStatus);
        atoms.set(directStateAtom, stoppedDirectState);
        atoms.set(routeAtom, value => ({ ...value, pending: false }));
        for (const target of [errorAtom, directErrorAtom, ttsErrorAtom]) atoms.set(target, "backend_unavailable");
    }, [atoms]);
    const reset = useCallback(() => {
        resetObservations(atoms, [statusAtom, routeAtom, directStateAtom]);
        atoms.set(modelOptionsAtom, {}); atoms.set(engineVoicesAtom, null); atoms.set(engineChecksAtom, {});
        atoms.set(settingsAtom, null); atoms.set(statusAtom, {}); atoms.set(routeAtom, {}); atoms.set(directStateAtom, {});
        atoms.set(selectedSourceAtom, ""); atoms.set(preferredSourceAtom, ""); atoms.set(directSourcesAtom, { sources: [], error: null });
        atoms.set(directOwnerAtom, null); atoms.set(directDraftBlockedAtom, false);
        for (const target of [errorAtom, directErrorAtom, ttsErrorAtom]) atoms.set(target, null);
        for (const target of [ttsPendingAtom, directPendingAtom]) atoms.set(target, null);
    }, [atoms]);
    return { settings, status, route, devices, error, send, reset, backendStopped, modelOptions, updateModelOptions, engineVoices, updateEngineVoices, engineChecks, selectedSource, setSelectedSource,
        ttsPending, directPending, ttsError, updateTtsError, updateStatus, updateRoute, updateDevices, updateError,
        directState, directOwner, directDraftBlocked, setDirectDraftBlocked,
        directSources, directError, updateDirectState, updateDirectSources, updateDirectError, updateSettings };
};
