import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVolume } from "@logics_common";
import { useHotkeys, useOcrSharedWindow } from "@logics_configs";
import { useStore_IsHotkeysPageOpen, useStore_IsOpenedSettingsWindow } from "@store";
import {
    isSettingsWindowOpen,
    SETTINGS_HAND_OVER,
    SETTINGS_WINDOW_CHANGED,
    settingsHaveAWindow,
} from "../../../logics/common/settingsWindow.ts";

// The main window's side of the settings window (#1236). Nothing pauses while it is open (decided
// on 2026-11-26): the main window works as usual beside it, and a setting that needs a feature
// stopped stops it itself.
// - It hears the window open and close (settings-window-changed), and asks once when it starts
//   (a main window loaded again while the settings are open). The VR panel's settings follow it
//   (IsOpenedSettingsWindow).
// - The Hotkeys page asks for the hotkeys to wait while it is shown, as the keys pressed there are
//   being recorded (IsHotkeysPageOpen), and its Quick Chat button hands the opening here.
// - What the settings started ends with them: the volume checks stop, and a window the settings
//   shared with chat reading is read again (the main window ends the sharing with chat reading).
// In a browser the settings are a page in this one, and nothing here runs.
export const SettingsWindowController = () => {
    const { updateIsOpenedSettingsWindow } = useStore_IsOpenedSettingsWindow();
    const { updateIsHotkeysPageOpen } = useStore_IsHotkeysPageOpen();
    const { openQuickChat } = useHotkeys();
    const { refresh } = useOcrSharedWindow();
    const { currentMicThresholdCheckStatus, volumeCheckStop_Mic, currentSpeakerThresholdCheckStatus, volumeCheckStop_Speaker } = useVolume();
    const now = {
        updateIsOpenedSettingsWindow, updateIsHotkeysPageOpen, openQuickChat, refresh, volumeCheckStop_Mic, volumeCheckStop_Speaker,
        micCheck: currentMicThresholdCheckStatus.data === true, speakerCheck: currentSpeakerThresholdCheckStatus.data === true,
    };
    const latest = useRef(now);
    latest.current = now;

    useEffect(() => {
        if (!settingsHaveAWindow()) return;
        let disposed = false;
        const stops: Array<() => void> = [];
        const keep = (stop: () => void) => {
            if (disposed) stop();
            else stops.push(stop);
        };
        const opened = (open: boolean) => {
            const current = latest.current;
            current.updateIsOpenedSettingsWindow(open);
            if (open) return;
            current.updateIsHotkeysPageOpen(false);
            if (current.micCheck) current.volumeCheckStop_Mic();
            if (current.speakerCheck) current.volumeCheckStop_Speaker();
            void current.refresh();
        };
        listen<unknown>(SETTINGS_WINDOW_CHANGED, ({ payload }) => opened(payload === true))
            .then(keep, error => console.error("The settings window cannot be followed", error));
        listen<unknown>(SETTINGS_HAND_OVER, ({ payload }) => {
            if (payload === "open_quick_chat") void latest.current.openQuickChat();
            else if (payload === "pause_hotkeys" || payload === "resume_hotkeys") latest.current.updateIsHotkeysPageOpen(payload === "pause_hotkeys");
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
