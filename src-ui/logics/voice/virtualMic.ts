// Shapes of what the backend sends for the virtual microphone guide (#321), checked
// before the UI uses them. Anything else reads as "not known".

// A virtual cable: the playback device TTS plays into and the recording device VRChat hears.
export type VirtualMicCable = { playback: string; recording: string; playback_label: string; recording_label: string };

export type VirtualMicStatus = {
    supported: boolean;
    cables: VirtualMicCable[];
    error: string | null;
    tts_output: string | null;
    tts_output_is_cable: boolean;
};

export type VirtualMicLevel = { playback: string; level: number };

export type VirtualMicResult = { heard: boolean; stopped: boolean; peak_dbfs: number | null; recording: string | null };

// The replies as they arrive, before they are checked.
export type VirtualMicCableReply = { playback?: unknown; recording?: unknown; playback_label?: unknown; recording_label?: unknown } | null | undefined;
export type VirtualMicStatusReply = {
    supported?: unknown;
    cables?: unknown;
    error?: unknown;
    tts_output?: unknown;
    tts_output_is_cable?: unknown;
} | null | undefined;
export type VirtualMicLevelReply = { playback?: unknown; level?: unknown } | null | undefined;
export type VirtualMicResultReply = { heard?: unknown; stopped?: unknown; peak_dbfs?: unknown; recording?: unknown } | null | undefined;

// A non-empty string. (An empty one also reads as "not text", which the callers rely on.)
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const cable = (value: VirtualMicCableReply): VirtualMicCable | null => value && typeof value === "object" && text(value.playback) && text(value.recording)
    ? { playback: value.playback, recording: value.recording,
        playback_label: text(value.playback_label) ? value.playback_label : value.playback,
        recording_label: text(value.recording_label) ? value.recording_label : value.recording }
    : null;

export const normalizeVirtualMicStatus = (value: VirtualMicStatusReply): VirtualMicStatus | null => {
    if (!value || typeof value !== "object" || typeof value.supported !== "boolean" || !Array.isArray(value.cables)) return null;
    const cables = value.cables.map(cable);
    if (cables.includes(null)) return null;
    return {
        supported: value.supported,
        // No null is left: the check above returned for any cable that did not fit.
        cables: cables as VirtualMicCable[],
        error: text(value.error) ? value.error : null,
        tts_output: text(value.tts_output) ? value.tts_output : null,
        tts_output_is_cable: value.tts_output_is_cable === true,
    };
};

export const normalizeVirtualMicLevel = (value: VirtualMicLevelReply): VirtualMicLevel | null => value && typeof value === "object" && text(value.playback)
    && typeof value.level === "number" && Number.isFinite(value.level)
    ? { playback: value.playback, level: Math.min(1, Math.max(0, value.level)) }
    : null;

export const normalizeVirtualMicResult = (value: VirtualMicResultReply): VirtualMicResult | null => value && typeof value === "object"
    && typeof value.heard === "boolean" && typeof value.stopped === "boolean"
    ? { heard: value.heard, stopped: value.stopped,
        peak_dbfs: typeof value.peak_dbfs === "number" && Number.isFinite(value.peak_dbfs) ? value.peak_dbfs : null,
        recording: text(value.recording) ? value.recording : null }
    : null;

// Which cable to check: the one TTS already plays into, or else the first one found.
export const preferredCable = (status: VirtualMicStatus | null | undefined): VirtualMicCable | null => {
    if (!status?.cables?.length) return null;
    if (status.tts_output_is_cable && status.tts_output) {
        const name = deviceName(status.tts_output);
        const match = status.cables.find(item => item.playback === status.tts_output || deviceName(item.playback) === name);
        if (match) return match;
    }
    return status.cables[0];
};

// The device name inside a backend identity (["host", "name"]), or the text itself.
export const deviceName = (identity: string): string => {
    try {
        const value: unknown = JSON.parse(identity);
        return Array.isArray(value) && value.length === 2 && typeof value[1] === "string" ? value[1] : identity;
    } catch {
        return identity;
    }
};
