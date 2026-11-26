import { invoke, isTauri } from "@tauri-apps/api/core";
import { isNarrowWidth } from "./breakPoint.ts";
import type { SidecarSession, SidecarSessionOwner } from "./sidecarSession.ts";

// The settings window (#1236). In the app the settings open in a window of their own, beside the
// main window (src-tauri/src/settings_window.rs): at most one, brought to the front when it is
// open, and sent to a page or a setting when one is asked for. It joins the main window's run of
// the backend, so both windows read every answer. A page in a browser (development, the
// integration tests) has no second window: there the settings open in-page, as before.

export const SETTINGS_WINDOW_LABEL = "settings";
// What the shell names the settings window's requests, and the core their answers.
export const SETTINGS_ORIGIN = "settings";
// The events of the shell (settings_window.rs).
export const SETTINGS_WINDOW_CHANGED = "settings-window-changed";
export const SETTINGS_NAVIGATE = "settings-navigate";
export const SETTINGS_HAND_OVER = "settings-hand-over";
// The settings window hears it when the main window has started a run of the backend: it joins
// that run when the one it read has ended.
export const SETTINGS_BACKEND_RUN = "settings-backend-run";

// A page of the settings (a tab id, "translation") and a setting on it to show (its id or label).
export type SettingsPlace = { page?: string; target?: string };

// This page is the settings window: it is settings.html.
export const isSettingsWindow = (location: { pathname: string } | undefined = globalThis.location): boolean =>
    !!location && /\/settings\.html$/.test(location.pathname);

// The settings open in a window of their own: inside the app.
export const settingsHaveAWindow = (): boolean => isTauri();

// A place as the shell takes it: a page, a setting, or neither.
export const placeOf = (place: unknown): SettingsPlace => {
    if (typeof place !== "object" || place === null) return {};
    const { page, target } = place as Record<string, unknown>;
    return {
        ...(typeof page === "string" && page !== "" ? { page } : {}),
        ...(typeof target === "string" && target.trim() !== "" ? { target } : {}),
    };
};

export const openSettingsWindow = (place: SettingsPlace = {}, focus = true): Promise<unknown> =>
    invoke("settings_window_open", { page: place.page ?? null, target: place.target ?? null, focus });
export const closeSettingsWindow = (): Promise<unknown> => invoke("settings_window_close");
export const isSettingsWindowOpen = (): Promise<boolean> => invoke<boolean>("settings_window_is_open");
export const takeSettingsNavigation = (): Promise<unknown> => invoke("settings_window_take_navigation");
// What the settings window asks of the main window, which runs Quick Chat and the hotkeys: to open
// Quick Chat (the Hotkeys page's button), and to pause the hotkeys while the Hotkeys page is shown
// and resume them after, so a key pressed to record it does not act.
export const handOverQuickChat = (): Promise<unknown> => invoke("settings_window_hand_over", { action: "open_quick_chat" });
export const showingHotkeysPage = (shown: boolean): Promise<unknown> =>
    invoke("settings_window_hand_over", { action: shown ? "pause_hotkeys" : "resume_hotkeys" });

// Whether the narrow state (IsBreakPoint, which turns the settings menu to icons) is the one the
// window's width and UI size call for. useWindow.ts decides it after the render that brings a new UI
// size, and draws it in a transition a moment later. The settings window draws its page once the
// state has come, so the page's first layout is the one it keeps (#1236).
export const layoutSettled = (breakPoint: boolean, uiScaling: number, width: number = globalThis.innerWidth ?? 0): boolean =>
    breakPoint === isNarrowWidth(width, uiScaling);

// Whether a line's notices are shown in this window: the settings window shows those that answer
// its own requests, the main window every other one, so nothing is said twice (#1236).
export const noticesHere = (origin: unknown, settingsWindow: boolean): boolean =>
    settingsWindow ? origin === SETTINGS_ORIGIN : origin !== SETTINGS_ORIGIN;

// The settings window's way into the runs (#1236). When the run it read ends, it stays, and it joins
// the next run the main window starts (settings-backend-run; decided on 2026-11-26). A start heard
// while this window is still joining, or still on the run the new one replaces, waits until that
// ends: the owner's retry() joins only after an end, and while this window is joining, its attempts
// find the new run by themselves.
export interface RunJoinerStore {
    backend_session: Pick<SidecarSession, "phase" | "retrying"> | null;
    backend_session_owner: Pick<SidecarSessionOwner, "retry"> | null;
}
export const createRunJoiner = (store: RunJoinerStore, later: (task: () => void) => void = queueMicrotask) => {
    // The main window started a run this window has not joined yet.
    let waiting = false;
    const join = () => {
        const session = store.backend_session;
        if (!waiting || !session || session.retrying || (session.phase !== "failed" && session.phase !== "stopped")) return;
        waiting = false;
        void store.backend_session_owner?.retry();
    };
    return {
        // The main window started a run.
        runStarted: () => {
            waiting = true;
            join();
        },
        // The run this window read has ended: it joins after the end has been taken in.
        ended: () => later(join),
        // This window has joined a run.
        joined: () => { waiting = false; },
    };
};
