import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { Atom_MessageLogs } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import type { StdoutResult } from "@useStdoutToPython";
import { mergeRealtimeState, pruneRealtimeCaptions } from "./realtimeCaptionState";
import type { CaptionSource, RealtimeSession, RealtimeSessions } from "./realtimeCaptionState";

// /get/data/realtime_asr_settings (native/core/src/controller/realtime_asr.rs). The hook
// compares the fields below; the settings page reads the rest.
export interface RealtimeAsrSettings {
    readonly server?: unknown;
    readonly base_url?: unknown;
    readonly model?: unknown;
    readonly mic?: unknown;
    readonly speaker?: unknown;
    readonly [key: string]: unknown;
}

// /get/data/realtime_asr_endpoints, asked once for each source.
export interface RealtimeAsrEndpoint {
    readonly source?: unknown;
    readonly [key: string]: unknown;
}

export type RealtimeAsrEndpoints = Partial<Record<CaptionSource, RealtimeAsrEndpoint>>;

// /get/data/realtime_asr_models: the models the server offers.
export interface RealtimeAsrModels {
    readonly models: readonly unknown[];
    readonly [key: string]: unknown;
}

// What /get/data/realtime_asr_state reports for each source; null ends a source's session.
export type RealtimeStateUpdate = Partial<Record<CaptionSource, RealtimeSession | null>>;

const SOURCES: readonly CaptionSource[] = ["mic", "speaker"];

const isSource = (value: unknown): value is CaptionSource => value === "mic" || value === "speaker";

export const realtimeStateAtom = atom<RealtimeSessions>({});
export const realtimeRetiredAtom = atom<string[]>([]);
const settingsAtom = atom<RealtimeAsrSettings | null>(null);
const endpointsAtom = atom<RealtimeAsrEndpoints>({});
const modelsAtom = atom<RealtimeAsrModels>({ models: [] });
const errorAtom = atom<string | null>(null);

export const useRealtimeASR = () => {
    const [settings, setSettings] = useAtom(settingsAtom);
    const [state] = useAtom(realtimeStateAtom);
    const [endpoints] = useAtom(endpointsAtom);
    const [models, updateModels] = useAtom(modelsAtom);
    const [error, updateError] = useAtom(errorAtom);
    const atoms = useStore();
    const { asyncStdoutToPython } = useStdoutToPython();
    const updateState = useCallback((value: RealtimeStateUpdate | null | undefined) => {
        const next = mergeRealtimeState(atoms.get(realtimeStateAtom), value);
        atoms.set(realtimeStateAtom, next);
        const logs = atoms.get(Atom_MessageLogs);
        const pruned = pruneRealtimeCaptions({ rows: logs.data, retired: atoms.get(realtimeRetiredAtom) }, next);
        if (pruned.rows !== logs.data) atoms.set(Atom_MessageLogs, { ...logs, data: pruned.rows });
        atoms.set(realtimeRetiredAtom, pruned.retired);
    }, [atoms]);
    const backendStopped = useCallback(() => {
        updateError("backend_unavailable");
        const failed: RealtimeStateUpdate = {};
        for (const [source, row] of Object.entries(atoms.get(realtimeStateAtom))) {
            if (isSource(source) && row) failed[source] = { ...row, requested: false, state: "failed", error_code: "backend_unavailable" };
        }
        updateState(failed);
        // A lost sidecar cannot confirm delivery. Keep recognized text, and
        // preserve outcomes already received before the connection closed.
        const logs = atoms.get(Atom_MessageLogs);
        const rows = logs.data.map(row => row.realtime && !row.realtime.outcome
            ? { ...row, status: "failed", realtime: { ...row.realtime, outcome: "failed", reason: "backend_unavailable" } }
            : row);
        if (rows.some((row, index) => row !== logs.data[index])) atoms.set(Atom_MessageLogs, { ...logs, data: rows });
    }, [atoms, updateError, updateState]);
    const reset = useCallback(() => {
        atoms.set(realtimeStateAtom, {});
        atoms.set(realtimeRetiredAtom, []);
        atoms.set(settingsAtom, null);
        atoms.set(endpointsAtom, {});
        atoms.set(modelsAtom, { models: [] });
        atoms.set(errorAtom, null);
        const logs = atoms.get(Atom_MessageLogs);
        atoms.set(Atom_MessageLogs, { ...logs, data: logs.data.filter(row => row.realtime?.state !== "partial") });
    }, [atoms]);
    const updateSettings = useCallback((value: RealtimeAsrSettings) => {
        const previous = atoms.get(settingsAtom);
        if (previous) {
            const active = atoms.get(realtimeStateAtom), invalidated: RealtimeStateUpdate = {};
            const shared = previous.server !== value.server || previous.base_url !== value.base_url || previous.model !== value.model;
            for (const source of SOURCES) {
                const session = active[source];
                if (session && (shared || JSON.stringify(previous[source]) !== JSON.stringify(value[source]))) {
                    invalidated[source] = { ...session, requested: false, state: "stopping" };
                }
            }
            updateState(invalidated);
        }
        setSettings(value);
        updateError(null);
    }, [atoms, setSettings, updateError, updateState]);
    const updateEndpoints = useCallback((value: RealtimeAsrEndpoint | null | undefined) => {
        const source = value?.source;
        if (value && isSource(source)) {
            atoms.set(endpointsAtom, { ...atoms.get(endpointsAtom), [source]: value });
        }
    }, [atoms]);
    // Identity and ordering always read the atom store, including within one
    // response batch before React rerenders. Hook closures are not authority.
    const send = useCallback(async (endpoint: string, data?: unknown): Promise<StdoutResult> => {
        if (endpoint !== "/get/data/realtime_asr_state") updateError(null);
        const response = await asyncStdoutToPython(endpoint, data);
        if (response === false) updateError("backend_unavailable");
        return response;
    }, [updateError]);
    return { settings, state, endpoints, models, error, send, updateSettings,
        updateState, updateEndpoints, updateModels, updateError, reset, backendStopped };
};
