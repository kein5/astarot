import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { Atom_MessageLogs } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import type { StdoutResult } from "@useStdoutToPython";
import { mergeRealtimeState, pruneRealtimeCaptions } from "./realtimeCaptionState";
import type { CaptionSource, RealtimeSession, RealtimeSessions } from "./realtimeCaptionState";

// A capture endpoint as the core names it: the four fields together say which one.
export interface RealtimeAsrEndpointId {
    readonly cookie?: unknown;
    readonly serial?: unknown;
    readonly name?: unknown;
    readonly media_class?: unknown;
    readonly [key: string]: unknown;
}

// One source's settings. No endpoint and follow_default on follow the system's default device.
export interface RealtimeAsrSourceSettings {
    readonly language: string;
    readonly endpoint: RealtimeAsrEndpointId | null;
    readonly follow_default?: boolean;
}

// The built-in keywords on or off, and the user's own, "written=reading,reading".
export interface RealtimeAsrVocabulary {
    readonly builtin?: boolean;
    readonly terms: readonly string[];
}

// /get/data/realtime_asr_settings (native/core/src/controller/realtime_asr.rs), in the shape the
// core saves it (voice_settings.rs normalize_realtime). The hook compares server, base_url, model,
// mic and speaker; the settings page edits the rest. Declared, not checked. silence_duration_ms is
// left out until one is chosen.
export interface RealtimeAsrSettings {
    readonly version?: number;
    readonly server?: string;
    readonly start_server?: boolean;
    readonly base_url?: string;
    readonly model?: string;
    readonly mic: RealtimeAsrSourceSettings;
    readonly speaker: RealtimeAsrSourceSettings;
    readonly vocabulary?: RealtimeAsrVocabulary;
    readonly silence_duration_ms?: number;
}

// One input the server can record from, with the name it is shown with.
export interface RealtimeAsrEndpointRow {
    readonly endpoint: RealtimeAsrEndpointId;
    readonly label?: string;
}

// /get/data/realtime_asr_endpoints, asked once for each source.
export interface RealtimeAsrEndpoint {
    readonly source?: unknown;
    readonly endpoints?: readonly RealtimeAsrEndpointRow[];
    readonly error_code?: string | null;
    readonly [key: string]: unknown;
}

// A model the server offers (speechcpp::Model): "auto" is a language only where it detects one.
export interface RealtimeAsrModel {
    readonly id: string;
    readonly languages?: readonly string[];
    readonly detects_language?: boolean;
    readonly [key: string]: unknown;
}

export type RealtimeAsrEndpoints = Partial<Record<CaptionSource, RealtimeAsrEndpoint>>;

// /get/data/realtime_asr_models: the models the server offers, with the server and the URL they
// were read from (base_url is the bundled server's address when it runs one).
export interface RealtimeAsrModels {
    readonly models: readonly RealtimeAsrModel[];
    readonly server?: string;
    readonly configured_url?: string;
    readonly base_url?: string | null;
    readonly server_generation?: number | null;
    readonly error_code?: string | null;
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
