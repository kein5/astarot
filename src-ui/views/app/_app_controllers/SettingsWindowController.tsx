import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useIsOpenedConfigPage } from "@logics_common";
import { useHotkeys, useOcrSharedWindow } from "@logics_configs";
import {
    isSettingsWindowOpen,
    SETTINGS_HAND_OVER,
    SETTINGS_WINDOW_CHANGED,
    settingsHaveAWindow,
} from "../../../logics/common/settingsWindow.ts";

// The main window's side of the settings window (#1236). While it is open, the main window does
// what it did while the settings page was open (IsOpenedConfigPage: the features pause, the hotkeys
// and Quick Chat wait, the VR panel hears it), and it shows the main page all the same.
// - It hears the window open and close (settings-window-changed), and asks once when it starts
//   (a main window loaded again while the settings are open).
// - The Hotkeys page's Quick Chat button closes the settings window and hands the opening here.
// - A window the settings shared with chat reading is read again when they close: the main window
//   ends the sharing with chat reading.
// In a browser the settings are a page in this one, and nothing here runs.
export const SettingsWindowController = () => {
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { openQuickChat } = useHotkeys();
    const { refresh } = useOcrSharedWindow();
    const latest = useRef({ setIsOpenedConfigPage, openQuickChat, refresh });
    latest.current = { setIsOpenedConfigPage, openQuickChat, refresh };

    useEffect(() => {
        if (!settingsHaveAWindow()) return;
        let disposed = false;
        const stops: Array<() => void> = [];
        const keep = (stop: () => void) => {
            if (disposed) stop();
            else stops.push(stop);
        };
        const opened = (open: boolean) => {
            latest.current.setIsOpenedConfigPage(open);
            if (!open) void latest.current.refresh();
        };
        listen<unknown>(SETTINGS_WINDOW_CHANGED, ({ payload }) => opened(payload === true))
            .then(keep, error => console.error("The settings window cannot be followed", error));
        listen<unknown>(SETTINGS_HAND_OVER, ({ payload }) => {
            if (payload !== "open_quick_chat") return;
            latest.current.setIsOpenedConfigPage(false);
            void latest.current.openQuickChat();
        }).then(keep, error => console.error("The settings window cannot hand over", error));
        isSettingsWindowOpen().then(open => { if (!disposed && open) opened(true); },
            error => console.error("Could not ask whether the settings window is open", error));
        return () => {
            disposed = true;
            for (const stop of stops) stop();
        };
    }, []);
    return null;
};
