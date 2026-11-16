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

// The app's tray icon and the overlay feature (tray_companion). The tray icon is there in every
// run, so whether or not the feature is on this reports the switches and the tray menu's words,
// runs what the tray asks for (start or stop recognition, quit), puts the main window away in the
// tray when it is closed, and brings it forward when it needs the user (a dialog, the recognition
// consent, the translation model's review). While the feature is on it also starts the overlay
// and runs what the panel and the hexagram ask for. Turned off, it puts the main window back.
export const CompanionController = () => {
    const { t, i18n } = useI18n();
    const on = useExperimentalFeature(TRAY_COMPANION);
    const { currentTrayCompanionEdge: edge, setTrayCompanionEdge, currentTrayCompanionMonitor: monitor,
        setTrayCompanionMonitor } = useExperimentalFeatures() as {
        currentTrayCompanionEdge: StoreValue;
        setTrayCompanionEdge: (edge: string) => unknown;
        currentTrayCompanionMonitor: StoreValue;
        setTrayCompanionMonitor: (monitor: string) => unknown;
    };
    const { currentIsBackendReady } = useIsBackendReady() as { currentIsBackendReady: StoreValue };
    const main = useMainFunction() as MainFunction;
    const { asyncQuitApp } = useWindow() as { asyncQuitApp: () => unknown };
    const { request: consent } = useTranscriptionConsent();
    const { request: translationSetup } = useTranslationSetup();
    const { startupState } = useBackendStartup();
    const needsUser = !!consent || !!translationSetup;
    const latest = useRef({ main, asyncQuitApp, setTrayCompanionEdge, setTrayCompanionMonitor });
    latest.current = { main, asyncQuitApp, setTrayCompanionEdge, setTrayCompanionMonitor };
    const wasOn = useRef(false);
    // The TTS and voice changer switches, as the main page's own switches work them out.
    const [voiceStates, setVoiceStates] = useState<VoiceSwitchStates>(voiceSwitchStates.get());
    useEffect(() => {
        setVoiceStates(voiceSwitchStates.get());
        return voiceSwitchStates.subscribe(() => setVoiceStates(voiceSwitchStates.get()));
    }, []);

    // Closing the main window puts it away in the tray, in every run; the tray menu's Quit ends the
    // app. Without a tray icon nothing could bring the window back, so it quits as before.
    useEffect(() => {
        const shared = store as CompanionStore;
        shared.companion_hide = async () => {
            try {
                if (await invoke<boolean>("companion_hide_main") === true) return;
            } catch (error) { console.error("Main window could not be hidden", error); }
            latest.current.asyncQuitApp();
        };
        return () => { delete shared.companion_hide; };
    }, []);

    useEffect(() => {
        if (on) {
            wasOn.current = true;
            invoke("companion_set", { enabled: true }).catch(error => console.error("Tray companion could not start", error));
        } else if (wasOn.current) {
            wasOn.current = false;
            invoke("companion_set", { enabled: false }).catch(error => console.error("Tray companion could not stop", error));
        }
    }, [on]);

    // The tray asks in every run; the overlay's requests come only while the feature is on.
    useEffect(() => {
        const take = async () => {
            try {
                const actions = await invoke<unknown[]>("companion_take");
                for (const action of actions ?? []) {
                    runAction(action, { ...latest.current.main, toggleTts: voiceActions.toggleTts, toggleRvc: voiceActions.toggleRvc,
                        setEdge: latest.current.setTrayCompanionEdge, setMonitor: latest.current.setTrayCompanionMonitor });
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
    }, []);

    const { currentTranscriptionSendStatus: mic, currentTranslationStatus: translation,
        currentTranscriptionReceiveStatus: listening, currentOcrCaptureStatus: ocr } = main;
    useEffect(() => {
        invoke("companion_publish", { status: companionStatus({
            ready: currentIsBackendReady.data, mic, translation, listening, ocr, tts: voiceStates.tts, rvc: voiceStates.rvc,
            edge: edge?.data, monitor: monitor?.data, language: i18n.language, t,
        }) }).catch(error => console.error("Companion state could not be reported", error));
    }, [currentIsBackendReady.data, mic.data, mic.state, translation.data, translation.state, listening?.data, listening?.state,
        ocr?.data, ocr?.state, voiceStates, edge?.data, monitor?.data, i18n.language, t]);

    // Any dialog the main window opens (the start-up notices among them) needs the user. The main
    // window may be put away in the tray in any run, so this watches in every run.
    useEffect(() => {
        if (typeof document === "undefined") return undefined;
        return watchOpenDialogs(document, () => {
            invoke("companion_show_main").catch(error => console.error("Main window could not be shown", error));
        });
    }, []);

    useEffect(() => {
        if (needsUser) invoke("companion_show_main").catch(error => console.error("Main window could not be shown", error));
    }, [needsUser]);

    // A failed start never brings the settings, so the feature's state is unknown; the app may
    // have started hidden in the tray from the saved setting. Ask for the main window.
    useEffect(() => {
        if (startupState === "failed") invoke("companion_show_main").catch(() => {});
    }, [startupState]);

    return null;
};
