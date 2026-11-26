import { invoke, isTauri } from "@tauri-apps/api/core";

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
// The settings window's "Go back": the main window comes to the front and the settings window closes.
export const backToMainWindow = (): Promise<unknown> => invoke("settings_window_back");
// The settings window closes and asks the main window to open Quick Chat (the Hotkeys page).
export const handOverQuickChat = (): Promise<unknown> => invoke("settings_window_hand_over", { action: "open_quick_chat" });

// Whether a line's notices are shown in this window: the settings window shows those that answer
// its own requests, the main window every other one, so nothing is said twice (#1236).
export const noticesHere = (origin: unknown, settingsWindow: boolean): boolean =>
    settingsWindow ? origin === SETTINGS_ORIGIN : origin !== SETTINGS_ORIGIN;
