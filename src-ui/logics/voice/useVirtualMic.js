import { atom, useAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import { normalizeVirtualMicStatus, normalizeVirtualMicResult, normalizeVirtualMicLevel } from "./virtualMic.js";

// The virtual microphone guide and its check on Windows (#321).
// notice: whether the guide may still open by itself at start-up (null: not known yet).
// status: the cables found and the TTS output (null: not read yet).
// check: the test tone's phase, its live level and its outcome.
// opened: the guide was opened from the settings, whatever the notice says.
const noticeAtom = atom(null);
const statusAtom = atom(null);
const IDLE = { phase: "idle", playback: null, level: 0, result: null, error: null };
const checkAtom = atom(IDLE);
const openedAtom = atom(false);

export const useVirtualMic = () => {
    const atoms = useStore();
    const [notice, setNotice] = useAtom(noticeAtom);
    const [status, setStatus] = useAtom(statusAtom);
    const [check, setCheck] = useAtom(checkAtom);
    const [opened, setOpened] = useAtom(openedAtom);
    const { asyncStdoutToPython } = useStdoutToPython();

    const updateNotice = useCallback(value => setNotice(value === true), [setNotice]);
    const updateStatus = useCallback(value => setStatus(normalizeVirtualMicStatus(value)), [setStatus]);
    // Only the check under way moves the meter; a late level from an earlier one does not.
    const updateLevel = useCallback(value => {
        const level = normalizeVirtualMicLevel(value);
        if (!level) return;
        setCheck(previous => previous.phase === "running" && previous.playback === level.playback
            ? { ...previous, level: level.level } : previous);
    }, [setCheck]);
    const updateResult = useCallback(value => {
        const result = normalizeVirtualMicResult(value);
        setCheck(previous => previous.phase !== "running" ? previous
            : result ? { ...previous, phase: "done", level: 0, result, error: null }
                : { ...previous, phase: "failed", level: 0, error: "invalid" });
    }, [setCheck]);
    const failCheck = useCallback(code => {
        setCheck(previous => previous.phase !== "running" ? previous
            : { ...previous, phase: "failed", level: 0, error: typeof code === "string" && code ? code : "failed" });
    }, [setCheck]);

    const refreshStatus = useCallback(() => asyncStdoutToPython("/get/data/virtual_mic_status"), [asyncStdoutToPython]);
    const startCheck = useCallback(async playback => {
        // The store, not this render's value: a second press may come before the next render.
        if (atoms.get(checkAtom).phase === "running" || typeof playback !== "string") return false;
        setCheck({ ...IDLE, phase: "running", playback });
        const sent = await asyncStdoutToPython("/run/virtual_mic_test", { playback });
        if (sent === false) failCheck("backend_unavailable");
        return sent;
    }, [atoms, setCheck, asyncStdoutToPython, failCheck]);
    const resetCheck = useCallback(() => setCheck(IDLE), [setCheck]);

    // Finished, or "do not show again": it does not open by itself any more.
    const dismissNotice = useCallback(() => {
        setNotice(false);
        return asyncStdoutToPython("/set/disable/virtual_mic_notice");
    }, [setNotice, asyncStdoutToPython]);
    const openGuide = useCallback(() => setOpened(true), [setOpened]);
    const closeGuide = useCallback(() => { setOpened(false); setCheck(IDLE); }, [setOpened, setCheck]);

    const reset = useCallback(() => {
        setNotice(null);
        setStatus(null);
        setCheck(IDLE);
    }, [setNotice, setStatus, setCheck]);
    // The backend stopped: a check under way can no longer report.
    const backendStopped = useCallback(() => failCheck("backend_unavailable"), [failCheck]);

    return { notice, status, check, opened, updateNotice, updateStatus, updateLevel, updateResult, failCheck,
        refreshStatus, startCheck, resetCheck, dismissNotice, openGuide, closeGuide, reset, backendStopped };
};
