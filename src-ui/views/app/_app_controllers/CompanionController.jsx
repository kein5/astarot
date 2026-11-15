import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "@useI18n";
import { store, useStore_CompanionMode } from "@store";
import { useIsBackendReady, useWindow } from "@logics_common";
import { useMainFunction } from "@logics_main";
import { useTranscriptionConsent } from "../../../logics/transcription/useTranscriptionConsent";
import { useTranslationSetup } from "../../../logics/translation/useTranslationSetup";
import { companionStatus, runAction } from "../../../logics/companion/status.js";

// The experimental companion form (Issue #355). Outside it this asks once and does nothing.
// In it, the hidden main window keeps doing what it always does (the backend, the captions)
// and also: reports the switches to the tray and the panel, runs what they ask for, and
// comes forward when it needs the user: the recognition consent, or the translation model's review.
export const CompanionController = () => {
    const { t, i18n } = useI18n();
    const { currentCompanionMode, updateCompanionMode } = useStore_CompanionMode();
    const { currentIsBackendReady } = useIsBackendReady();
    const main = useMainFunction();
    const { asyncQuitApp } = useWindow();
    const { request: consent } = useTranscriptionConsent();
    const { request: translationSetup } = useTranslationSetup();
    const needsUser = !!consent || !!translationSetup;
    const latest = useRef(null);
    latest.current = { main, asyncQuitApp };
    const on = currentCompanionMode.data === true;

    useEffect(() => {
        let live = true;
        invoke("companion_mode").then(value => {
            if (!live || value !== true) return;
            store.companion_hide = () => invoke("companion_hide_main")
                .catch(error => console.error("Main window could not be hidden", error));
            updateCompanionMode(true);
        }, () => {});
        return () => { live = false; };
    }, []);

    useEffect(() => {
        if (!on) return undefined;
        const take = async () => {
            try {
                const actions = await invoke("companion_take");
                for (const action of actions ?? []) runAction(action, latest.current.main);
            } catch (error) { console.error("Companion request could not be taken", error); }
        };
        const requested = listen("companion-requested", take);
        requested.then(take, () => {});
        const quit = listen("companion-quit", () => latest.current.asyncQuitApp());
        return () => {
            requested.then(off => off(), () => {});
            quit.then(off => off(), () => {});
        };
    }, [on]);

    const { currentTranscriptionSendStatus: mic, currentTranslationStatus: translation } = main;
    useEffect(() => {
        if (!on) return;
        invoke("companion_publish", { status: companionStatus({
            ready: currentIsBackendReady.data, mic, translation, language: i18n.language, t,
        }) }).catch(error => console.error("Companion state could not be reported", error));
    }, [on, currentIsBackendReady.data, mic.data, mic.state, translation.data, translation.state, i18n.language, t]);

    useEffect(() => {
        if (on && needsUser) invoke("companion_show_main").catch(error => console.error("Main window could not be shown", error));
    }, [on, needsUser]);

    return null;
};
