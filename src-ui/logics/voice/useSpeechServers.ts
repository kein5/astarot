import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import type { StdoutResult } from "@useStdoutToPython";
import { sameValue } from "../common/polledState.ts";
import type { AsrProfile } from "../main/setupNeeds.ts";

// The speech server replies of the core, as far as this hook reads them. They are not checked
// here, but for the state rows below; the settings pages read the other fields.

export type SpeechProfile = "japanese" | "multilingual" | "asr";
export type SpeechServerPhase = "stopped" | "preparing" | "ready" | "stopping" | "failed";

// /get/data/speech_server_settings: one profile for each server, and what else the page edits.
export interface SpeechServerSettings {
    readonly profiles?: { readonly asr?: AsrProfile | null; readonly [profile: string]: unknown } | null;
    readonly [key: string]: unknown;
}

// One server as /get/data/speech_server_state reports it; generation counts its starts and stops.
export interface SpeechServerRow {
    readonly generation: number;
    readonly state: SpeechServerPhase;
    readonly error_code?: unknown;
    readonly [key: string]: unknown;
}

export type SpeechServerStates = Partial<Record<SpeechProfile, SpeechServerRow>>;

// /get/data/speech_server_devices: the GPUs, and what the CPU and GPU choices run on.
export interface SpeechServerDevices {
    readonly devices?: unknown;
    readonly cpu_build?: unknown;
    readonly gpu_build?: unknown;
    readonly [key: string]: unknown;
}

// What the CPU choice runs on ("separate": a CPU build of its own, Linux; "shared": the one Vulkan
// build, Windows) and whether the GPU choices can start ("ready", "unavailable", "missing").
export interface SpeechServerBuilds {
    readonly cpu_build: string | null;
    readonly gpu_build: string | null;
}

// What the settings pages send with a request, as far as it is read here.
export interface SpeechServerRequestData {
    readonly profile?: unknown;
    readonly [key: string]: unknown;
}

const settingsAtom = atom<SpeechServerSettings | null>(null), stateAtom = atom<SpeechServerStates>({});
const pendingAtom = atom<Partial<Record<string, { generation: number }>>>({}), errorAtom = atom<string | null>(null), devicesAtom = atom<readonly unknown[]>([]);
const buildsAtom = atom<SpeechServerBuilds>({ cpu_build: null, gpu_build: null });
const BUILD_STATES: Readonly<Record<keyof SpeechServerBuilds, readonly string[]>> = { cpu_build: ["separate", "shared", "missing"], gpu_build: ["ready", "unavailable", "missing"] };
const phases: Readonly<Record<SpeechServerPhase, number>> = { stopped: 0, preparing: 1, ready: 2, stopping: 3, failed: 4 };
const profiles: readonly SpeechProfile[] = ["japanese", "multilingual", "asr"];

// A known build state, or null for one an older backend does not send.
const knownBuild = (known: readonly string[], value: unknown): string | null =>
    typeof value === "string" && known.includes(value) ? value : null;
const isPhase = (value: unknown): value is SpeechServerPhase => typeof value === "string" && Object.hasOwn(phases, value);
// A row with a generation and a phase this page knows; any other is skipped.
const isServerRow = (row: unknown): row is SpeechServerRow => typeof row === "object" && row !== null
    && "generation" in row && Number.isSafeInteger(row.generation) && typeof row.generation === "number" && row.generation >= 0
    && "state" in row && isPhase(row.state);

export const useSpeechServers = () => {
    const atoms = useStore();
    const [settings, setSettings] = useAtom(settingsAtom);
    const [state] = useAtom(stateAtom);
    const [devices, setDevices] = useAtom(devicesAtom);
    const [builds, setBuilds] = useAtom(buildsAtom);
    const [pending] = useAtom(pendingAtom);
    const [error, setError] = useAtom(errorAtom);
    const { asyncStdoutToPython } = useStdoutToPython();
    const updateError = useCallback((value: string | null) => {
        setError(value);
        if (value) atoms.set(pendingAtom, {});
    }, [atoms, setError]);
    const updateSettings = useCallback((value: SpeechServerSettings | null) => { setSettings(value); setError(null); }, [setSettings, setError]);
    const updateDevices = useCallback((value: SpeechServerDevices | null | undefined) => {
        if (!value || !Array.isArray(value.devices)) return;
        setDevices(value.devices);
        // Unknown or absent values (an older backend) show nothing extra.
        setBuilds({ cpu_build: knownBuild(BUILD_STATES.cpu_build, value.cpu_build), gpu_build: knownBuild(BUILD_STATES.gpu_build, value.gpu_build) });
    }, [setDevices, setBuilds]);
    const updateState = useCallback((value: Readonly<Record<string, unknown>> | null | undefined) => {
        const current = atoms.get(stateAtom), pending = atoms.get(pendingAtom);
        let next = current, waiting = pending;
        for (const name of profiles) {
            const row = value?.[name], previous = next[name];
            if (!isServerRow(row)) continue;
            if (previous && (row.generation < previous.generation ||
                (row.generation === previous.generation && phases[row.state] < phases[previous.state]))) continue;
            if (!sameValue(previous, row)) {
                if (next === current) next = { ...current };
                next[name] = row;
            }
            const asked = waiting[name];
            if (asked && row.generation > asked.generation) {
                if (waiting === pending) waiting = { ...pending };
                delete waiting[name];
            }
        }
        atoms.set(stateAtom, next);
        atoms.set(pendingAtom, waiting);
    }, [atoms]);
    const backendStopped = useCallback(() => {
        updateError("backend_unavailable");
        atoms.set(stateAtom, value => {
            const stopped: SpeechServerStates = {};
            for (const name of profiles) {
                const row = value[name];
                if (row) stopped[name] = { ...row, state: "failed", error_code: "backend_unavailable" };
            }
            return stopped;
        });
    }, [atoms, updateError]);
    const reset = useCallback(() => {
        atoms.set(settingsAtom, null);
        atoms.set(stateAtom, {});
        atoms.set(pendingAtom, {});
        atoms.set(errorAtom, null);
        atoms.set(devicesAtom, []);
        atoms.set(buildsAtom, { cpu_build: null, gpu_build: null });
    }, [atoms]);
    const send = useCallback(async (endpoint: string, data?: SpeechServerRequestData): Promise<StdoutResult> => {
        if (!["/get/data/speech_server_state", "/get/data/speech_server_devices"].includes(endpoint)) setError(null);
        if (["/run/start_speech_server", "/run/stop_speech_server"].includes(endpoint)) {
            const known = profiles.find(name => name === data?.profile);
            const generation = (known ? atoms.get(stateAtom)[known]?.generation : undefined) ?? -1;
            atoms.set(pendingAtom, { ...atoms.get(pendingAtom), [`${data?.profile}`]: { generation } });
        }
        const response = await asyncStdoutToPython(endpoint, data);
        if (response === false) updateError("backend_unavailable");
        return response;
    }, [atoms, setError, updateError]);
    return { settings, state, devices, builds, pending, error, send, updateSettings, updateState, updateDevices, updateError, reset, backendStopped };
};
