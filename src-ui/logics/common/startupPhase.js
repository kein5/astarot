import { downloadProgress } from "../main/setupNeeds.js";

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
export const startupPhase = ({ startupState, isBackendReady }) => {
    if (startupState === "failed") return "failed";
    if (startupState === "stopped") return "stopped";
    return isBackendReady === true ? "ready" : "starting";
};

export const isStartupLocked = phase => phase === "starting" || phase === "failed";

// Why the start failed, kept small: a spawn that never produced a process (with
// the shell plugin's message, shortened), or a process that ended before it was ready.
export const describeStartupFailure = detail => {
    if (detail && typeof detail === "object" && ("code" in detail || "signal" in detail)) {
        return { kind: "exit", code: detail.code ?? detail.signal ?? null };
    }
    const message = typeof detail === "string" ? detail : detail?.message;
    return { kind: "spawn", message: typeof message === "string" && message.trim() ? message.trim().slice(0, 200) : null };
};

// Models the engine fetches before it is ready: the translation model, when
// AUTO_DOWNLOAD_MODELS is on. Same "pending" / percentage reading as the first
// screen's setup list. "kind" names the model in the startup list.
export const startupDownloads = ({ translationWeights }) => (translationWeights || [])
    .map(weight => ({ kind: "translation", id: weight?.id, progress: downloadProgress(weight) }))
    .filter(item => item.progress !== null);
