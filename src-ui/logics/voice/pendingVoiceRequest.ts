// The commands that turn TTS or direct voice on (true) or off (false).
const intents: Record<string, boolean> = {
    "/run/enable_tts": true, "/run/disable_tts": false,
    "/run/start_direct_voice": true, "/run/stop_direct_voice": false,
};

// A switch request still waiting for its answer; `intent` is the state it asked for.
export type PendingVoiceRequest = { intent: boolean; [key: string]: unknown };

// An error for an older ON must not release a newer OFF (or vice versa).
// Poll errors and timeout notices are not terminal command responses.
export const pendingAfterVoiceFailure = <P extends PendingVoiceRequest>(pending: P | null | undefined, endpoint: string): P | null | undefined =>
    pending && Object.hasOwn(intents, endpoint) && pending.intent === intents[endpoint] ? null : pending;

export const stoppedVoiceStatus = <T extends object>(value: T): T & { tts_stopping: boolean; tts_server_starting: boolean } =>
    ({ ...value, tts_stopping: false, tts_server_starting: false });
export const stoppedDirectState = <T extends object>(value: T): T & { requested: boolean; pending: boolean; stopping: boolean } =>
    ({ ...value, requested: false, pending: false, stopping: false });
