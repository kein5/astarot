import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "@useI18n";
import { store, useStore_NotificationStatus, useStore_SwitchBlocks } from "@store";
import { useIsBackendReady, useNotificationStatus, useWindow } from "@logics_common";
import { useAppearance, useExperimentalFeature, useExperimentalFeatures } from "@logics_configs";
import { useMainFunction } from "@logics_main";
import { useBackendStartup } from "../../../logics/common/useBackendStartup";
import { useTranscriptionConsent } from "../../../logics/transcription/useTranscriptionConsent";
import { useTranslationSetup } from "../../../logics/translation/useTranslationSetup";
import { activeSwitchBlock } from "../../../logics/main/switchBlocks.ts";
import { companionStatus, FEATURES, runAction, SWITCH_IDS, type Feature } from "../../../logics/companion/status.ts";
import { watchOpenDialogs } from "../../../logics/companion/dialogs.ts";
import { voiceActions, voiceSwitchStates, type VoiceSwitchStates } from "../../../logics/voice/voiceActions.ts";

// The experimental feature that keeps the app in the system tray (src-tauri/src/companion.rs).
export const TRAY_COMPANION = "tray_companion";

// How long after a switch pressed in the tray, the hexagram or its panel an error notice is
// taken as that switch's answer. The engine may wait about 20 s for a busy lock before it
// refuses, and starting the microphone takes a few seconds more.
export const REFUSAL_WINDOW_MS = 30000;
const showMain = () => invoke("companion_show_main").catch(error => console.error("Main window could not be shown", error));

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
        setTrayCompanionMonitor, currentTrayCompanionWheelHintShown: hinted, setTrayCompanionWheelHintShown } = useExperimentalFeatures();
    const { currentTheme } = useAppearance();
    const savedTheme = JSON.stringify(currentTheme?.data ?? null);
    const { currentIsBackendReady } = useIsBackendReady();
    const main = useMainFunction();
    const { asyncQuitApp } = useWindow();
    const { request: consent } = useTranscriptionConsent();
    const { request: translationSetup } = useTranslationSetup();
    const { startupState } = useBackendStartup();
    const needsUser = !!consent || !!translationSetup;
    const { currentSwitchBlocks } = useStore_SwitchBlocks();
    const { currentNotificationStatus } = useStore_NotificationStatus();
    const { showNotification_Error } = useNotificationStatus();
    // The TTS and voice changer switches, as the main page's own switches work them out.
    const [voiceStates, setVoiceStates] = useState<VoiceSwitchStates>(voiceSwitchStates.get());
    useEffect(() => {
        setVoiceStates(voiceSwitchStates.get());
        return voiceSwitchStates.subscribe(() => setVoiceStates(voiceSwitchStates.get()));
    }, []);

    // The block a feature's main switch shows now (logics/main/switchBlocks.ts), if any.
    const blockOf = (feature: Feature) => {
        if (currentIsBackendReady.data !== true) return undefined;
        const voiceState = feature === "tts" || feature === "rvc" ? voiceStates[feature] : null;
        const status = voiceState ? { data: voiceState.on, state: voiceState.pending ? "pending" : "ok" }
            : { mic: main.currentTranscriptionSendStatus, translation: main.currentTranslationStatus,
                listening: main.currentTranscriptionReceiveStatus, ocr: main.currentOcrCaptureStatus }[feature as "mic"];
        return activeSwitchBlock(currentSwitchBlocks.data, SWITCH_IDS[feature], status);
    };
    // The switches greyed out now: the panel and the hexagram draw them so (#562).
    const blocked = Object.fromEntries(FEATURES.map(feature => [feature, !!blockOf(feature)]));
    const blockedKey = FEATURES.filter(feature => blocked[feature]).join(",");
    // A switch whose main switch is greyed out is not pressed from the tray either: the main
    // window comes forward and says why, as its switch does.
    const refuse = (feature: Feature): boolean => {
        const block = blockOf(feature);
        if (!block) return false;
        showNotification_Error(`${t(`main_page.${SWITCH_IDS[feature]}`)}: ${t(`main_page.switch_blocked.${block.reason}`)}`,
            { category_id: `companion_blocked_${feature}` });
        void showMain();
        return true;
    };
    // A switch as the main page shows it: on, and whether its change is still waiting.
    const switchState = (feature: Feature) => {
        const voiceState = feature === "tts" || feature === "rvc" ? voiceStates[feature] : null;
        if (voiceState) return { on: voiceState.on, pending: !!voiceState.pending };
        const status = { mic: main.currentTranscriptionSendStatus, translation: main.currentTranslationStatus,
            listening: main.currentTranscriptionReceiveStatus, ocr: main.currentOcrCaptureStatus }[feature as "mic"];
        return { on: status?.data, pending: status?.state === "pending" };
    };
    // The switch last pressed from the tray, the hexagram or its panel, when, and how it was then;
    // null once answered, by an error notice or by the switch changing.
    const asked = useRef<{ at: number; feature: Feature; was: unknown } | null>(null);
    const latest = useRef({ main, asyncQuitApp, setTrayCompanionEdge, setTrayCompanionMonitor, setTrayCompanionWheelHintShown, refuse, switchState });
    latest.current = { main, asyncQuitApp, setTrayCompanionEdge, setTrayCompanionMonitor, setTrayCompanionWheelHintShown, refuse, switchState };
    const wasOn = useRef(false);

    // The engine's refusal (VRChat not running, a language the chat reading cannot read) is an
    // error notice in the main window, which may be away in the tray. It comes forward with it.
    const notice = currentNotificationStatus?.data;
    useEffect(() => {
        if (asked.current === null || !notice?.is_open || notice.status !== "error") return;
        const recent = Date.now() - asked.current.at <= REFUSAL_WINDOW_MS;
        asked.current = null;
        if (recent) void showMain();
    }, [notice]);
    // A switch that changed did what was asked: a later error is not its answer and leaves the
    // main window where it is (#463).
    const askedFeature = asked.current?.feature;
    const askedState = askedFeature ? switchState(askedFeature) : null;
    useEffect(() => {
        if (asked.current && askedState && !askedState.pending && askedState.on !== asked.current.was) asked.current = null;
    }, [askedFeature, askedState?.on, askedState?.pending]);

    // Closing the main window puts it away in the tray, in every run; the tray menu's Quit ends the
    // app. Without a tray icon nothing could bring the window back, so it quits as before.
    useEffect(() => {
        store.companion_hide = async () => {
            try {
                if (await invoke<boolean>("companion_hide_main") === true) return;
            } catch (error) { console.error("Main window could not be hidden", error); }
            latest.current.asyncQuitApp();
        };
        return () => { delete store.companion_hide; };
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
                    const feature = typeof action === "string" && action.startsWith("toggle_") ? action.slice("toggle_".length) as Feature : null;
                    const was = feature && Object.hasOwn(SWITCH_IDS, feature) ? latest.current.switchState(feature).on : undefined;
                    const ran = runAction(action, { ...latest.current.main, toggleTts: voiceActions.toggleTts, toggleRvc: voiceActions.toggleRvc,
                        setEdge: latest.current.setTrayCompanionEdge, setMonitor: latest.current.setTrayCompanionMonitor,
                        setHinted: () => latest.current.setTrayCompanionWheelHintShown(true), refuse: latest.current.refuse });
                    if (ran && feature) asked.current = { at: Date.now(), feature, was };
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
            // The settings came with the backend's start, so until it is ready the hint is not known.
            blocked, edge: edge?.data, monitor: monitor?.data, hinted: currentIsBackendReady.data === true ? hinted?.data : undefined,
            theme: JSON.parse(savedTheme), language: i18n.language, t,
        }) }).catch(error => console.error("Companion state could not be reported", error));
    }, [currentIsBackendReady.data, mic.data, mic.state, translation.data, translation.state, listening?.data, listening?.state,
        ocr?.data, ocr?.state, voiceStates, blockedKey, edge?.data, monitor?.data, hinted?.data, savedTheme, i18n.language, t]);

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
