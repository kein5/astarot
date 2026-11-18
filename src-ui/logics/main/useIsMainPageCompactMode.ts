import { useEffect } from "react";
import { atom, useAtom } from "jotai";
import { useStore_IsMainPageCompactMode, useStore_IsBreakPoint } from "@store";
import { useStdoutToPython } from "@useStdoutToPython";

// Shared by the rail and its toggle; never persisted to the backend.
const expandedWhileNarrow = atom(false);

export const useIsMainPageCompactMode = () => {
    const { currentIsBreakPoint } = useStore_IsBreakPoint();
    const isAutomaticCompact = currentIsBreakPoint.data;
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentIsMainPageCompactMode, updateIsMainPageCompactMode } = useStore_IsMainPageCompactMode();
    const [isExpandedWhileNarrow, setExpandedWhileNarrow] = useAtom(expandedWhileNarrow);

    useEffect(() => {
        if (!isAutomaticCompact) setExpandedWhileNarrow(false);
    }, [isAutomaticCompact, setExpandedWhileNarrow]);

    const getIsMainPageCompactMode = () => {
        asyncStdoutToPython("/get/data/main_window_sidebar_compact_mode");
    };

    const toggleIsMainPageCompactMode = () => {
        if (isAutomaticCompact) {
            setExpandedWhileNarrow(expanded => !expanded);
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
    // the conversation in a narrow window; a wide window's icon rail is the saved choice,
    // so it is undone the way its toggle does it.
    const expandSidebar = () => {
        if (isAutomaticCompact) {
            setExpandedWhileNarrow(true);
        } else if (currentIsMainPageCompactMode.data) {
            asyncStdoutToPython("/set/disable/main_window_sidebar_compact_mode");
        }
    };

    return {
        currentIsMainPageCompactMode: { ...currentIsMainPageCompactMode,
            data: isAutomaticCompact ? !isExpandedWhileNarrow : currentIsMainPageCompactMode.data },
        isAutomaticCompact,
        getIsMainPageCompactMode,
        toggleIsMainPageCompactMode,
        closeOverlay,
        expandSidebar,
        updateIsMainPageCompactMode,
    };
};
