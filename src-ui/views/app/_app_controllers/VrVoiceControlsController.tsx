import { useEffect } from "react";
import { useStore_VrVoiceControls } from "@store";
import { voiceStopState, voiceSwitchStates } from "../../../logics/voice/voiceActions.ts";

// Keeps what the VR panel's launcher shows of the text to speech switch and the stop (#1314, V-4):
// the main window's own switch and stop publish their state (voiceActions.ts), and this puts both
// in one atom that goes to the panel with the rest of its state (vrPanelWire.ts).
export const VrVoiceControlsController = () => {
    const { updateVrVoiceControls } = useStore_VrVoiceControls();
    useEffect(() => {
        const update = () => updateVrVoiceControls({ tts: voiceSwitchStates.get().tts, stop: voiceStopState.get() });
        update();
        const offSwitches = voiceSwitchStates.subscribe(update);
        const offStop = voiceStopState.subscribe(update);
        return () => { offSwitches(); offStop(); };
    }, []);
    return null;
};
