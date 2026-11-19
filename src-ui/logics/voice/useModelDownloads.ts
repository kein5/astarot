import { atom, useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { acceptObservation, resetObservations, sameSnapshot } from "../common/polledState.ts";
import type { ObservedSnapshot } from "../common/polledState.ts";

// The model download replies of the core (docs/voice-stack/model-downloads.md), as far as this
// hook reads them. They are not checked here; the pages read the other fields.

// /get/data/model_download_catalog.
export interface ModelDownloadCatalog {
    readonly [key: string]: unknown;
}

// One download: phase is "queued", "downloading", "verifying", "cancelling", "ready", "failed" and so on.
// The fields the first-run setup reads too (DownloadJob in setup/firstRunSetup.ts).
export interface ModelDownloadJob {
    readonly job_id?: string;
    readonly phase?: string;
    readonly error_code?: string | null;
    readonly received_bytes?: number;
    readonly total_bytes?: number;
    readonly [key: string]: unknown;
}

// /get/data/model_download_state, polled.
export interface ModelDownloadState extends ObservedSnapshot {
    readonly jobs: Readonly<Record<string, ModelDownloadJob>>;
    readonly [key: string]: unknown;
}

// /get/data/model_download_hardware: phase is "unknown" until asked, then "probing", and so on.
export interface ModelDownloadHardware extends ObservedSnapshot {
    readonly phase: string;
    readonly devices: readonly unknown[];
    readonly error_code?: unknown;
    readonly [key: string]: unknown;
}

// The models the user registered under a name (#403), as the backend sends them.
export interface UserModels {
    readonly models: readonly unknown[];
    readonly [key: string]: unknown;
}

// What a page sends with a request, as far as it is read here: the model and its download.
export interface ModelDownloadRequestData {
    readonly id?: unknown;
    readonly job_id?: unknown;
    readonly [key: string]: unknown;
}

// A command waiting for its answer.
export interface PendingModelRequest {
    readonly endpoint: string;
    readonly id: unknown;
    readonly job_id: unknown;
}

const catalogAtom = atom<ModelDownloadCatalog | null>(null), stateAtom = atom<ModelDownloadState>({ observation_id: "0", jobs: {} });
const errorAtom = atom<string | null>(null), pendingAtom = atom<PendingModelRequest[] | null>(null);
const hardwareAtom = atom<ModelDownloadHardware>({ phase: 'unknown', devices: [], observation_id: '0' });
// The models the user registered under a name (#403): {models: [...]} as the backend sends it,
// null until the first answer.
const userModelsAtom = atom<UserModels | null>(null);

const hasDevices = (value: ModelDownloadHardware | null | undefined): value is ModelDownloadHardware => Array.isArray(value?.devices);
const hasModels = (value: UserModels | null | undefined): value is UserModels => Array.isArray(value?.models);

// Apply requests whose reply did not come in time (#563). Each is let go once a later state
// shows its job no longer verifying: the job was applied, failed or cancelled, or never left
// "ready", so a new command cannot overlap it. Without this, a lost reply kept every other
// download command blocked until a restart.
const overdueApplies = new WeakSet<PendingModelRequest>();
const APPLYING: readonly unknown[] = ["verifying", "cancelling"];
const stillApplying = (request: PendingModelRequest, jobs: ModelDownloadState["jobs"]): boolean => {
    const job = typeof request.id === "string" ? jobs[request.id] : undefined;
    return job !== undefined && job.job_id === request.job_id && APPLYING.includes(job.phase);
};

export const useModelDownloads = () => {
    const store = useStore();
    const [catalog, setCatalog] = useAtom(catalogAtom), [state] = useAtom(stateAtom);
    const [error, setError] = useAtom(errorAtom), [pending, setPending] = useAtom(pendingAtom);
    const [hardware] = useAtom(hardwareAtom);
    const [userModels] = useAtom(userModelsAtom);
    const { asyncStdoutToPython } = useStdoutToPython();
    const transport = useRef(asyncStdoutToPython);
    transport.current = asyncStdoutToPython;
    const updateCatalog = useCallback((value: ModelDownloadCatalog | null) => setCatalog(value), [setCatalog]);
    const updateHardware = useCallback((value: ModelDownloadHardware | null | undefined) => {
        if (!hasDevices(value) || !acceptObservation(store, hardwareAtom, value)) return;
        store.set(hardwareAtom, previous => sameSnapshot(previous, value) ? previous : value);
    }, [store]);
    const updateState = useCallback((value: ModelDownloadState | null | undefined) => {
        if (!value?.jobs || !acceptObservation(store, stateAtom, value)) return false;
        store.set(stateAtom, previous => sameSnapshot(previous, value) ? previous : value);
        const pending = store.get(pendingAtom);
        if (pending?.some(request => overdueApplies.has(request) && !stillApplying(request, value.jobs))) {
            const remaining = pending.filter(request => !overdueApplies.has(request) || stillApplying(request, value.jobs));
            store.set(pendingAtom, remaining.length ? remaining : null);
        }
        return true;
    }, [store]);
    const settle = useCallback((endpoint: string) => {
        setPending(previous => {
            if (!previous?.some(request => request.endpoint === endpoint)) return previous;
            const remaining = previous?.filter(request => request.endpoint !== endpoint);
            return remaining?.length ? remaining : null;
        });
    }, [setPending]);
    const acknowledge = useCallback((value: ModelDownloadState | null | undefined, endpoint: string) => {
        // A poll can overtake the command response; it must not roll back state.
        updateState(value);
        settle(endpoint);
        setError(previous => previous === "request_unconfirmed" ? null : previous);
    }, [updateState, settle, setError]);
    const updateUserModels = useCallback((value: UserModels | null | undefined) => {
        if (hasModels(value)) store.set(userModelsAtom, value);
    }, [store]);
    // The answer to a registration, a removal or a switch: the list as it is now.
    const acknowledgeUserModels = useCallback((value: UserModels | null | undefined, endpoint: string) => {
        updateUserModels(value);
        settle(endpoint);
        setError(previous => previous === "request_unconfirmed" ? null : previous);
    }, [updateUserModels, settle, setError]);
    const updateError = useCallback((value: string | null, endpoint = "") => {
        setError(value); settle(endpoint);
        if (value && endpoint.includes("model_download_hardware"))
            store.set(hardwareAtom, previous => ({ ...previous, phase: "failed", error_code: value }));
    }, [store, setError, settle]);
    // No reply in time (#431): say so, and release the commands whose effect the state poll
    // shows anyway (start, cancel, the user's models), so the buttons work again. A pending
    // Apply stays while the polls show its job verifying (that can take this long, and its
    // Cancel is still allowed meanwhile); the next poll that shows it done releases it (#563).
    const expireUnconfirmed = useCallback(() => {
        setError("request_unconfirmed");
        setPending(previous => {
            const remaining = previous?.filter(request => request.endpoint === "/run/apply_model_download");
            remaining?.forEach(request => overdueApplies.add(request));
            return remaining?.length ? remaining : null;
        });
    }, [setError, setPending]);
    const backendStopped = useCallback(() => {
        updateError("backend_unavailable");
        store.set(pendingAtom, null);
        store.set(stateAtom, value => ({ ...value, jobs: Object.fromEntries(Object.entries(value.jobs).map(([id, job]) =>
            [id, ["queued", "downloading", "verifying", "cancelling"].some(phase => phase === job.phase)
                ? { ...job, phase: "failed", error_code: "backend_unavailable" } : job])) }));
        store.set(hardwareAtom, value => value.phase === "probing" ? { ...value, phase: "failed", error_code: "backend_unavailable" } : value);
    }, [store, updateError]);
    const reset = useCallback(() => {
        resetObservations(store, [stateAtom, hardwareAtom]);
        store.set(catalogAtom, null); store.set(stateAtom, { observation_id: "0", jobs: {} });
        store.set(userModelsAtom, null);
        store.set(errorAtom, null); store.set(pendingAtom, null);
        store.set(hardwareAtom, { phase: 'unknown', devices: [], observation_id: '0' });
    }, [store]);
    const send = useCallback(async (endpoint: string, data?: ModelDownloadRequestData): Promise<void> => {
        const isHardware = endpoint.includes('model_download_hardware');
        let request: PendingModelRequest | undefined;
        if (endpoint.startsWith("/run/") && !isHardware) {
            const pending = store.get(pendingAtom);
            // Every /run/ command but the hardware probe names its model (data.id).
            if (pending && !(endpoint === "/run/cancel_model_download" && pending.every(item =>
                item.endpoint === "/run/apply_model_download" && item.id === data?.id && item.job_id === data?.job_id))) return;
            request = { endpoint, id: data?.id, job_id: data?.job_id };
            setError(null); setPending([...(pending ?? []), request]);
        }
        if (isHardware && endpoint.startsWith('/run/')) store.set(hardwareAtom, { ...store.get(hardwareAtom), phase: 'probing' });
        if (!await transport.current(endpoint, data)) {
            if (isHardware) store.set(hardwareAtom, { ...store.get(hardwareAtom), phase: 'failed', error_code: 'backend_unavailable' });
            else if (!request || store.get(pendingAtom)?.includes(request)) updateError("backend_unavailable", endpoint);
        }
    }, [store, setPending, setError, updateError]);
    const ensureHardware = useCallback(() => {
        if (store.get(hardwareAtom).phase === 'unknown') send('/run/refresh_model_download_hardware', {});
    }, [store, send]);
    return { catalog, state, hardware, error, pending, userModels, send, ensureHardware, updateHardware, updateCatalog, updateState,
        acknowledge, updateUserModels, acknowledgeUserModels, updateError, expireUnconfirmed, reset, backendStopped };
};
