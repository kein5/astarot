import { downloadProgress } from "../main/setupNeeds.ts";
import type { DownloadProgress, ModelWeight } from "../main/setupNeeds.ts";

// The sidecar session's BackendStartupState (see sidecarSession.ts).
export type BackendStartupState = "starting" | "running" | "failed" | "stopped";

export type StartupPhase = "starting" | "failed" | "ready" | "stopped";

// What the window shows while the engine starts. It is derived from the two
// values the sidecar session already publishes (BackendStartupState and
// IsBackendReady), so readiness is not tracked twice.
//
// - "starting": the main page is drawn but locked, with placeholders for what
//   the engine has not sent yet.
// - "failed":   the same locked page, with the startup failure dialog over it.
// - "ready":    the engine sent its settings; the page is live.
// - "stopped":  the engine stopped after it was ready; the page stays, with the
//   switches showing the lost connection (see docs/spec/ipc-protocol.md).
export const startupPhase = ({ startupState, isBackendReady }: { startupState: unknown; isBackendReady: unknown }): StartupPhase => {
    if (startupState === "failed") return "failed";
    if (startupState === "stopped") return "stopped";
    return isBackendReady === true ? "ready" : "starting";
};

export const isStartupLocked = (phase: StartupPhase) => phase === "starting" || phase === "failed";

// What the startup failure dialog explains.
export type StartupFailure =
    | { kind: "exit"; code: unknown }
    | { kind: "spawn"; message: string | null };

// The detail a failed start passes: the exit ({ code, signal }) or the spawn error.
interface StartupFailureDetail {
    code?: unknown;
    signal?: unknown;
    message?: unknown;
}

// Why the start failed, kept small: a spawn that never produced a process (with
// the shell plugin's message, shortened), or a process that ended before it was ready.
export const describeStartupFailure = (detail: unknown): StartupFailure => {
    if (detail && typeof detail === "object" && ("code" in detail || "signal" in detail)) {
        return { kind: "exit", code: (detail as StartupFailureDetail).code ?? (detail as StartupFailureDetail).signal ?? null };
    }
    // Reading a field of any other value gives undefined, as for a missing field.
    const message = typeof detail === "string" ? detail : (detail as StartupFailureDetail | null | undefined)?.message;
    return { kind: "spawn", message: typeof message === "string" && message.trim() ? message.trim().slice(0, 200) : null };
};

// One model the engine fetches before it is ready.
export interface StartupDownload {
    kind: "translation";
    id: unknown;
    progress: DownloadProgress;
}

// Models the engine fetches before it is ready: the translation model, when
// AUTO_DOWNLOAD_MODELS is on. Same "pending" / percentage reading as the first
// screen's setup list. "kind" names the model in the startup list.
export const startupDownloads = ({ translationWeights }: { translationWeights?: readonly (ModelWeight | null | undefined)[] | null }): StartupDownload[] => (translationWeights || [])
    .map((weight): StartupDownload => ({ kind: "translation", id: weight?.id, progress: downloadProgress(weight) }))
    .filter(item => item.progress !== null);
