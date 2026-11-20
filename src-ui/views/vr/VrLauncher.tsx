import { useEffect, useRef, useState } from "react";
import type { ComponentType, MouseEvent, SVGProps } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useIsOpenedConfigPage, useVrPanelLogOutOfView, useVrPanelLauncherIntro } from "@logics_common";
import { useStdoutToPython } from "@useStdoutToPython";
import { useMainFunction } from "@logics_main";
import { useStore_SwitchBlocks } from "@store";
import { activeSwitchBlock } from "../../logics/main/switchBlocks";
import type { SwitchBlock, SwitchBlockId, SwitchStatus } from "../../logics/main/switchBlocks";
import TranslationSvg from "@images/translation.svg?react";
import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import ChatTranscribeSvg from "@images/chat_transcribe.svg?react";
import CopyThinSvg from "@images/copy_thin.svg?react";
import ConfigurationSvg from "@images/configuration.svg?react";
import LanguageSvg from "@images/mui_language.svg?react";
import FlowSvg from "@images/io_flow.svg?react";
// The intro shows ASTAROT's own mark, like the About page: this is not the official VRCT.
import intro_icon from "@images/brand/icon-small.svg";
import intro_logo from "@images/brand/logo.svg";
import { VrTooltipButton } from "./VrTooltip";
import type { VrPopup } from "./VrPopupWindow";
import shared from "./VrSettingsWindow.module.scss";
import styles from "./VrLauncher.module.scss";

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
    const recallLog = () => { openLog(); asyncStdoutToPython("/run/vr_panel_recall_log"); };
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
                    state={currentTranscriptionSendStatus} block={blockOf("transcription_send", currentTranscriptionSendStatus)} onClick={toggleTranscriptionSend} is_locked={is_locked} />
                <FunctionButton Svg={HeadphonesSvg} label={t("vr_panel.tooltip.listen")} name={t("main_page.transcription_receive")}
                    state={currentTranscriptionReceiveStatus} block={blockOf("transcription_receive", currentTranscriptionReceiveStatus)} onClick={toggleTranscriptionReceive} is_locked={is_locked} />
                <FunctionButton Svg={ChatTranscribeSvg} label={t("vr_panel.tooltip.chat_detect")} name={t("main_page.ocr")}
                    state={currentOcrCaptureStatus} block={blockOf("ocr", currentOcrCaptureStatus)} onClick={toggleOcrCapture} is_locked={is_locked} />
            </div>
            <span className={styles.divider} aria-hidden="true" />
            <div className={styles.group} role="group" aria-label={t("vr_panel.tooltip.windows_group")}>
                <WindowButton Svg={CopyThinSvg} label={is_log_lost ? t("vr_panel.recall_log") : t("vr_panel.window_log")}
                    name={t("vr_panel.window_log")} is_open={windows.log} is_attention={is_log_lost}
                    onClick={is_log_lost ? () => asyncStdoutToPython("/run/vr_panel_recall_log") : toggleLog} onLongPress={recallLog} />
                <WindowButton Svg={LanguageSvg} label={t("vr_panel.window_language")}
                    is_open={windows.popup === "language"} onClick={() => togglePopup("language")} />
                <WindowButton Svg={FlowSvg} label={t("io_flow.vr_window")}
                    is_open={windows.popup === "io_flow"} onClick={() => togglePopup("io_flow")} />
                <WindowButton Svg={ConfigurationSvg} label={t("vr_panel.window_settings")}
                    is_open={windows.popup === "settings"} onClick={() => togglePopup("settings")} />
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
}

// A blocked switch (its setup is missing) is greyed out with a mark, does nothing when pressed,
// and says in its tooltip what is missing and where on the PC to provide it. That tooltip shows
// even when the tooltips are turned off: there is nowhere else in VR to read it.
const FunctionButton = ({ Svg, label, name, state, block, onClick, is_locked }: FunctionButtonProps) => {
    const { t } = useI18n();
    const is_pending = state.state === "pending";
    const is_blocked = !is_locked && !!block;
    const status = [state.data === true ? "ON" : "OFF", is_locked ? t("vr_panel.tooltip.config_open") :
        is_blocked ? t("vr_panel.switch_blocked.state") : is_pending ? t("vr_panel.settings.changing_short") : ""]
        .filter(Boolean).join(" · ");
    const mark = is_locked ? "locked" : is_blocked ? "blocked" : is_pending ? "pending" : null;
    return <VrTooltipButton className={clsx(shared.button, styles.button, {
        [shared.is_on]: state.data === true, [styles.is_pending]: is_pending,
        [styles.is_disabled]: is_locked || is_blocked, [styles.is_blocked]: is_blocked,
    })} aria-label={name} aria-pressed={state.data === true} aria-disabled={is_pending || is_locked || is_blocked || undefined}
        aria-busy={is_pending || undefined} tipTitle={label} tipState={status} tipForce={is_blocked}
        tipHelp={is_locked ? t("vr_panel.locked_by_config_page") : block && is_blocked ? t(`vr_panel.switch_blocked.${block.reason}`) :
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
