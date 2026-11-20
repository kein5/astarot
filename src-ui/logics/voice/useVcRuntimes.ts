import { atom, useAtom, useStore } from "jotai";
import { useCallback, useRef } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { acceptObservation, resetObservations, sameSnapshot } from "../common/polledState.ts";
import type { ObservedSnapshot } from "../common/polledState.ts";

// The voice conversion runtime replies of the core, as far as this hook reads them. They are
// not checked here; the setup page reads the other fields.

// One runtime the backend can prepare (native/voice-conversion/src/runtime.rs, catalog): the sizes are
// in bytes, `destination` is the folder it goes to and `notice` names its own wording.
export interface VcRuntimeEntry {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly licenses: readonly string[];
    readonly notice: string;
    readonly download_bytes: number;
    readonly disk_bytes: number;
    readonly destination: string;
    readonly gpu_ready: boolean;
    readonly requires_gpu: boolean;
    readonly device: string;
}

// /get/data/vc_runtime_catalog.
export interface VcRuntimeCatalog {
    readonly runtimes?: readonly VcRuntimeEntry[];
    readonly [key: string]: unknown;
}

// One setup of a runtime (runtime.rs): phase is one of activeSetupPhases while it runs; step counts
// its steps, and the bytes count the download of the step that downloads.
export interface VcRuntimeJob {
    readonly job_id: string;
    readonly phase: string;
    readonly step: number;
    readonly steps: number;
    readonly received_bytes: number;
    readonly total_bytes: number;
    readonly error_code?: string | null;
    readonly warning_code?: string | null;
    readonly [key: string]: unknown;
}

// /get/data/vc_runtime_state, polled. installed: the folder of each runtime that is ready.
export interface VcRuntimeState extends ObservedSnapshot {
    readonly jobs: Readonly<Record<string, VcRuntimeJob>>;
    readonly installed: Readonly<Record<string, string>>;
    readonly [key: string]: unknown;
}

export const activeSetupPhases: readonly string[] = ["queued", "tools", "python", "packages", "engine", "libraries", "assets", "verifying", "cancelling"];
const emptyState: VcRuntimeState = { observation_id: "0", jobs: {}, installed: {} };
const catalogAtom = atom<VcRuntimeCatalog | null>(null), stateAtom = atom(emptyState), errorAtom = atom<string | null>(null), pendingAtom = atom(false);

export const useVcRuntimes = () => {
    const store = useStore();
    const [catalog, setCatalog] = useAtom(catalogAtom), [state] = useAtom(stateAtom);
    const [error, setError] = useAtom(errorAtom), [pending, setPending] = useAtom(pendingAtom);
    const { asyncStdoutToPython } = useStdoutToPython();
    const transport = useRef(asyncStdoutToPython);
    transport.current = asyncStdoutToPython;
    const updateCatalog = useCallback((value: VcRuntimeCatalog | null) => setCatalog(value), [setCatalog]);
    const updateState = useCallback((value: VcRuntimeState | null | undefined) => {
        if (!value?.jobs || !acceptObservation(store, stateAtom, value)) return;
        store.set(stateAtom, previous => sameSnapshot(previous, value) ? previous : value);
    }, [store]);
    const acknowledge = useCallback((value: VcRuntimeState | null | undefined) => { updateState(value); setPending(false); }, [updateState, setPending]);
    const updateError = useCallback((value: string | null) => { setError(value); setPending(false); }, [setError, setPending]);
    const send = useCallback(async (endpoint: string, data?: unknown): Promise<void> => {
        const command = endpoint.startsWith("/run/");
        if (command) {
            if (store.get(pendingAtom)) return;
            setError(null); setPending(true);
        }
        if (!await transport.current(endpoint, data) && command) updateError("backend_unavailable");
    }, [store, setError, setPending, updateError]);
    const reset = useCallback(() => {
        resetObservations(store, [stateAtom]);
        store.set(catalogAtom, null); store.set(stateAtom, emptyState);
        store.set(errorAtom, null); store.set(pendingAtom, false);
    }, [store]);
    const backendStopped = useCallback(() => {
        updateError("backend_unavailable");
        store.set(stateAtom, value => ({ ...value, jobs: Object.fromEntries(Object.entries(value.jobs).map(([id, job]) =>
            [id, activeSetupPhases.some(phase => phase === job.phase) ? { ...job, phase: "failed", error_code: "backend_unavailable" } : job])) }));
    }, [store, updateError]);
    return { catalog, state, error, pending, send, updateCatalog, updateState, acknowledge, updateError, reset, backendStopped };
};
