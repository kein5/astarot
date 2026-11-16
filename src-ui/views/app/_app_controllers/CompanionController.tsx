import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "@useI18n";
import { store } from "@store";
import { useIsBackendReady, useWindow } from "@logics_common";
import { useExperimentalFeature, useExperimentalFeatures } from "@logics_configs";
import { useMainFunction } from "@logics_main";
import { useBackendStartup } from "../../../logics/common/useBackendStartup";
import { useTranscriptionConsent } from "../../../logics/transcription/useTranscriptionConsent";
import { useTranslationSetup } from "../../../logics/translation/useTranslationSetup";
import { companionStatus, runAction } from "../../../logics/companion/status.ts";
import { watchOpenDialogs } from "../../../logics/companion/dialogs.ts";
import { voiceActions, voiceSwitchStates, type VoiceSwitchStates } from "../../../logics/voice/voiceActions.ts";

// The experimental feature that keeps the app in the system tray (src-tauri/src/companion.rs).
export const TRAY_COMPANION = "tray_companion";

type StoreValue = { state?: string; data?: unknown };
type MainFunction = {
    currentTranscriptionSendStatus: StoreValue;
    currentTranslationStatus: StoreValue;
    currentTranscriptionReceiveStatus: StoreValue;
    currentOcrCaptureStatus: StoreValue;
    toggleTranscriptionSend: () => void;
    toggleTranslation: () => void;
    toggleTranscriptionReceive: () => void;
    toggleOcrCapture: () => void;
};
// store.js is untyped; this controller adds the one hook useWindow.js reads.
type CompanionStore = { companion_hide?: () => Promise<unknown> };

// The tray companion. While the feature is off this does nothing, unless it was just turned
// off, when it puts the main window back. While it is on, the main window (hidden in the
// tray) keeps doing what it always does (the backend, the captions) and also reports the
// switches to the tray and the panel, runs what they ask for, and comes forward when it needs
// the user: the recognition consent or the translation model's review.
export const CompanionController = () => {
    const { t, i18n } = useI18n();
    const on = useExperimentalFeature(TRAY_COMPANION);
    const { currentTrayCompanionEdge: edge } = useExperimentalFeatures() as { currentTrayCompanionEdge: StoreValue };
    const { currentIsBackendReady } = useIsBackendReady() as { currentIsBackendReady: StoreValue };
    const main = useMainFunction() as MainFunction;
    const { asyncQuitApp } = useWindow() as { asyncQuitApp: () => unknown };
    const { request: consent } = useTranscriptionConsent();
    const { request: translationSetup } = useTranslationSetup();
    const { startupState } = useBackendStartup();
    const needsUser = !!consent || !!translationSetup;
    const latest = useRef({ main, asyncQuitApp });
    latest.current = { main, asyncQuitApp };
    const wasOn = useRef(false);
    // The TTS and voice changer switches, as the main page's own switches work them out.
    const [voiceStates, setVoiceStates] = useState<VoiceSwitchStates>(voiceSwitchStates.get());
    useEffect(() => {
        if (!on) return undefined;
        setVoiceStates(voiceSwitchStates.get());
        return voiceSwitchStates.subscribe(() => setVoiceStates(voiceSwitchStates.get()));
    }, [on]);

    useEffect(() => {
        const shared = store as CompanionStore;
        if (on) {
            wasOn.current = true;
            shared.companion_hide = () => invoke("companion_hide_main")
                .catch(error => console.error("Main window could not be hidden", error));
            invoke("companion_set", { enabled: true }).catch(error => console.error("Tray companion could not start", error));
        } else if (wasOn.current) {
            wasOn.current = false;
            delete shared.companion_hide;
            invoke("companion_set", { enabled: false }).catch(error => console.error("Tray companion could not stop", error));
        }
    }, [on]);

    useEffect(() => {
        if (!on) return undefined;
        const take = async () => {
            try {
                const actions = await invoke<unknown[]>("companion_take");
                for (const action of actions ?? []) {
                    runAction(action, { ...latest.current.main, toggleTts: voiceActions.toggleTts, toggleRvc: voiceActions.toggleRvc });
                }
            } catch (error) { console.error("Companion request could not be taken", error); }
        };
        const requested = listen("companion-requested", () => { void take(); });
        requested.then(take, () => {});
        const quit = listen("companion-quit", () => { latest.current.asyncQuitApp(); });
        return () => {
            requested.then(off => off(), () => {});
            quit.then(off => off(), () => {});
        };
    }, [on]);

    const { currentTranscriptionSendStatus: mic, currentTranslationStatus: translation,
        currentTranscriptionReceiveStatus: listening, currentOcrCaptureStatus: ocr } = main;
    useEffect(() => {
        if (!on) return;
        invoke("companion_publish", { status: companionStatus({
            ready: currentIsBackendReady.data, mic, translation, listening, ocr, tts: voiceStates.tts, rvc: voiceStates.rvc,
            edge: edge?.data, language: i18n.language, t,
        }) }).catch(error => console.error("Companion state could not be reported", error));
    }, [on, currentIsBackendReady.data, mic.data, mic.state, translation.data, translation.state, listening?.data, listening?.state,
        ocr?.data, ocr?.state, voiceStates, edge?.data, i18n.language, t]);

    // Any dialog the main window opens (the start-up notices among them) needs the user too.
    useEffect(() => {
        if (!on || typeof document === "undefined") return undefined;
        return watchOpenDialogs(document, () => {
            invoke("companion_show_main").catch(error => console.error("Main window could not be shown", error));
        });
    }, [on]);

    useEffect(() => {
        if (on && needsUser) invoke("companion_show_main").catch(error => console.error("Main window could not be shown", error));
    }, [on, needsUser]);

    // A failed start never brings the settings, so the feature's state is unknown; the app may
    // have started hidden in the tray from the saved setting. Ask for the main window: with the
    // feature off the command refuses and nothing changes.
    useEffect(() => {
        if (startupState === "failed") invoke("companion_show_main").catch(() => {});
    }, [startupState]);

    return null;
};
