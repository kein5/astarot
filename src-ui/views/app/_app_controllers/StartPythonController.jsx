import { invoke, Channel } from "@tauri-apps/api/core";
import { Command } from "@tauri-apps/plugin-shell";
import { useEffect, useRef } from "react";

import { useStdoutToPython } from "@useStdoutToPython";
import { useReceiveRoutes } from "@useReceiveRoutes";
import { store, useStore_SelectableFontFamilyList, useStore_BackendStartupState, useStore_BackendStartupFailure, useStore_InitProgress } from "@store";
import { arrayToObject } from "@utils";
import { createSidecarSessionOwner } from "../../../logics/common/sidecarSession.js";
import { createSelectedBackendCommand } from "../../../logics/common/backendCommand.js";
import { describeStartupFailure } from "../../../logics/common/startupPhase.js";
import { useI18n } from "@useI18n";
import { useNotificationStatus, useIsBackendReady } from "@logics_common";

export const StartPythonController = () => {
    const { t } = useI18n();
    const { receiveRoutes, backendStopped } = useReceiveRoutes();
    const { showNotification_Error } = useNotificationStatus();
    const { updateIsBackendReady } = useIsBackendReady();
    const { updateBackendStartupState } = useStore_BackendStartupState();
    const { updateBackendStartupFailure } = useStore_BackendStartupFailure();
    const { updateInitProgress } = useStore_InitProgress();
    const { asyncFetchFonts } = useAsyncFetchFonts();
    const { asyncStdoutToPython } = useStdoutToPython();
    const handlersRef = useRef(null);
    handlersRef.current = {
        receiveRoutes,
        backendStopped,
        feedWatchdog: () => asyncStdoutToPython("/run/feed_watchdog"),
        beginStartup: () => {
            updateIsBackendReady(false);
            updateInitProgress(0);
        },
        setStartupState: (phase, detail) => {
            // A failed retry that could not stop the old attempt keeps the earlier reason.
            if (phase === "failed" && detail !== undefined) updateBackendStartupFailure(describeStartupFailure(detail));
            updateBackendStartupState(phase);
            if (phase === "failed" || phase === "stopped") updateIsBackendReady(false);
        },
        started: asyncFetchFonts,
        unexpectedExit: ({ code, signal }) => {
            console.error("sidecar exited", { code, signal });
            showNotification_Error(t("common_error.backend_stopped", { code: code ?? signal ?? "?" }),
                { hide_duration: null, category_id: "backend_stopped" });
        },
        stderr: line => {
            showNotification_Error(
                `${t("common_error.recovery_instructions")}\n${t("common_error.last_error_line")}: ${JSON.stringify(line)}`, { hide_duration: null }
            );
            console.error("stderr", line);
        },
    };

    useEffect(() => {
        store.backend_session_owner ??= createSidecarSessionOwner({
            store,
            // The Python sidecar, or the Rust core when the app is started with VRCT_BACKEND=core (#285).
            createCommand: () => createSelectedBackendCommand({
                invoke,
                Channel,
                createSidecar: () => Command.sidecar("bin/vrct-vox-sidecar"),
                newSessionId: () => crypto.randomUUID(),
            }),
            setInterval,
            clearInterval,
        });
        // StrictMode replay and genuine remounts attach to the same session.
        // Detach stops its timer only when the last controller leaves; a late
        // spawn cannot install a timer while no controller is mounted.
        return store.backend_session_owner.attach(() => handlersRef.current);
    }, []);

    return null;
};

const useAsyncFetchFonts = () => {
    const { updateSelectableFontFamilyList } = useStore_SelectableFontFamilyList();
    const asyncFetchFonts = async (isCurrent) => {
        try {
            let fonts = await invoke("get_font_list");
            if (!isCurrent()) return;
            fonts = fonts.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
            updateSelectableFontFamilyList(arrayToObject(fonts));
        } catch (error) {
            if (isCurrent()) console.error("Error fetching fonts:", error);
        }
    };
    return { asyncFetchFonts };
};
