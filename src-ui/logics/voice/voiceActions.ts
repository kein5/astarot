// A control's current handler, or null before the control has rendered.
export type VoiceAction = (() => unknown) | null;
export type VoiceActions = { toggleTts: VoiceAction; toggleRvc: VoiceAction; stop: VoiceAction; toggleMute: VoiceAction };

// The voice controls a hotkey can reach. The main window's switches and stop
// actions publish their current handlers here on every render, so a shortcut
// that was registered earlier acts on the state of the moment it is pressed,
// with the same checks and notices as the control on screen.
export const voiceActions: VoiceActions = { toggleTts: null, toggleRvc: null, stop: null, toggleMute: null };

// The TTS and voice changer switches as the main window shows them, for other views of the same
// switches (the tray companion's handle). Their state is worked out by the main page's switches
// (MainFunctionSwitch.tsx), which publish it here on every render; nothing else decides it.
export type VoiceSwitchState = { readonly on: boolean; readonly pending: boolean };
export type VoiceSwitchStates = { readonly tts: VoiceSwitchState; readonly rvc: VoiceSwitchState };

const OFF: VoiceSwitchState = Object.freeze({ on: false, pending: false });
let currentStates: VoiceSwitchStates = Object.freeze({ tts: OFF, rvc: OFF });
const stateListeners = new Set<() => void>();
const same = (a: VoiceSwitchState, b: VoiceSwitchState) => a.on === b.on && a.pending === b.pending;

export const voiceSwitchStates = {
    get: (): VoiceSwitchStates => currentStates,
    publish: (next: VoiceSwitchStates): void => {
        if (same(next.tts, currentStates.tts) && same(next.rvc, currentStates.rvc)) return;
        currentStates = Object.freeze({ tts: { ...next.tts }, rvc: { ...next.rvc } });
        for (const listener of stateListeners) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
        stateListeners.add(listener);
        return () => { stateListeners.delete(listener); };
    },
};

// The top bar's stop as the main window shows it (StopActions.tsx publishes it on every render):
// whether there is something to stop, and how a press is being answered (stopVoice.ts).
export type VoiceStopState = { readonly offered: boolean; readonly phase: "idle" | "stopping" | "stopped" };
const NO_STOP: VoiceStopState = Object.freeze({ offered: false, phase: "idle" });
let currentStop: VoiceStopState = NO_STOP;
const stopListeners = new Set<() => void>();

export const voiceStopState = {
    get: (): VoiceStopState => currentStop,
    publish: (next: VoiceStopState): void => {
        if (next.offered === currentStop.offered && next.phase === currentStop.phase) return;
        currentStop = Object.freeze({ offered: next.offered, phase: next.phase });
        for (const listener of stopListeners) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
        stopListeners.add(listener);
        return () => { stopListeners.delete(listener); };
    },
};

// What the VR panel's launcher shows of the text to speech switch and the stop (#1314, V-4).
export type VrVoiceControls = { readonly tts: VoiceSwitchState; readonly stop: VoiceStopState };
export const NO_VR_VOICE_CONTROLS: VrVoiceControls = Object.freeze({ tts: OFF, stop: NO_STOP });

// What the launcher's buttons ask for (vr-panel-voice): the same switch and stop as the main window's,
// with today's state; nothing else.
export type VrVoiceAction = "toggle_tts" | "stop";
export const runVrVoiceAction = (action: unknown): boolean => {
    if (action === "toggle_tts") { voiceActions.toggleTts?.(); return true; }
    if (action === "stop") { voiceActions.stop?.(); return true; }
    return false;
};
