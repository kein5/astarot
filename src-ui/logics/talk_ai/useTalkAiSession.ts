import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { audioRequest, isActive, readCatalog, readKey, readSources, screenRequest, sessionRequest, startRequest, IDLE_STATUS } from "./talkAi.ts";
import type { AnswerOutput, AudioChoice, ScreenSource, TalkProvider } from "./talkAi.ts";
import { AUDIO, INITIAL_VIEW, KEY, SCREEN, SCREEN_STOP, START, STATUS, STOP, answered, refused, withStatus } from "./talkView.ts";
import type { TalkView } from "./talkView.ts";

export type { TalkView } from "./talkView.ts";

const viewAtom = atom<TalkView>(INITIAL_VIEW);

export const useTalkAiSession = () => {
    const atoms = useStore();
    const [view] = useAtom(viewAtom);
    const { asyncStdoutToPython } = useStdoutToPython();

    const set = useCallback((next: (view: TalkView) => TalkView) => atoms.set(viewAtom, next), [atoms]);
    const send = useCallback(async (endpoint: string, data?: unknown) => {
        const sent = await asyncStdoutToPython(endpoint, data);
        if (sent === false) set(current => refused(current, "backend_unavailable", endpoint));
        return sent;
    }, [asyncStdoutToPython, set]);

    const updateCatalog = useCallback((value: unknown) => set(current => ({ ...current, catalog: readCatalog(value) })), [set]);
    const updateKey = useCallback((value: unknown) => set(current => ({ ...current, key: readKey(value) ?? current.key })), [set]);
    const answerKey = useCallback((value: unknown) => set(current => ({ ...current, pending: null, error: null, key: readKey(value) ?? current.key })), [set]);
    const updateSources = useCallback((value: unknown) => set(current => ({ ...current, sources: readSources(value) })), [set]);
    const updateStatus = useCallback((value: unknown) => set(current => withStatus(current, value)), [set]);
    const answer = useCallback((value: unknown) => set(current => answered(current, value)), [set]);

    // A refused request. A voice that could not start leaves a session nobody talks in: it ends.
    const fail = useCallback((code: string, endpoint: string) => {
        set(current => refused(current, code, endpoint));
        if (endpoint === AUDIO) void asyncStdoutToPython(STOP);
    }, [set, asyncStdoutToPython]);

    // Starts a conversation the user consented to, with the voice to start once it is ready.
    const start = useCallback(async (provider: TalkProvider, choice: AudioChoice) => {
        const current = atoms.get(viewAtom);
        if (current.pending || isActive(current.status)) return false;
        set(view => ({ ...view, pending: "start", error: null, partner: { id: provider.id, name: provider.name }, audio: choice, screen: null }));
        return send(START, startRequest(provider));
    }, [atoms, set, send]);

    // Called by the indicator once it is drawn: the voice it shows starts now.
    const sendAudio = useCallback(() => {
        const current = atoms.get(viewAtom);
        const { status, audio } = current;
        if (!audio || status.phase !== "ready" || status.session_id === null || current.pending === "audio") return;
        set(view => ({ ...view, pending: "audio", audio: null }));
        void send(AUDIO, audioRequest(status.session_id, audio));
    }, [atoms, set, send]);

    // Shares the screen the user consented to, once the indicator shows it.
    const share = useCallback((source: ScreenSource, destination: string) => {
        const current = atoms.get(viewAtom);
        if (current.pending || current.status.phase !== "ready" || current.status.screen_source) return;
        set(view => ({ ...view, error: null, screen: { source, destination, sent: false } }));
    }, [atoms, set]);

    const sendScreen = useCallback(() => {
        const { status, screen, pending } = atoms.get(viewAtom);
        if (!screen || screen.sent || pending || status.phase !== "ready" || status.session_id === null) return;
        set(view => ({ ...view, pending: "screen", screen: view.screen && { ...view.screen, sent: true } }));
        void send(SCREEN, screenRequest(status.session_id, screen.destination, screen.source));
    }, [atoms, set, send]);

    const stop = useCallback(() => {
        set(view => ({ ...view, pending: "stop", audio: null, screen: null }));
        return send(STOP);
    }, [set, send]);

    // Stopping the screen ends the conversation as well (#1099, decision 2).
    const stopScreen = useCallback(() => {
        const { status } = atoms.get(viewAtom);
        if (status.session_id === null) return Promise.resolve(false);
        set(view => ({ ...view, pending: "stop", audio: null, screen: null }));
        return send(SCREEN_STOP, sessionRequest(status.session_id));
    }, [atoms, set, send]);

    const control = useCallback((endpoint: string) => {
        const { status } = atoms.get(viewAtom);
        if (status.session_id === null || status.phase !== "ready") return Promise.resolve(false);
        return send(endpoint, sessionRequest(status.session_id));
    }, [atoms, send]);
    const interrupt = useCallback(() => control("/set/data/talk_ai_interrupt"), [control]);
    const endTurn = useCallback(() => control("/set/data/talk_ai_end_turn"), [control]);

    // A key to keep, or null to forget the kept one.
    const setKey = useCallback((key: string | null) => {
        if (atoms.get(viewAtom).pending) return Promise.resolve(false);
        set(view => ({ ...view, pending: "key", error: null }));
        return send(KEY, key);
    }, [atoms, set, send]);

    const setOutput = useCallback((output: AnswerOutput) => set(view => ({ ...view, output })), [set]);
    const setSource = useCallback((source: ScreenSource) => set(view => ({ ...view, source })), [set]);
    const clearError = useCallback(() => set(view => ({ ...view, error: null })), [set]);
    const poll = useCallback(() => asyncStdoutToPython(STATUS), [asyncStdoutToPython]);
    const reset = useCallback(() => set(() => INITIAL_VIEW), [set]);
    // The engine stopped, and the conversation with it.
    const backendStopped = useCallback(() => set(view => ({ ...view, status: IDLE_STATUS, pending: null, partner: null, audio: null, screen: null })), [set]);

    return {
        view, start, sendAudio, share, sendScreen, stop, stopScreen, interrupt, endTurn, setKey, setOutput, setSource, clearError, poll,
        updateCatalog, updateKey, answerKey, updateSources, updateStatus, answer, fail, reset, backendStopped,
    };
};
