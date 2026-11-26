import { startTransition, useEffect, useLayoutEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Window as AppWindow } from "@tauri-apps/api/window";
import { useStdoutToPython } from "@useStdoutToPython";
import type { AsyncStdoutToPython } from "@useStdoutToPython";
import { useStore_IsBreakPoint } from "@store";
import { useAppearance } from "@logics_configs";
import { store } from "@store";
import { isSettingsWindow } from "./settingsWindow.ts";
import { isNarrowWidth } from "./breakPoint.ts";

// Time the backend gets to save the settings after /run/shutdown. Closing the
// window ends the app, and the shell plugin then kills the backend.
const SHUTDOWN_WAIT_MS = 2000;
let closing: Promise<void> | null = null;
// The main window's width in CSS pixels, as innerSize last answered (asyncUpdateBreakPoint).
let measuredWidth: number | undefined;
let releaseCloseRequest: (() => void) | null = null;

// This page's window, which its entry point sets before anything here runs: the main window
// (views/app/index.tsx), or the settings window (views/settings_window/index.tsx, #1236).
// Without it each use fails where it did before, at the window's first call.
const mainWindow = (appWindow: AppWindow | undefined): AppWindow => {
    if (!appWindow) throw new TypeError("The main window is not set (store.appWindow).");
    return appWindow;
};

// Where a window's position and size are saved: the main window's, or the settings window's own (#1236).
const geometryEndpoint = () => isSettingsWindow() ? "/set/data/settings_window_geometry" : "/set/data/main_window_geometry";

// A window's position and size, as /set/data/main_window_geometry takes them.
export interface WindowGeometry {
    x_pos: number;
    y_pos: number;
    width: number;
    height: number;
}

// Every way of closing the main window (the title bar button, Alt+F4, the
// taskbar) asks the backend to shut down once, waits, then destroys the window.
// Closing without it lost the settings changed in the last two seconds.
const closeAfterShutdown = (appWindow: AppWindow | undefined, sendToPython: (path: string) => unknown): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
        try {
            sendToPython("/run/shutdown");
        } catch (error) {
            console.error("Could not ask the backend to shut down:", error);
        }
        await new Promise(resolve => setTimeout(resolve, SHUTDOWN_WAIT_MS));
        try {
            await mainWindow(appWindow).destroy();
        } catch (error) {
            // Without our close-requested listener the window closes as usual.
            console.error("Could not destroy the window; closing it instead:", error);
            releaseCloseRequest?.();
            await mainWindow(appWindow).close();
        }
    })();
    return closing;
};

export const useWindow = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentUiScaling } = useAppearance();
    const { updateIsBreakPoint } = useStore_IsBreakPoint();

    const appWindow = store.appWindow;

    const asyncGetWindowGeometry = async (): Promise<WindowGeometry | undefined> => {
        try {
            const position = await mainWindow(appWindow).outerPosition();
            const { x: x_pos, y: y_pos } = position;

            const size = await mainWindow(appWindow).outerSize();
            const { width, height } = size;

            return {
                x_pos: x_pos,
                y_pos: y_pos,
                width: width,
                height: height
            };
        } catch (err) {
            console.error("Error getting window position and size:", err);
        }
    };

    const asyncSaveWindowGeometry = async () => {
        const minimized = await mainWindow(appWindow).isMinimized();
        if (minimized === true) return; // don't save while the window is minimized.
        const data = await asyncGetWindowGeometry();
        asyncStdoutToPython(geometryEndpoint(), data);
    };

    // The saved geometry is applied before the window is first shown
    // (src-tauri/src/window_placement.rs), not here.

    const applyBreakPoint = (width: number) => {
        const narrow = isNarrowWidth(width, currentUiScaling.data);
        // Every update re-renders whatever reads IsBreakPoint, so only send changes.
        if (document.documentElement.hasAttribute("data-narrow") === narrow) return;
        // Drawn as a transition: a flushSync elsewhere (virtua's, in the ResizeObserver callback where
        // it measures the log) would draw a waiting update with it. The rail turning to icons then
        // resized the log inside that callback, and WebKit reported
        // "ResizeObserver loop completed with undelivered notifications" (#1200, as MessageContainer).
        startTransition(() => updateIsBreakPoint(narrow));
        // CSS width queries miss the UI size: at 200% an 870px window lays
        // out like a 435px one. Narrow styles also key on this attribute.
        document.documentElement.toggleAttribute("data-narrow", narrow);
    };

    const asyncUpdateBreakPoint = async () => {
        // Decided at once from the width last measured, then again from the window's size. A new UI
        // size (the saved one, at the start) then changes the layout in the render that brought it,
        // before the settings page that render mounts is laid out. Decided only after the window
        // answered, the change came about 0.3 s later, at that page's first layout; WebKitGTK 2.52
        // then sometimes stopped laying the page out, and the settings menu stayed outside the window.
        if (measuredWidth !== undefined) applyBreakPoint(measuredWidth);
        const size = await mainWindow(appWindow).innerSize();
        // innerSize is in physical pixels; the breakpoint, like the CSS
        // (max-width: 800px) queries, is in CSS pixels. At 150% display
        // scaling an 800px-wide window is 1200 physical pixels.
        measuredWidth = size.width / (globalThis.devicePixelRatio || 1);
        applyBreakPoint(measuredWidth);
    };

    const asyncToggleMaximizeApp = async () => {
        const maximizeState = await mainWindow(appWindow).isMaximized();
        if (!maximizeState) {
            await mainWindow(appWindow).maximize();
        } else {
            await mainWindow(appWindow).unmaximize();
        }
    };

    const asyncMinimizeApp = async () => {
        await mainWindow(appWindow).minimize();
    };

    // The app lives in the tray: closing the window only puts it away there, and the tray menu's Quit
    // ends the app (asyncQuitApp). CompanionController sets store.companion_hide; it quits instead
    // when there is no tray icon to bring the window back from.
    // The settings window's close button closes only it (#1236): nothing asks, as the settings save by
    // themselves (#1111).
    const asyncCloseApp = () => isSettingsWindow() ? mainWindow(appWindow).destroy()
        : store.companion_hide ? store.companion_hide() : closeAfterShutdown(appWindow, asyncStdoutToPython);
    const asyncQuitApp = () => closeAfterShutdown(appWindow, asyncStdoutToPython);

    return {
        asyncSaveWindowGeometry,
        asyncUpdateBreakPoint,

        asyncCloseApp,
        asyncQuitApp,
        asyncToggleMaximizeApp,
        asyncMinimizeApp,
    };
};

// Saves the window geometry and keeps the narrow layout in step with the window.
// It is a module-level component: defined inside useWindow it was a new type on
// every render, so React remounted it each time, and the mount effect's
// IsBreakPoint update re-rendered its parent, which made it new again. That loop
// re-rendered the whole app and re-registered the window listeners about 40
// times a second while idle.
//
// It runs from the first frame, so the narrow layout is right while the engine
// starts. Until the engine is ready (saveGeometry false) it only updates the
// layout: the geometry the engine restores at readiness is not overwritten.
export const WindowGeometryController = ({ saveGeometry = true }: { saveGeometry?: boolean } = {}) => {
    const { asyncSaveWindowGeometry, asyncUpdateBreakPoint } = useWindow();
    const { currentUiScaling } = useAppearance();
    const latest = useRef({ asyncSaveWindowGeometry, asyncUpdateBreakPoint, saveGeometry });
    latest.current = { asyncSaveWindowGeometry, asyncUpdateBreakPoint, saveGeometry };

    // Also decide at startup and once the saved UI size arrives: a window that opens
    // narrow (or at a large UI size) never fires a resize event, so it kept the wide layout.
    // Before the browser paints, as the UI size itself is applied (UiSizeController).
    useLayoutEffect(() => {
        asyncUpdateBreakPoint();
    }, [currentUiScaling.data]);

    useEffect(() => {
        const appWindow = mainWindow(store.appWindow);
        let resizeTimeout: ReturnType<typeof setTimeout> | undefined, moveTimeout: ReturnType<typeof setTimeout> | undefined;
        const unlistenResize = appWindow.onResized(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (latest.current.saveGeometry) latest.current.asyncSaveWindowGeometry();
                latest.current.asyncUpdateBreakPoint();
            }, 200);
        });
        const unlistenMove = appWindow.onMoved(() => {
            clearTimeout(moveTimeout);
            moveTimeout = setTimeout(() => {
                if (latest.current.saveGeometry) latest.current.asyncSaveWindowGeometry();
            }, 200);
        });
        return () => {
            unlistenResize.then(dispose => dispose());
            unlistenMove.then(dispose => dispose());
            clearTimeout(resizeTimeout);
            clearTimeout(moveTimeout);
        };
    }, []);

    return null;
};

// Routes a close the window system asks for (Alt+F4, the taskbar) through the
// same shutdown as the title bar button. While this listener is registered,
// Tauri leaves the closing to it.
export const WindowCloseController = () => {
    const { asyncStdoutToPython } = useStdoutToPython();
    const latest = useRef<AsyncStdoutToPython>(asyncStdoutToPython);
    latest.current = asyncStdoutToPython;

    useEffect(() => {
        const appWindow = mainWindow(store.appWindow);
        let active = true, dispose: UnlistenFn | null = null;
        const release = () => {
            active = false;
            dispose?.();
            dispose = null;
        };
        appWindow.onCloseRequested(event => {
            event.preventDefault();
            if (store.companion_hide) store.companion_hide();
            else closeAfterShutdown(appWindow, (...args: Parameters<AsyncStdoutToPython>) => latest.current(...args));
        }).then(unlisten => {
            dispose = unlisten;
            if (!active) release();
        });
        releaseCloseRequest = release;
        return () => {
            release();
            if (releaseCloseRequest === release) releaseCloseRequest = null;
        };
    }, []);

    return null;
};
