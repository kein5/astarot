// The voice audition of the TTS catalog (#415): which card may play it, and the core's state
// (`/get/data/voice_audition_state`), checked before the UI uses it. The sentence itself is the
// core's; the UI names it by id only.

export type AuditionProfile = "japanese" | "multilingual";

// Why a card cannot play the audition now, in the order the user would fix it. `null`: it can.
export type AuditionBlock = "not_downloaded" | "not_in_use" | "server_stopped" | "monitor_off" | "muted" | null;

export type AuditionState = {
    state: "idle" | "playing";
    run: number;
    profile: AuditionProfile | null;
    last_run: number | null;
    outcome: "completed" | "stopped" | "failed" | null;
    error_code: string | null;
};

// What the page shows: nothing yet, a press waiting for its answer, or an audition playing. The
// outcome and error belong to the profile last pressed.
export type AuditionView = {
    phase: "idle" | "pending" | "playing";
    profile: AuditionProfile | null;
    run: number | null;
    error: string | null;
};

export const IDLE_AUDITION: AuditionView = { phase: "idle", profile: null, run: null, error: null };

export const isAuditionProfile = (value: unknown): value is AuditionProfile => value === "japanese" || value === "multilingual";

// Each profile reads the language it speaks in use: TTS sends Japanese to the Japanese server and
// every other language to the multilingual one.
export const auditionSentence = (profile: AuditionProfile): "ja" | "en" => profile === "japanese" ? "ja" : "en";

const count = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
const code = (value: unknown): string | null => typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;

export const normalizeAuditionState = (value: unknown): AuditionState | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const run = count(row.run);
    if ((row.state !== "idle" && row.state !== "playing") || run === null) return null;
    const outcome = row.outcome === "completed" || row.outcome === "stopped" || row.outcome === "failed" ? row.outcome : null;
    return {
        state: row.state, run, profile: isAuditionProfile(row.profile) ? row.profile : null,
        last_run: count(row.last_run), outcome, error_code: outcome === "failed" ? code(row.error_code) ?? "voice_audition_failed" : null,
    };
};

// `status` is the card's download status (modelCatalog.downloadStatus, or "in_use" for a model of
// one's own in use); `server` is the profile's server state; `monitor` the saved monitor choice.
export const auditionBlock = ({ status, server, monitor, muted }:
    { status: string; server: unknown; monitor: unknown; muted: boolean }): AuditionBlock => {
    if (!["downloaded", "in_use", "ready"].includes(status)) return "not_downloaded";
    if (status !== "in_use") return "not_in_use";
    if (server !== "ready") return "server_stopped";
    if (monitor !== "on") return "monitor_off";
    if (muted) return "muted";
    return null;
};

// The view after the core answers: a start (200), a polled state or a stop.
export const auditionAfterState = (view: AuditionView, value: unknown): AuditionView => {
    const state = normalizeAuditionState(value);
    if (!state) return view;
    if (state.state === "playing") {
        // An older answer never moves the page back to an audition already replaced.
        if (view.run !== null && state.run < view.run) return view;
        return { phase: "playing", profile: state.profile, run: state.run, error: null };
    }
    // Idle: the audition shown has ended. A press still waiting is decided by its own answer.
    if (view.phase !== "playing" || view.run === null || (state.last_run ?? 0) < view.run) return view;
    const error = state.last_run === view.run && state.outcome === "failed" ? state.error_code : null;
    return { phase: "idle", profile: view.profile, run: view.run, error };
};

// A start the core refused, or one whose answer never came.
export const auditionAfterFailure = (view: AuditionView, error: string): AuditionView =>
    view.phase === "pending" ? { ...view, phase: "idle", error } : view;
