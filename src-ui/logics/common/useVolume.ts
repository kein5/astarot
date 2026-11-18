import {
    Atom_MicVolume,
    Atom_SpeakerVolume,
    useStore_MicThresholdCheckStatus,
    useStore_SpeakerThresholdCheckStatus,
} from "@store";

import { useStdoutToPython } from "@useStdoutToPython";
import { useSetAtom } from "jotai";
import { updateMeterValue } from "./meterValue.ts";

// A meter's level: the backend's number, or "0" when a check stops.
type MeterLevel = number | string;

export const useVolume = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const setMicVolume = useSetAtom(Atom_MicVolume);
    const setSpeakerVolume = useSetAtom(Atom_SpeakerVolume);
    // A new level is always confirmed ("ok"), as updateMeterValue's default.
    const updateMicVolume = (value: MeterLevel) => setMicVolume(previous => updateMeterValue(previous, value, "ok"));
    const updateSpeakerVolume = (value: MeterLevel) => setSpeakerVolume(previous => updateMeterValue(previous, value, "ok"));
    const {
        currentMicThresholdCheckStatus,
        updateMicThresholdCheckStatus,
        pendingMicThresholdCheckStatus,
    } = useStore_MicThresholdCheckStatus();
    const {
        currentSpeakerThresholdCheckStatus,
        updateSpeakerThresholdCheckStatus,
        pendingSpeakerThresholdCheckStatus,
    } = useStore_SpeakerThresholdCheckStatus();

    return {
        volumeCheckStart_Mic: () => {
            pendingMicThresholdCheckStatus();
            asyncStdoutToPython("/set/enable/check_mic_threshold");
        },
        volumeCheckStop_Mic: () => {
            pendingMicThresholdCheckStatus();
            asyncStdoutToPython("/set/disable/check_mic_threshold");
        },
        updateVolumeVariable_Mic: (payload: MeterLevel) => {
            updateMicVolume(payload);
        },
        currentMicThresholdCheckStatus: currentMicThresholdCheckStatus,
        updateMicThresholdCheckStatus: (payload: boolean) => {
            updateMicThresholdCheckStatus(payload);
            if (payload === false) updateMicVolume("0");
        },

        volumeCheckStart_Speaker: () => {
            updateSpeakerVolume("0");
            pendingSpeakerThresholdCheckStatus();
            asyncStdoutToPython("/set/enable/check_speaker_threshold");
        },
        volumeCheckStop_Speaker: () => {
            pendingSpeakerThresholdCheckStatus();
            asyncStdoutToPython("/set/disable/check_speaker_threshold");
        },
        updateVolumeVariable_Speaker: (payload: MeterLevel) => {
            updateSpeakerVolume(payload);
        },
        currentSpeakerThresholdCheckStatus: currentSpeakerThresholdCheckStatus,
        updateSpeakerThresholdCheckStatus: (payload: boolean) => {
            updateSpeakerThresholdCheckStatus(payload);
            if (payload === false) updateSpeakerVolume("0");
        }

    };
};
