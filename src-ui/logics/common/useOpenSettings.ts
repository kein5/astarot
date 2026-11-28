import { useStore_SelectedConfigTabId } from "@store";
import { useIsOpenedConfigPage } from "./useIsOpenedConfigPage";
import { showSetting } from "./showSetting.ts";
import { isSettingsWindow, openSettingsWindow, settingsHaveAWindow } from "./settingsWindow.ts";
import type { SettingsPlace } from "./settingsWindow.ts";

// Opens the settings at a page, and shows a setting on it (#1236). From the main window of the
// app: the settings window, opened or brought to the front and sent there. In the settings window
// itself, and in a page in a browser: the page, as the settings opened before they had a window.
// `focus` false leaves the focus where it is (the VR panel's settings).
export const useOpenSettings = () => {
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    return (place: SettingsPlace = {}, { focus = true }: { focus?: boolean } = {}) => {
        if (settingsHaveAWindow() && !isSettingsWindow()) {
            openSettingsWindow(place, focus).catch(error => { console.error("The settings window could not open", error); });
            return;
        }
        if (place.page) updateSelectedConfigTabId(place.page);
        setIsOpenedConfigPage(true);
        if (place.target) showSetting(place.target);
    };
};
