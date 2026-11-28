import { useEffect, useRef, useState } from "react";
import type { ComponentType, MouseEvent, SVGProps } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useIsOpenedConfigPage, useVrPanelLogOutOfView, useVrPanelLauncherIntro } from "@logics_common";
import { useStdoutToPython } from "@useStdoutToPython";
import { useMainFunction } from "@logics_main";
import { useStore_MicCaptureWaiting, useStore_SwitchBlocks, useStore_VrVoiceControls } from "@store";
import { activeSwitchBlock } from "../../logics/main/switchBlocks";
import { micWaitSystem } from "../../logics/transcription/micCaptureWait";
import { sendToMain } from "../../logics/common/vrPanelSend";
import type { VoiceStopState } from "../../logics/voice/voiceActions";
import type { SwitchBlock, SwitchBlockId, SwitchStatus } from "../../logics/main/switchBlocks";
import TranslationSvg from "@images/translation.svg?react";
import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import ChatTranscribeSvg from "@images/chat_transcribe.svg?react";
import TtsSpeakerSvg from "@images/tts_speaker.svg?react";
import CopyThinSvg from "@images/copy_thin.svg?react";
// The intro shows ASTAROT's own mark, like the About page: this is not the official VRCT.
import intro_icon from "@images/brand/icon-small.svg";
import intro_logo from "@images/brand/logo.svg";
import { VrTooltipButton } from "./VrTooltip";
import { StopSvg, WindowsSvg } from "./VrLauncherIcons";
import type { VrPopup } from "./VrPopupWindow";
import * as shared from "./VrSettingsWindow.css.ts";
import * as styles from "./VrLauncher.css.ts";

type Svg = ComponentType<SVGProps<SVGSVGElement>>;

// Which of the panel's windows are open (VrApp).
export interface VrWindows {
    log: boolean;
    popup: VrPopup | null;
}

interface VrLauncherProps {
    windows: VrWindows;
    toggleLog: () => void;
    openLog: () => void;
    togglePopup: (name: VrPopup) => void;
}

const LONG_PRESS_MS = 600;
export const VrLauncher = ({ windows, toggleLog, openLog, togglePopup }: VrLauncherProps) => {
    const { t } = useI18n();
    const { currentIsOpenedConfigPage } = useIsOpenedConfigPage();
    const { toggleTranslation, currentTranslationStatus, toggleTranscriptionSend, currentTranscriptionSendStatus,
        toggleTranscriptionReceive, currentTranscriptionReceiveStatus, toggleOcrCapture, currentOcrCaptureStatus } = useMainFunction();
    const { currentVrPanelLogOutOfView } = useVrPanelLogOutOfView();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentVrPanelLauncherIntro } = useVrPanelLauncherIntro();
    const intro = currentVrPanelLauncherIntro.data;
    const is_log_lost = windows.log && currentVrPanelLogOutOfView.data === true;
    const is_locked = currentIsOpenedConfigPage.data === true;
    // The same blocks as the main window's switches, worked out there (SwitchBlocksController).
    const { currentSwitchBlocks } = useStore_SwitchBlocks();
    const blockOf = (id: SwitchBlockId, state: SwitchStatus) => activeSwitchBlock(currentSwitchBlocks.data, id, state);
    // Mic input's microphone waits to open, perhaps on Windows' question on the desktop (#1300).
    const { currentMicCaptureWaiting } = useStore_MicCaptureWaiting();
    const recallLog = () => { openLog(); asyncStdoutToPython("/run/vr_panel_recall_log"); };
    // The text to speech switch and its stop, as the main window shows them (#1314, V-4). A press
    // asks the main window to press its own (vr-panel-voice), which checks and answers as it does.
    const { currentVrVoiceControls } = useStore_VrVoiceControls();
    const voice = currentVrVoiceControls.data;
    const ttsState: SwitchStatus = { data: voice.tts.on, state: voice.tts.pending ? "pending" : "ok" };
    const askMain = (action: "toggle_tts" | "stop") => { sendToMain("vr-panel-voice", action).catch(console.error); };
    return <div className={styles.root} style={{ "--intro-logo": `url("${intro_logo}")` }}>
        {intro === "playing" && <>
            <img className={styles.intro_icon} src={intro_icon} alt="" aria-hidden="true" />
            <div className={styles.intro_logo} aria-hidden="true" />
        </>}
        <div className={clsx(styles.container, { [styles.is_intro_pending]: intro === "pending", [styles.is_intro_playing]: intro === "playing" })}>
            <div className={styles.group} role="group" aria-label={t("vr_panel.tooltip.functions_group")}>
                <FunctionButton Svg={TranslationSvg} label={t("vr_panel.tooltip.translate")} name={t("main_page.translation")}
                    state={currentTranslationStatus} block={blockOf("translation", currentTranslationStatus)} onClick={toggleTranslation} is_locked={is_locked} />
                <FunctionButton Svg={MicSvg} label={t("vr_panel.tooltip.microphone")} name={t("main_page.transcription_send")}
                    state={currentTranscriptionSendStatus} block={blockOf("transcription_send", currentTranscriptionSendStatus)} onClick={toggleTranscriptionSend} is_locked={is_locked}
                    waiting={currentMicCaptureWaiting.data === true} />
                <FunctionButton Svg={HeadphonesSvg} label={t("vr_panel.tooltip.listen")} name={t("main_page.transcription_receive")}
                    state={currentTranscriptionReceiveStatus} block={blockOf("transcription_receive", currentTranscriptionReceiveStatus)} onClick={toggleTranscriptionReceive} is_locked={is_locked} />
                <FunctionButton Svg={ChatTranscribeSvg} label={t("vr_panel.tooltip.chat_detect")} name={t("main_page.ocr")}
                    state={currentOcrCaptureStatus} block={blockOf("ocr", currentOcrCaptureStatus)} onClick={toggleOcrCapture} is_locked={is_locked} />
                <FunctionButton Svg={TtsSpeakerSvg} label={t("vr_panel.tooltip.tts")} name={t("main_page.tts")}
                    state={ttsState} block={blockOf("tts", ttsState)} onClick={() => askMain("toggle_tts")} is_locked={is_locked} />
            </div>
            {/* The stop follows the switch it stops, with no divider: it is not a window (#1314, V-4). */}
            <div className={styles.group} role="group" aria-label={t("vr_panel.tooltip.stop_group")}>
                <StopButton stop={voice.stop} onClick={() => askMain("stop")} />
            </div>
            <span className={styles.divider} aria-hidden="true" />
            <div className={styles.group} role="group" aria-label={t("vr_panel.tooltip.windows_group")}>
                <WindowButton Svg={CopyThinSvg} label={is_log_lost ? t("vr_panel.recall_log") : t("vr_panel.window_log")}
                    name={t("vr_panel.window_log")} is_open={windows.log} is_attention={is_log_lost}
                    onClick={is_log_lost ? () => asyncStdoutToPython("/run/vr_panel_recall_log") : toggleLog} onLongPress={recallLog} />
                {/* The language, inputs and outputs, and VR settings windows share one button, which lists
                    them (VrWindowsMenu). While one of them is open, it closes that window. */}
                <WindowButton Svg={WindowsSvg} label={t("vr_panel.window_more")}
                    is_open={windows.popup !== null} onClick={() => togglePopup(windows.popup ?? "windows")} />
            </div>
        </div>
    </div>;
};

interface FunctionButtonProps {
    Svg: Svg;
    label: string;
    name: string;
    state: SwitchStatus;
    block: SwitchBlock | null | undefined;
    onClick: () => void;
    is_locked: boolean;
    // The switch's device waits to open, perhaps on a question on the desktop (#1300).
    waiting?: boolean;
}

// A blocked switch (its setup is missing) is greyed out with a mark, does nothing when pressed,
// and says in its tooltip what is missing and where on the PC to provide it. That tooltip shows
// even when the tooltips are turned off: there is nowhere else in VR to read it. So does the hint
// of a switch whose device waits to open, as Windows' microphone question on the desktop holds
// it (#1300, decided on 2026-11-28); the switch stays as it is, and can be turned off. That hint is
// the panel's own short text (#1314, V-1): a tooltip taller than 104 px is never shown, so every
// help text here fits two lines (VrTooltipText.test.ts).
const FunctionButton = ({ Svg, label, name, state, block, onClick, is_locked, waiting = false }: FunctionButtonProps) => {
    const { t } = useI18n();
    const is_pending = state.state === "pending";
    const is_blocked = !is_locked && !!block;
    const is_waiting = !is_locked && !is_blocked && waiting;
    // The state in the UI's words (#1314, V-3): Japanese says オン／オフ, as everywhere else (#476).
    const status = [state.data === true ? t("vr_panel.tooltip.state_on") : t("vr_panel.tooltip.state_off"), is_locked ? t("vr_panel.tooltip.config_open") :
        is_blocked ? t("vr_panel.switch_blocked.state") : is_pending ? t("vr_panel.settings.changing_short") : ""]
        .filter(Boolean).join(" · ");
    const mark = is_locked ? "locked" : is_blocked ? "blocked" : is_pending || is_waiting ? "pending" : null;
    return <VrTooltipButton className={clsx(shared.button, styles.button, {
        [shared.is_on]: state.data === true, [styles.is_pending]: is_pending,
        [styles.is_disabled]: is_locked || is_blocked, [styles.is_blocked]: is_blocked,
    })} aria-label={name} aria-pressed={state.data === true} aria-disabled={is_pending || is_locked || is_blocked || undefined}
        aria-busy={is_pending || undefined} tipTitle={label} tipState={status} tipForce={is_blocked || is_waiting}
        tipHelp={is_locked ? t("vr_panel.locked_by_config_page") : block && is_blocked ? t(`vr_panel.switch_blocked.${block.reason}`) :
            is_waiting ? (micWaitSystem() === "windows" ? t("vr_panel.mic_wait.windows") : t("vr_panel.mic_wait.linux")) :
            is_pending ? t("vr_panel.tooltip.busy_help") : t(`vr_panel.tooltip.${state.data === true ? "disable" : "enable"}`)}
        onClick={() => { if (!is_pending && !is_locked && !is_blocked) onClick(); }}>
        <Svg className={styles.icon} aria-hidden="true" />
        {mark && <span className={styles.state_mark} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d={STATE_MARKS[mark]} /></svg>
        </span>}
    </VrTooltipButton>;
};

const STATE_MARKS = {
    locked: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
    pending: "M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4",
    // An exclamation mark in a circle: something has to be set up first.
    blocked: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7.5v6M12 16.5v.5",
};

// The stop of the main window's top bar (#1314, V-4): it stops what is read aloud and empties the
// queue (/run/stop_voice). Like the bar's, its words are red, it is drawn at half strength while there
// is nothing to stop, and it answers its press ("stopping", then "stopped"). The stop is never locked:
// it has to work whenever something is read aloud (PRODUCT.md).
const StopButton = ({ stop, onClick }: { stop: VoiceStopState; onClick: () => void }) => {
    const { t } = useI18n();
    const busy = stop.phase !== "idle";
    const state = stop.phase === "stopping" ? t("voice_ui.topbar_stopping") : stop.phase === "stopped" ? t("voice_ui.topbar_stopped")
        : stop.offered ? "" : t("vr_panel.tooltip.stop_idle");
    return <VrTooltipButton className={clsx(shared.button, styles.button, styles.stop_button, { [styles.is_idle]: !stop.offered && !busy })}
        aria-label={t("voice_ui.topbar_stop")} aria-disabled={!stop.offered || busy || undefined} aria-busy={stop.phase === "stopping" || undefined}
        tipTitle={t("voice_ui.topbar_stop")} tipState={state} tipHelp={stop.offered ? t("vr_panel.tooltip.stop_help") : t("vr_panel.tooltip.stop_idle_help")}
        onClick={() => { if (stop.offered && !busy) onClick(); }}>
        <StopSvg className={styles.icon} aria-hidden="true" />
    </VrTooltipButton>;
};

interface WindowButtonProps {
    Svg: Svg;
    label: string;
    name?: string;
    is_open: boolean;
    is_attention?: boolean;
    onClick: () => void;
    onLongPress?: (() => void) | null;
}

// A button with a long press (the log) says so only in its tooltip, so that tooltip shows even
// when the tooltips are turned off, as a blocked switch's does: nothing else in VR says it.
const WindowButton = ({ Svg, label, name = label, is_open, is_attention = false, onClick, onLongPress = null }: WindowButtonProps) => {
    const { t } = useI18n();
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const long_pressed = useRef(false);
    const [is_holding, setIsHolding] = useState(false);
    const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); };
    const stopTimer = () => { clearTimer(); timer.current = null; setIsHolding(false); };
    useEffect(() => {
        // The overlay releases outside the button when tracking or input ownership is lost.
        document.addEventListener("mouseup", stopTimer, true);
        document.addEventListener("mouseleave", stopTimer);
        document.addEventListener("pointercancel", stopTimer, true);
        window.addEventListener("blur", stopTimer);
        return () => {
            clearTimer();
            document.removeEventListener("mouseup", stopTimer, true);
            document.removeEventListener("mouseleave", stopTimer);
            document.removeEventListener("pointercancel", stopTimer, true);
            window.removeEventListener("blur", stopTimer);
        };
    }, []);
    const onMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        clearTimer();
        long_pressed.current = false;
        if (!onLongPress) return;
        setIsHolding(true);
        timer.current = setTimeout(() => { long_pressed.current = true; stopTimer(); onLongPress(); }, LONG_PRESS_MS);
    };
    return <VrTooltipButton className={clsx(shared.button, styles.button, styles.window_button, {
        [shared.is_on]: is_open, [styles.is_attention]: is_attention, [styles.is_holding]: is_holding,
    })} aria-label={is_attention ? t("vr_panel.recall_log") : name} aria-pressed={is_open}
        tipTitle={name} tipState={t(`vr_panel.tooltip.${is_holding ? "holding" : is_attention ? "lost" : is_open ? "open" : "hidden"}`)}
        tipHelp={t(`vr_panel.tooltip.${is_holding ? "holding_help" : is_attention ? "click_recall" :
            onLongPress ? (is_open ? "log_close_help" : "log_open_help") : is_open ? "close_view" : "open_view"}`)}
        tipForce={onLongPress !== null}
        onMouseDown={onMouseDown} onMouseUp={stopTimer} onMouseLeave={stopTimer} onBlur={stopTimer}
        onClick={() => { if (!long_pressed.current) onClick(); long_pressed.current = false; }}>
        <Svg className={styles.icon} aria-hidden="true" />
    </VrTooltipButton>;
};
