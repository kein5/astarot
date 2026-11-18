import { useCallback, useRef } from "react";
import { useStore_SpeakerNames } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";
import { applySpeakerNames } from "./speakerNames.ts";
import type { SessionSpeakerNames, SpeakerNames } from "./speakerNames.ts";

// The names of the voices of a realtime session (#447). The names change when the core accepts
// them (its answer to /set/data/speaker_names), so the log, the desktop captions and the VR large
// log show the same names.
export const useSpeakerNames = () => {
    const { currentSpeakerNames, updateSpeakerNames } = useStore_SpeakerNames();

    const updateNames = (answer: unknown) => {
        updateSpeakerNames(current => applySpeakerNames(current.data, answer));
    };

    return { currentSpeakerNames, updateNames };
};

// For the log: the names of every session, and a way to name the voices of one row. The
// function stays the same between renders, so the memoised rows are not drawn again for it.
export const useSpeakerNaming = (): {
    speakerNames: SpeakerNames;
    nameSpeakers: (namespace: string, names: SessionSpeakerNames) => void;
} => {
    const { currentSpeakerNames } = useStore_SpeakerNames();
    const { asyncStdoutToPython } = useStdoutToPython();
    const latest = useRef({ names: currentSpeakerNames.data, send: asyncStdoutToPython });
    latest.current = { names: currentSpeakerNames.data, send: asyncStdoutToPython };
    // The row's voices are merged into the names the session has: the core takes the whole set.
    const nameSpeakers = useCallback((namespace: string, names: SessionSpeakerNames) => {
        const { names: current, send } = latest.current;
        void send("/set/data/speaker_names", { namespace, names: { ...current[namespace], ...names } });
    }, []);
    return { speakerNames: currentSpeakerNames.data, nameSpeakers };
};
