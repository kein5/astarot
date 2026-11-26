import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getDefaultStore } from "jotai";

import { store, useStore_SelectedConfigTabId } from "@store";
import { useReceiveRoutes } from "@useReceiveRoutes";
import { useStdoutToPython } from "@useStdoutToPython";
import { useI18n } from "@useI18n";
import { useIsBackendReady, useIsOpenedConfigPage, WindowGeometryController } from "@logics_common";
import { useOcrSharedWindow } from "@logics_configs";
import { createSidecarSessionOwner } from "../../logics/common/sidecarSession.ts";
import type { SidecarPhase, SidecarSessionHandlers } from "../../logics/common/sidecarSession.ts";
import { createAttachedBackendCommand } from "../../logics/common/backendCommand.ts";
import { backToMainWindow, placeOf, SETTINGS_NAVIGATE, takeSettingsNavigation } from "../../logics/common/settingsWindow.ts";
import type { SettingsPlace } from "../../logics/common/settingsWindow.ts";
import { showSetting } from "../../logics/common/showSetting.ts";
import { Atom_AppUpdate } from "../../logics/common/useAppUpdate.ts";

import {
    KeyEventController,
    UiLanguageController,
    UiSizeController,
    FontFamilyController,
    ThemeController,
    TransparencyController,
    CornerRadiusController,
} from "../app/_app_controllers";
import { useAsyncFetchFonts } from "../app/_app_controllers/StartPythonController";
import { VirtualMicGuideController } from "../app/_app_controllers/VirtualMicGuideController";
import { ConfigPage } from "../app/config_page/ConfigPage";
import { WindowTitleBar, SnackbarController, AppErrorBoundary } from "../app/others";
import * as styles from "../app/App.css.ts";

// The settings window (#1236). It shows the settings pages as the main window showed them before:
// the same pages, read from the same backend run. The main window keeps what runs the app (the
// hotkeys, Quick Chat, the VR panel, the tray); this window has the settings and the dialogs its
// pages open.
export const SettingsWindowApp = () => (
    <div className={styles.container}>
        <AppErrorBoundary>
            <KeyEventController />
            <SettingsBackendController />
            <SettingsNavigationController />
            <SharedWindowFollower />
            <SettingsWindowTitle />
            <UiLanguageController waitForEngine />
            <UiSizeController />
            <FontFamilyController />
            <ThemeController />
            <TransparencyController />
            <CornerRadiusController />
            <Contents />
            <SnackbarController />
        </AppErrorBoundary>
    </div>
);

// The pages wait for the settings: until the snapshot has come, only the title bar is drawn, and
// the window's place is not saved over the one it opened at.
const Contents = () => {
    const { currentIsBackendReady } = useIsBackendReady();
    const ready = currentIsBackendReady.data === true;
    return (
        <>
            <WindowGeometryController saveGeometry={ready} />
            <WindowTitleBar />
            <div className={styles.pages_wrapper}>
                {ready && <>
                    <ConfigPage />
                    <VirtualMicGuideController />
                </>}
            </div>
        </>
    );
};

// An update that downloads or installs ends the run itself, and the app starts again after it.
const updating = () => ["downloading", "installing"].includes(getDefaultStore().get(Atom_AppUpdate).status);

// Joins the main window's run (backend_attach) and asks for the settings as they are now. The main
// window started the run and keeps it: it feeds its watchdog, says why it stopped and starts it
// again. When the run ends, or cannot be joined, this window goes back to the main window, which
// says why.
const SettingsBackendController = () => {
    const { receiveRoutes, backendStopped } = useReceiveRoutes();
    const { updateIsBackendReady } = useIsBackendReady();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { asyncFetchFonts } = useAsyncFetchFonts();
    const ended = (phase: SidecarPhase) => {
        if (phase !== "failed" && phase !== "stopped") return;
        updateIsBackendReady(false);
        if (!updating()) backToMainWindow().catch(error => console.error("Could not go back to the main window", error));
    };
    const handlers: SidecarSessionHandlers = {
        receiveRoutes,
        backendStopped,
        feedWatchdog: () => {},
        beginStartup: () => updateIsBackendReady(false),
        setStartupState: ended,
        started: isCurrent => {
            asyncStdoutToPython("/run/settings_snapshot");
            void asyncFetchFonts(isCurrent);
        },
        unexpectedExit: () => {},
        stderr: line => console.error("stderr", line),
    };
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        store.backend_session_owner ??= createSidecarSessionOwner({
            store,
            createCommand: () => createAttachedBackendCommand({
                invoke,
                Channel,
                sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            }),
            setInterval,
            clearInterval,
        });
        return store.backend_session_owner.attach(() => handlersRef.current);
    }, []);
    return null;
};

// Where the window was asked to go: when it was made (taken once), and each time it is asked again
// while open (settings-navigate). A place asked for before the pages are drawn waits for them.
const SettingsNavigationController = () => {
    const { updateIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { currentIsBackendReady } = useIsBackendReady();
    const ready = currentIsBackendReady.data === true;
    const [place, setPlace] = useState<SettingsPlace | null>(null);
    // The setters of the latest render; the effects below run when the window opens and when a
    // place comes, not each time these are made again.
    const latest = useRef({ updateIsOpenedConfigPage, updateSelectedConfigTabId });
    latest.current = { updateIsOpenedConfigPage, updateSelectedConfigTabId };

    // The settings page is what this window shows: it is open from the start.
    useEffect(() => { latest.current.updateIsOpenedConfigPage(true); }, []);

    useEffect(() => {
        let disposed = false, unlisten: (() => void) | null = null;
        takeSettingsNavigation().then(taken => { if (!disposed && taken) setPlace(placeOf(taken)); },
            error => console.error("The settings window could not read where to go", error));
        listen<unknown>(SETTINGS_NAVIGATE, ({ payload }) => setPlace(placeOf(payload))).then(stop => {
            if (disposed) stop();
            else unlisten = stop;
        }, error => console.error("The settings window cannot be sent to a page", error));
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    useEffect(() => {
        if (!ready || !place) return;
        setPlace(null);
        if (place.page) latest.current.updateSelectedConfigTabId(place.page);
        if (place.target) showSetting(place.target);
    }, [ready, place]);
    return null;
};

// The window shared with chat reading (Linux, Wayland): what this window's chat reading page
// shows. The main window ends the sharing with chat reading and says when the desktop ended it;
// here it is only kept up to date.
const SharedWindowFollower = () => {
    const { refresh, ended } = useOcrSharedWindow();
    const latest = useRef({ refresh, ended });
    latest.current = { refresh, ended };
    useEffect(() => {
        void latest.current.refresh();
        let disposed = false, unlisten: (() => void) | null = null;
        listen("screencast-ended", () => latest.current.ended()).then(stop => {
            if (disposed) stop();
            else unlisten = stop;
        }, () => {});
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);
    return null;
};

// The window's own title, in the UI language: the taskbar and the window list tell it from the
// main window.
const SettingsWindowTitle = () => {
    const { t } = useI18n();
    const title = t("studio.settings_window_title");
    useEffect(() => {
        document.title = title;
        store.appWindow?.setTitle(title).catch(error => console.warn("The settings window's title could not be set", error));
    }, [title]);
    return null;
};
