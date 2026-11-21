import { useEffect } from "react";
import { atom, useAtom } from "jotai";
import { useStore_IsMainPageCompactMode, useStore_IsBreakPoint, useStore_IsOpenedTranslatorSelector } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";

// Shared by the rail and its toggle; never persisted to the backend.
const expandedWhileNarrow = atom(false);
// The full rail shown for the translator list in a wide window whose icon rail is the saved
// choice (#562): while the list is open, and never saved, so the choice stays as the user left it.
const expandedForList = atom(false);

export const useIsMainPageCompactMode = () => {
    const { currentIsBreakPoint } = useStore_IsBreakPoint();
    const isAutomaticCompact = currentIsBreakPoint.data;
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentIsMainPageCompactMode, updateIsMainPageCompactMode } = useStore_IsMainPageCompactMode();
    const [isExpandedWhileNarrow, setExpandedWhileNarrow] = useAtom(expandedWhileNarrow);
    const [isExpandedForList, setExpandedForList] = useAtom(expandedForList);
    const { currentIsOpenedTranslatorSelector } = useStore_IsOpenedTranslatorSelector();
    const listOpen = currentIsOpenedTranslatorSelector.data === true;

    useEffect(() => {
        if (!isAutomaticCompact) setExpandedWhileNarrow(false);
        else setExpandedForList(false);
    }, [isAutomaticCompact, setExpandedWhileNarrow, setExpandedForList]);
    // The list closed (an engine chosen, or closed): the saved icon rail again.
    useEffect(() => {
        if (!listOpen) setExpandedForList(false);
    }, [listOpen, setExpandedForList]);

    const getIsMainPageCompactMode = () => {
        asyncStdoutToPython("/get/data/main_window_sidebar_compact_mode");
    };

    const toggleIsMainPageCompactMode = () => {
        if (isAutomaticCompact) {
            setExpandedWhileNarrow(expanded => !expanded);
            return;
        }
        // The rail widened for the list goes back to the saved icon rail, which stays saved.
        if (isExpandedForList) {
            setExpandedForList(false);
            return;
        }
        if (currentIsMainPageCompactMode.data) {
            asyncStdoutToPython("/set/disable/main_window_sidebar_compact_mode");
        } else {
            asyncStdoutToPython("/set/enable/main_window_sidebar_compact_mode");
        }
    };

    // The rail opened over the conversation in a narrow window closes; nothing is saved.
    const closeOverlay = () => {
        if (isAutomaticCompact) setExpandedWhileNarrow(false);
    };

    // Shows the full rail when something in it has to open (the translator list): over
    // the conversation in a narrow window; in a wide window whose icon rail is the saved choice,
    // for as long as the list is open, without saving (#562).
    const expandSidebar = () => {
        if (isAutomaticCompact) {
            setExpandedWhileNarrow(true);
        } else if (currentIsMainPageCompactMode.data) {
            setExpandedForList(true);
        }
    };

    return {
        currentIsMainPageCompactMode: { ...currentIsMainPageCompactMode,
            data: isAutomaticCompact ? !isExpandedWhileNarrow : currentIsMainPageCompactMode.data === true && !isExpandedForList },
        isAutomaticCompact,
        getIsMainPageCompactMode,
        toggleIsMainPageCompactMode,
        closeOverlay,
        expandSidebar,
        updateIsMainPageCompactMode,
    };
};
