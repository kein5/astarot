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

// Which cable to check: the one TTS already plays into, or else the first one found. The saved
// output matches its cable as the core matched it when it said the output is a cable: under any
// host, and under a name MME cut short (#1262).
export const preferredCable = (status: VirtualMicStatus | null | undefined): VirtualMicCable | null => {
    if (!status?.cables?.length) return null;
    const output = status.tts_output;
    if (status.tts_output_is_cable && output) {
        const match = status.cables.find(item => sameOutput(item.playback, output));
        if (match) return match;
    }
    return status.cables[0];
};

// MME cuts device names at this many characters (MME_NAME_LIMIT in native/audio-routing/src/naming.rs).
export const MME_NAME_LIMIT = 31;

// Whether two names or identities are one device, whichever host lists them: the same name, or a
// name cut at MME's limit that the other one begins with. The core's same_output
// (native/audio-routing/src/naming.rs), which decides tts_output_is_cable: an output saved under
// MME by an earlier version is cut there, such as ["MME", "CABLE Input (VB-Audio Virtual C"].
// Characters are counted as the core counts them, by code point.
export const sameOutput = (first: string, second: string): boolean => {
    const one = deviceName(first), other = deviceName(second);
    const [short, long] = [...other].length < [...one].length ? [other, one] : [one, other];
    return short === long || ([...short].length === MME_NAME_LIMIT && long.startsWith(short));
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
