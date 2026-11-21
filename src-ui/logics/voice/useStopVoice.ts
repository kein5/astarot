import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { IDLE_STOP, STOPPED_MS, STOP_ANSWER_MS } from "./stopVoice.ts";
import type { StopPress } from "./stopVoice.ts";

// The top bar's stop and the hotkey that presses it (#937). Kept outside the bars: the main page
// and the settings each draw one, and a press made on one is answered on both.
const stopAtom = atom<StopPress>(IDLE_STOP);

export const useStopVoice = () => {
    const atoms = useStore();
    const [stop] = useAtom(stopAtom);
    const { asyncStdoutToPython } = useStdoutToPython();

    // The core's answer to /run/stop_voice (useReceiveRoutes): "stopped" stays a moment, then the
    // stop is idle again (unless pressed since).
    const answered = useCallback(() => {
        const current = atoms.get(stopAtom);
        if (current.phase !== "stopping") return;
        const stopped = { phase: "stopped" as const, press: current.press };
        atoms.set(stopAtom, stopped);
        setTimeout(() => { if (atoms.get(stopAtom) === stopped) atoms.set(stopAtom, { phase: "idle", press: stopped.press }); }, STOPPED_MS);
    }, [atoms]);
    // Refused, not sent or not answered in time: idle at once; a notice says why.
    const failed = useCallback(() => {
        if (atoms.get(stopAtom).phase === "stopping") atoms.set(stopAtom, current => ({ phase: "idle", press: current.press }));
    }, [atoms]);

    const press = useCallback(async () => {
        // The store, not this render's value: a second press may come before the next render.
        const current = atoms.get(stopAtom);
        if (current.phase === "stopping") return false;
        const pressed = { phase: "stopping" as const, press: current.press + 1 };
        atoms.set(stopAtom, pressed);
        setTimeout(() => { if (atoms.get(stopAtom) === pressed) failed(); }, STOP_ANSWER_MS);
        const sent = await asyncStdoutToPython("/run/stop_voice");
        if (sent === false) failed();
        return sent;
    }, [atoms, asyncStdoutToPython, failed]);

    // The engine stopped or restarted: nothing waits for an answer any more.
    const reset = useCallback(() => atoms.set(stopAtom, current => ({ phase: "idle", press: current.press })), [atoms]);

    return { stop, press, answered, failed, reset };
};
