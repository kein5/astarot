// The voice auditions of the TTS and RVC catalogs (#415): which card may play one, and the core's
// state (`/get/data/voice_audition_state`), checked before the UI uses it. The sentence and the
// model's files are the core's; the UI names them by id only. An RVC audition records the user's
// voice from the input chosen on the RVC page, on the press only; the core keeps nothing of it.

export type AuditionProfile = "japanese" | "multilingual";
export type AuditionKind = "tts" | "rvc";
// `recording` while an RVC audition records, `preparing` until the first sound plays (an RVC
// worker loads first), then `playing`.
export type AuditionStage = "recording" | "preparing" | "playing";

// What an RVC audition converts. `recording`: the user's voice, recorded on the press.
export const RVC_AUDITION_SOURCE = "recording";
// How long an RVC audition records the user's voice, in seconds (the core takes 1 to 10).
export const RVC_AUDITION_SECONDS = 5;

// Why a TTS card cannot play the audition now, in the order the user would fix it. `null`: it can.
export type AuditionBlock = "not_downloaded" | "not_in_use" | "server_stopped" | "monitor_off" | "muted" | null;
// The same for an RVC card.
export type RvcAuditionBlock = "not_downloaded" | "values_invalid" | "conversion_running" | "input_missing" | "monitor_off" | "muted" | null;

// The pitch and the index rate an RVC audition converts with.
export type RvcAuditionValues = { pitch: number; index_rate: number };
// What the RVC page gives its catalog's cards: the form's values (null while they are not valid)
// and the chosen input's id, which the voice is recorded from (null while none is chosen).
export type RvcAudition = { values: RvcAuditionValues | null; input: unknown };

export type AuditionState = {
    state: "idle" | "playing";
    run: number;
    kind: AuditionKind | null;
    profile: AuditionProfile | null;
    entry: string | null;
    stage: AuditionStage | null;
    last_run: number | null;
    outcome: "completed" | "stopped" | "failed" | null;
    error_code: string | null;
};

// What the page shows: nothing yet, a press waiting for its answer, or an audition playing. The
// outcome and error belong to the card last pressed: a TTS profile, or an RVC model by its id.
export type AuditionView = {
    phase: "idle" | "pending" | "playing";
    kind: AuditionKind | null;
    profile: AuditionProfile | null;
    entry: string | null;
    stage: AuditionStage | null;
    run: number | null;
    error: string | null;
};

export const IDLE_AUDITION: AuditionView = { phase: "idle", kind: null, profile: null, entry: null, stage: null, run: null, error: null };

export const isAuditionProfile = (value: unknown): value is AuditionProfile => value === "japanese" || value === "multilingual";

// Each profile reads the language it speaks in use: TTS sends Japanese to the Japanese server and
// every other language to the multilingual one.
export const auditionSentence = (profile: AuditionProfile): "ja" | "en" => profile === "japanese" ? "ja" : "en";

const count = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
const code = (value: unknown): string | null => typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value) ? value : null;
const entryId = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;

// The values a form holds, when an RVC audition may use them: a whole pitch within ±24 and an
// index rate from 0 to 1. `null` otherwise.
export const rvcAuditionValues = (pitch: unknown, indexRate: unknown): RvcAuditionValues | null =>
    Number.isInteger(pitch) && Math.abs(pitch as number) <= 24 && typeof indexRate === "number" && Number.isFinite(indexRate) && indexRate >= 0 && indexRate <= 1
        ? { pitch: pitch as number, index_rate: indexRate } : null;

export const normalizeAuditionState = (value: unknown): AuditionState | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const run = count(row.run);
    if ((row.state !== "idle" && row.state !== "playing") || run === null) return null;
    const outcome = row.outcome === "completed" || row.outcome === "stopped" || row.outcome === "failed" ? row.outcome : null;
    const profile = isAuditionProfile(row.profile) ? row.profile : null;
    // A core before RVC auditions names no kind: a playing one with a profile is TTS.
    const kind = row.kind === "tts" || row.kind === "rvc" ? row.kind : row.state === "playing" && profile ? "tts" : null;
    return {
        state: row.state, run, kind, profile, entry: entryId(row.entry),
        stage: row.stage === "recording" || row.stage === "preparing" || row.stage === "playing" ? row.stage : null,
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

// An RVC card: any model on this PC may be heard, in use or not. `values` are the form's (null
// when they are not valid); `converting` is a live conversion running; `input` the input chosen
// on the RVC page, which the user's voice is recorded from.
export const rvcAuditionBlock = ({ status, values, converting, input, monitor, muted }:
    { status: string; values: RvcAuditionValues | null; converting: boolean; input: unknown; monitor: unknown; muted: boolean }): RvcAuditionBlock => {
    if (!["downloaded", "in_use", "ready"].includes(status)) return "not_downloaded";
    if (!values) return "values_invalid";
    if (converting) return "conversion_running";
    if (!input) return "input_missing";
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
        return { phase: "playing", kind: state.kind, profile: state.profile, entry: state.entry, stage: state.stage ?? "playing", run: state.run, error: null };
    }
    // Idle: the audition shown has ended. A press still waiting is decided by its own answer.
    if (view.phase !== "playing" || view.run === null || (state.last_run ?? 0) < view.run) return view;
    const error = state.last_run === view.run && state.outcome === "failed" ? state.error_code : null;
    return { ...view, phase: "idle", stage: null, error };
};

// A start the core refused, or one whose answer never came.
export const auditionAfterFailure = (view: AuditionView, error: string): AuditionView =>
    view.phase === "pending" ? { ...view, phase: "idle", error } : view;
