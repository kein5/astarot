import { atom, useAtom } from "jotai";
import { useCallback } from "react";
import { useStdoutToPython } from "@useStdoutToPython";

// The first-run setup (#557).
// notice: whether it may still open by itself at start-up (null: not known yet).
// opened: it was opened by hand (from the first screen), whatever the notice says.
// settled: for this run it has been put away, or it will not open by itself. The virtual
// microphone guide, which may also open by itself, waits for this: one dialog at a time.
const noticeAtom = atom<boolean | null>(null);
const openedAtom = atom(false);
const settledAtom = atom(false);

export const useFirstRunSetup = () => {
    const [notice, setNotice] = useAtom(noticeAtom);
    const [opened, setOpened] = useAtom(openedAtom);
    const [settled, setSettled] = useAtom(settledAtom);
    const { asyncStdoutToPython } = useStdoutToPython();

    const updateNotice = useCallback((value: unknown) => setNotice(value === true), [setNotice]);
    // Finished, or "do not show again": it does not open by itself any more.
    const dismissNotice = useCallback(() => {
        setNotice(false);
        return asyncStdoutToPython("/set/disable/first_run_setup");
    }, [setNotice, asyncStdoutToPython]);
    const openSetup = useCallback(() => setOpened(true), [setOpened]);
    const closeSetup = useCallback(() => { setOpened(false); setSettled(true); }, [setOpened, setSettled]);
    const markSettled = useCallback(() => setSettled(true), [setSettled]);
    const reset = useCallback(() => { setNotice(null); setOpened(false); setSettled(false); }, [setNotice, setOpened, setSettled]);

    return { notice, opened, settled, updateNotice, dismissNotice, openSetup, closeSetup, markSettled, reset };
};
