// Shapes of what the backend sends for the virtual microphone guide (#321), checked
// before the UI uses them. Anything else reads as "not known".

const text = value => typeof value === "string" && value.length > 0;

const cable = value => value && typeof value === "object" && text(value.playback) && text(value.recording)
    ? { playback: value.playback, recording: value.recording,
        playback_label: text(value.playback_label) ? value.playback_label : value.playback,
        recording_label: text(value.recording_label) ? value.recording_label : value.recording }
    : null;

export const normalizeVirtualMicStatus = value => {
    if (!value || typeof value !== "object" || typeof value.supported !== "boolean" || !Array.isArray(value.cables)) return null;
    const cables = value.cables.map(cable);
    if (cables.includes(null)) return null;
    return {
        supported: value.supported,
        cables,
        error: text(value.error) ? value.error : null,
        tts_output: text(value.tts_output) ? value.tts_output : null,
        tts_output_is_cable: value.tts_output_is_cable === true,
    };
};

export const normalizeVirtualMicLevel = value => value && typeof value === "object" && text(value.playback)
    && typeof value.level === "number" && Number.isFinite(value.level)
    ? { playback: value.playback, level: Math.min(1, Math.max(0, value.level)) }
    : null;

export const normalizeVirtualMicResult = value => value && typeof value === "object"
    && typeof value.heard === "boolean" && typeof value.stopped === "boolean"
    ? { heard: value.heard, stopped: value.stopped,
        peak_dbfs: typeof value.peak_dbfs === "number" && Number.isFinite(value.peak_dbfs) ? value.peak_dbfs : null,
        recording: text(value.recording) ? value.recording : null }
    : null;

// Which cable to check: the one TTS already plays into, or else the first one found.
export const preferredCable = status => {
    if (!status?.cables?.length) return null;
    if (status.tts_output_is_cable && status.tts_output) {
        const name = deviceName(status.tts_output);
        const match = status.cables.find(item => item.playback === status.tts_output || deviceName(item.playback) === name);
        if (match) return match;
    }
    return status.cables[0];
};

// The device name inside a backend identity (["host", "name"]), or the text itself.
export const deviceName = identity => {
    try {
        const value = JSON.parse(identity);
        return Array.isArray(value) && value.length === 2 && typeof value[1] === "string" ? value[1] : identity;
    } catch {
        return identity;
    }
};

// Whether the guide opens by itself at start-up: Windows, not yet finished or put away for
// good, and no cable found. A list that could not be read does not count as "no cable".
export const guideOpensByItself = (notice, status) => notice === true && status?.supported === true
    && status.error === null && status.cables.length === 0;
