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
// (MainFunctionSwitch.jsx), which publish it here on every render; nothing else decides it.
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
