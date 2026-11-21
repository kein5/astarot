import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { IDLE_AUDITION, RVC_AUDITION_SOURCE, auditionAfterFailure, auditionAfterState, auditionSentence } from "./voiceAudition.ts";
import type { AuditionProfile, AuditionView, RvcAuditionValues } from "./voiceAudition.ts";

// The voice auditions of the TTS and RVC catalogs (#415). One plays at a time in the core; the
// page shows the press waiting for its answer at once, and ignores repeat presses until it is
// answered.
const auditionAtom = atom<AuditionView>(IDLE_AUDITION);
// How long a press waits for the core's answer before it says it got none.
const ANSWER_TIMEOUT_MS = 5000;

export const useVoiceAudition = () => {
    const atoms = useStore();
    const [audition] = useAtom(auditionAtom);
    const { asyncStdoutToPython } = useStdoutToPython();

    const updateState = useCallback((value: unknown) => {
        atoms.set(auditionAtom, view => auditionAfterState(view, value));
    }, [atoms]);
    const fail = useCallback((code: unknown) => {
        atoms.set(auditionAtom, view => auditionAfterFailure(view, typeof code === "string" && code ? code : "voice_audition_failed"));
    }, [atoms]);

    // Only on the user's press: nothing here plays by itself.
    const begin = useCallback(async (card: Pick<AuditionView, "kind" | "profile" | "entry">, body: Record<string, unknown>) => {
        // The store, not this render's value: a second press may come before the next render.
        if (atoms.get(auditionAtom).phase === "pending") return false;
        const pending: AuditionView = { ...IDLE_AUDITION, ...card, phase: "pending", run: atoms.get(auditionAtom).run };
        atoms.set(auditionAtom, pending);
        setTimeout(() => {
            if (atoms.get(auditionAtom) === pending) fail("voice_audition_unconfirmed");
        }, ANSWER_TIMEOUT_MS);
        const sent = await asyncStdoutToPython("/run/start_voice_audition", body);
        if (sent === false) fail("backend_unavailable");
        return sent;
    }, [atoms, asyncStdoutToPython, fail]);
    // A TTS card: the profile's fixed sentence.
    const start = useCallback((profile: AuditionProfile) =>
        begin({ kind: "tts", profile, entry: null }, { kind: "tts", profile, sentence: auditionSentence(profile) }), [begin]);
    // An RVC card: its model by id, with the form's pitch and index rate.
    const startRvc = useCallback((entry: string, values: RvcAuditionValues) =>
        begin({ kind: "rvc", profile: null, entry }, { kind: "rvc", entry, source: RVC_AUDITION_SOURCE, pitch: values.pitch, index_rate: values.index_rate }), [begin]);
    const stop = useCallback(() => asyncStdoutToPython("/run/stop_voice_audition"), [asyncStdoutToPython]);
    const poll = useCallback(() => asyncStdoutToPython("/get/data/voice_audition_state"), [asyncStdoutToPython]);

    const reset = useCallback(() => atoms.set(auditionAtom, IDLE_AUDITION), [atoms]);
    // The engine stopped: an audition in progress ended with it.
    const backendStopped = useCallback(() => {
        atoms.set(auditionAtom, view => view.phase === "idle" ? view : { ...view, phase: "idle", stage: null, error: "backend_unavailable" });
    }, [atoms]);

    return { audition, start, startRvc, stop, poll, updateState, fail, reset, backendStopped };
};
