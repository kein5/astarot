import { useIsMainPageCompactMode } from "@logics_main";
import { useStore_IsOpenedTranslatorSelector } from "@store";

// Main window only. Opens the translator list in the sidebar, where another engine can be
// chosen. The list is in the full rail; the icon rail has none to open, so the rail is widened.
// It only opens the list: the selected engine does not change.
export const useOpenTranslatorList = (): (() => void) => {
    const { expandSidebar } = useIsMainPageCompactMode();
    const { updateIsOpenedTranslatorSelector } = useStore_IsOpenedTranslatorSelector();
    return () => {
        expandSidebar();
        updateIsOpenedTranslatorSelector(true);
    };
};
