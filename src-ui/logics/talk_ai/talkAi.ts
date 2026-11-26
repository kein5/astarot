// Talk AI (#388, ADR-018): a spoken conversation with an external service, which can also be shown
// the screen. The core holds the session and checks every consent (docs/spec/ipc-protocol.md
// 「おしゃべりAI」); this module reads its answers and builds its requests. No hooks here: the
// settings page, the indicator above the pages and their tests read the same helpers.
//
// The order the core asks for, which the UI keeps:
//   1. The user consents to the destination and to sending the voice, at every start
//      (/set/enable/talk_ai with provider, destination and consent.audio).
//   2. Once the session is ready, the indicator above the pages shows that the voice is sent;
//      only after it is drawn does the UI open the microphone (/set/enable/talk_ai_audio with
//      indicator_visible).
//   3. Screen sharing has a consent of its own, and the indicator shows it before the first frame
//      (/set/enable/talk_ai_screen). Stopping it ends the conversation (#1099, decision 2).

export type TalkPhase = "idle" | "connecting" | "ready" | "failed";

// /get/data/talk_ai_status, the answers of the start and stop requests, and /run/talk_ai_status.
export interface TalkStatus {
    session_id: number | null;
    phase: TalkPhase;
    error: string | null;
    sending_audio: boolean;
    sending_screen: boolean;
    screen_source: string | null;
}

export const IDLE_STATUS: TalkStatus = Object.freeze({
    session_id: null, phase: "idle", error: null, sending_audio: false, sending_screen: false, screen_source: null,
});

const PHASES: readonly TalkPhase[] = ["idle", "connecting", "ready", "failed"];
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => typeof value === "string" && value !== "" ? value : null;

// A status the core sent. Anything it cannot read is no session: nothing is shown as sending
// on a value the UI does not understand.
export const readStatus = (value: unknown): TalkStatus => {
    if (!isRecord(value)) return IDLE_STATUS;
    const phase = PHASES.find(each => each === value.phase) ?? "idle";
    const id = value.session_id;
    return {
        session_id: typeof id === "number" && Number.isSafeInteger(id) ? id : null,
        phase,
        error: text(value.error),
        sending_audio: value.sending_audio === true,
        sending_screen: value.sending_screen === true,
        screen_source: text(value.screen_source),
    };
};

// A conversation is open (connecting or connected). Only then is anything sent, and only then
// does the indicator stay above the pages.
export const isActive = (status: TalkStatus): boolean =>
    status.session_id !== null && (status.phase === "connecting" || status.phase === "ready");

// An entry of /get/data/talk_ai_catalog: a service in the API family (cloud) or a server the user
// runs on this PC or in the LAN (local). `vision`: it can be shown the screen.
export interface TalkProvider {
    id: string;
    name: string;
    vision: boolean;
    cloud: boolean;
    destination: string;
    recommended_model: string | null;
    minimum_gpu_memory_gib: number | null;
    recommended_gpu_memory_gib: number | null;
}

const count = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export const readCatalog = (value: unknown): TalkProvider[] => Array.isArray(value)
    ? value.filter(isRecord).flatMap(item => {
        const id = text(item.id), name = text(item.name), destination = typeof item.destination === "string" ? item.destination : null;
        if (!id || !name || destination === null) return [];
        return [{
            id, name, destination,
            vision: item.vision === true,
            cloud: item.cloud === true,
            recommended_model: text(item.recommended_model),
            minimum_gpu_memory_gib: count(item.minimum_gpu_memory_gib),
            recommended_gpu_memory_gib: count(item.recommended_gpu_memory_gib),
        }];
    })
    : [];

// Whether the OpenAI key is set, and whether the system's credential store keeps it (otherwise
// it is held only until the app closes, ADR-013). The key itself never comes back to the UI.
export interface TalkKey {
    configured: boolean;
    stored: boolean;
}

export const readKey = (value: unknown): TalkKey | null =>
    isRecord(value) && typeof value.configured === "boolean" ? { configured: value.configured, stored: value.stored === true } : null;

// Where the screen is taken from (#969, decision 4): what chat reading captures (the VRChat window
// and the headset's view) and a whole monitor.
export const SCREEN_SOURCES = ["window", "vr", "monitor"] as const;
export type ScreenSource = typeof SCREEN_SOURCES[number];
export const isScreenSource = (value: unknown): value is ScreenSource => SCREEN_SOURCES.some(source => source === value);

export const readSources = (value: unknown): ScreenSource[] =>
    Array.isArray(value) ? SCREEN_SOURCES.filter(source => value.includes(source)) : [];

// Where the answer is played (#969, decision 3): the user's own output by default, or the
// virtual microphone so the others hear it too.
export type AnswerOutput = "headphones" | "virtual_mic";

// The managed route's TTS input (native/tts/src/settings.rs, MANAGED_TTS): the virtual microphone
// on Linux. A test holds the two equal.
export const MANAGED_TTS = "astarot.managed.tts";

// The virtual microphone the answer goes to: the output TTS speaks into, so it reaches VRChat the
// way read-aloud speech does. On the managed route (Linux) that is the route's TTS input; on a
// device route (Windows) the device chosen on the TTS page. null while none is set up.
export const virtualMicDevice = (settings: { routing?: unknown; output_device?: unknown } | null | undefined): string | null => {
    if (settings?.routing === "managed") return MANAGED_TTS;
    return text(settings?.output_device);
};

// The requests, in the shapes the core checks.
export const startRequest = (provider: Pick<TalkProvider, "id" | "destination">) =>
    ({ provider: provider.id, destination: provider.destination, consent: { audio: true } });

export interface AudioChoice {
    // null: the system's output. A device name otherwise.
    device: string | null;
    // The user agreed that the answer goes into the virtual microphone, where others hear it.
    share: boolean;
}

export const audioRequest = (sessionId: number, choice: AudioChoice) => ({
    session_id: sessionId,
    indicator_visible: true,
    output: choice.device,
    ...(choice.share ? { share_output: true } : {}),
});

export const screenRequest = (sessionId: number, destination: string, source: ScreenSource) => ({
    session_id: sessionId,
    destination,
    source,
    consent: { screen: true },
    indicator_visible: true,
});

export const sessionRequest = (sessionId: number) => ({ session_id: sessionId });

// The words of a code (the core's fixed codes, docs/spec/ipc-protocol.md): i18next takes the first
// key it has, so a code without words of its own gets the general sentence with the code.
export const errorKeys = (code: string): string[] => [`talk_ai.errors.${code}`, "talk_ai.errors.other"];

// The choices of the screen settings (#969, decision 5). The core takes any value in its range;
// one saved outside these (by hand in config.json) is offered too, so it is shown as it is.
export const INTERVAL_CHOICES_MS: readonly number[] = Object.freeze([500, 1000, 2000, 5000, 10000]);
export const LONG_EDGE_CHOICES: readonly number[] = Object.freeze([512, 768, 1024, 1536, 2048]);
export const DETAIL_CHOICES = ["auto", "low", "high"] as const;
export const DEFAULT_INTERVAL_MS = 1000;
export const DEFAULT_LONG_EDGE = 1024;
export const DEFAULT_DETAIL = "auto";

const RANGES = { interval: [250, 10_000], edge: [256, 2048] } as const;

export const choicesWith = (choices: readonly number[], current: unknown, range: "interval" | "edge"): number[] => {
    const [min, max] = RANGES[range];
    const saved = typeof current === "number" && Number.isSafeInteger(current) && current >= min && current <= max ? current : null;
    return saved === null || choices.includes(saved) ? [...choices] : [...choices, saved].sort((a, b) => a - b);
};

// Seconds for the interval's words: 500 → "0.5", 1000 → "1".
export const seconds = (ms: number): string => String(Math.round(ms / 100) / 10);
