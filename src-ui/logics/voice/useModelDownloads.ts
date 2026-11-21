import { atom, useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { acceptObservation, resetObservations, sameSnapshot } from "../common/polledState.ts";
import type { ObservedSnapshot } from "../common/polledState.ts";
import type { CatalogEntry, UserModel } from "./modelCatalog.ts";
import type { HardwareState, ModelGuidance, ModelValidation } from "./modelHardwareAdvice.ts";

// The model download replies of the core (docs/voice-stack/model-downloads.md), as far as this
// hook reads them. They are not checked here; the pages read the other fields.

// A model's measured guidance as the catalog sends it: always with its validation
// (native/ops/src/downloads/guidance.rs).
export interface ModelCatalogGuidance extends ModelGuidance {
    readonly validation: ModelValidation;
}

// The speech.cpp model a catalog row is a file of, with the languages it reads.
export interface CatalogSpeech extends NonNullable<CatalogEntry["speech"]> {
    readonly languages?: readonly string[];
}

// One downloadable file of a model in the catalog (native/ops/src/downloads/catalog.rs), as the
// catalog page reads it.
export interface ModelCatalogRow extends CatalogEntry {
    readonly speech?: CatalogSpeech | null;
    readonly provider: string;
    readonly license: string;
    readonly licenses: readonly string[];
    readonly source: string;
    readonly repo: string;
    readonly destination: string;
    readonly notice: string;
    readonly artifacts: readonly { readonly filename: string; readonly size: number }[];
    readonly guidance?: ModelCatalogGuidance | null;
    readonly restrictions?: unknown;
}

// /get/data/model_download_catalog.
export interface ModelDownloadCatalog {
    readonly catalog_version: string;
    readonly models: readonly ModelCatalogRow[];
    readonly [key: string]: unknown;
}

// One download (native/ops/src/downloads/manager.rs): phase is "queued", "downloading",
// "verifying", "cancelling", "ready", "failed" and so on. paths: where an applied download put its files.
// The fields the first-run setup reads too (DownloadJob in setup/firstRunSetup.ts).
export interface ModelDownloadJob {
    readonly job_id: string;
    readonly phase: string;
    readonly error_code?: string | null;
    readonly received_bytes: number;
    readonly total_bytes: number;
    readonly paths?: Readonly<Record<string, string>>;
    readonly [key: string]: unknown;
}

// /get/data/model_download_state, polled. downloaded: the files of each model on disk, by role.
export interface ModelDownloadState extends ObservedSnapshot {
    readonly jobs: Readonly<Record<string, ModelDownloadJob>>;
    readonly downloaded?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly [key: string]: unknown;
}

// /get/data/model_download_hardware: phase is "unknown" until asked, then "probing", and so on.
export type ModelDownloadHardware = ObservedSnapshot & HardwareState;

// The models the user registered under a name (#403), as the backend sends them.
export interface UserModels {
    readonly models: readonly UserModel[];
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
    // No reply in time (#431): say so, and release every command, Apply included (#563), so the
    // buttons work again; the state poll shows what each one did. An Apply may still be
    // verifying then: a start or another Apply sent meanwhile is refused by the core
    // (download_busy), and its Cancel is still allowed.
    const expireUnconfirmed = useCallback(() => {
        setError("request_unconfirmed");
        setPending(null);
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
