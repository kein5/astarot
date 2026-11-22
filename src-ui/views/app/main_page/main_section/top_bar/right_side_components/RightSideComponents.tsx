import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import styles from "./RightSideComponents.module.scss";
import RefreshSvg from "@images/refresh.svg?react";
import HelpSvg from "@images/help.svg?react";
import TuneSvg from "@images/mui_discover_tune.svg?react";
import FlowSvg from "@images/io_flow.svg?react";

import { useStore_OpenedQuickSetting, useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import {
    useIsOscAvailable,
} from "@logics_common";
import { useAppUpdate } from "../../../../../../logics/common/useAppUpdate";

import {
    useAppearance,
    useOthers,
} from "@logics_configs";
import { useOverlayQuickToggle } from "../../../../../../logics/configs/useOverlayQuickToggle";
import { revealSetting } from "../../../../../../logics/configs/revealSetting.ts";
import { pageLinkLabel } from "../../../../config_page/setting_section/setting_box/_components/page_pointer/PagePointer";
import { useMainFunction } from "@logics_main";
import { useIoFlow } from "../../../../../../logics/flow/useIoFlow";
import { OpenQuickSettingButton } from "./_buttons/OpenQuickSettingButton";
import { VrchatPresence } from "../../../../others/vrchat_presence/VrchatPresence";
import { Tooltip } from "../../../../../common_components/tooltip/Tooltip";

import { generateLocalizedDocumentUrl } from "@ui_configs";
import type { TargetHolder } from "../../../../../../logics/common/targetHolder.ts";

export const RightSideComponents = () => {
    const { t } = useI18n();
    const { currentUiLanguage } = useAppearance();

    return (
        <div className={styles.container}>
            <SoftwareUpdateAvailableButton />
            <IoFlowButton />
            <QuickSettingsMenu />
            <Tooltip bare placement="bottom" title={t("main_page.help_link")}>
                <a
                    className={styles.help_and_info_button}
                    aria-label={t("main_page.help_link")}
                    href={generateLocalizedDocumentUrl(currentUiLanguage.data).vrct_document_ui_guide_url}
                    target="_blank"
                    rel="noreferrer"
                >
                    <HelpSvg className={styles.help_svg} aria-hidden="true" />
                </a>
            </Tooltip>
        </div>
    );
};

// The window and VRChat toggles a conversation rarely needs: always on top,
// VRChat microphone mute sync and the subtitle overlay. One button opens them
// and says how many are on, so the bar keeps its room for stop and mute.
// Each is switched in place (#939): the subtitle overlay too, whose position and
// look are set on the captions and VR page, which a line under it opens.
// It closes with Escape (focus returns to the button), a press outside, or
// when focus moves elsewhere. Its tooltip is its name: drawn where a narrow bar
// hides the words, and left out where they are in sight (Tooltip).
const QuickSettingsMenu = () => {
    const { t } = useI18n();
    const { currentForegroundStatus, toggleForeground } = useMainFunction();
    const { currentIsOscAvailable, oscUnavailableLabelKey } = useIsOscAvailable();
    const { currentEnableVrcMicMuteSync, toggleEnableVrcMicMuteSync } = useOthers();
    const overlay = useOverlayQuickToggle();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null);
    const panel = useId();

    useEffect(() => {
        if (!open) return;
        const leave = (event: Event) => { const menu: TargetHolder | null = root.current; if (!menu?.contains(event.target)) setOpen(false); };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            opener.current?.focus();
        };
        document.addEventListener("pointerdown", leave);
        document.addEventListener("focusin", leave);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", leave);
            document.removeEventListener("focusin", leave);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);

    const on = [currentForegroundStatus.data, currentEnableVrcMicMuteSync.data, overlay.on].filter(value => value === true).length;
    // The overlays' position, look and timing: the captions and VR page, opened on them.
    const openOverlaySettings = () => {
        setOpen(false);
        updateSelectedConfigTabId("vr");
        updateIsOpenedConfigPage(true);
        revealSetting({ setting_id: "vr_overlay" });
    };
    const sync_available = currentIsOscAvailable.data !== false;

    return (
        <div ref={root} className={styles.menu}>
            <Tooltip bare placement="bottom" title={t("main_page.quick_settings")}>
                <button ref={opener} type="button" className={clsx(styles.menu_button, { [styles.has_on]: on > 0 })}
                    aria-expanded={open} aria-controls={panel}
                    onClick={() => setOpen(value => !value)}>
                    <TuneSvg className={styles.menu_svg} aria-hidden="true" />
                    <span className={styles.menu_text}>
                        <span className={styles.menu_label}>{t("main_page.quick_settings")}</span>
                        <span className={styles.menu_state}>
                            {on > 0 ? t("main_page.quick_settings_on", { count: on }) : t("main_page.quick_settings_all_off")}
                        </span>
                    </span>
                </button>
            </Tooltip>
            {open && <div id={panel} className={styles.menu_panel} role="group" aria-label={t("main_page.quick_settings")}>
                <OpenQuickSettingButton
                    row
                    label={t("main_page.foreground")}
                    variable={currentForegroundStatus.data}
                    state={currentForegroundStatus.state}
                    onClickFunction={toggleForeground}
                />
                <OpenQuickSettingButton
                    row
                    label={t("config_page.others.vrc_mic_mute_sync.label")}
                    variable={currentEnableVrcMicMuteSync.data}
                    state={currentEnableVrcMicMuteSync.state}
                    is_available={currentIsOscAvailable.data}
                    note={sync_available ? null : t(oscUnavailableLabelKey)}
                    onClickFunction={() => { if (sync_available) toggleEnableVrcMicMuteSync(); }}
                />
                <OpenQuickSettingButton
                    row
                    label={t("config_page.vr.section_label_overlay")}
                    variable={overlay.on}
                    is_pending={overlay.pending}
                    onClickFunction={overlay.toggle}
                />
                <button type="button" className={styles.menu_link} onClick={openOverlaySettings}>
                    {pageLinkLabel(t, "vr", t("main_page.overlay_settings_action"))}</button>
                {/* Within reach of the conversation: can a message sent now arrive in VRChat? */}
                <VrchatPresence className={styles.menu_readout} />
            </div>}
        </div>
    );
};

// Opens the panel that shows where the user's voice and chat go, and how long each took.
// What the panel shows is the button's tooltip and its accessible description.
const IoFlowButton = () => {
    const { t } = useI18n();
    const { isPanelOpen, togglePanel } = useIoFlow();
    const hint = t("io_flow.open_hint");
    const hintId = useId();
    return (
        <Tooltip bare placement="bottom" title={hint}>
            <button type="button" className={clsx(styles.menu_button, { [styles.has_on]: isPanelOpen })}
                aria-expanded={isPanelOpen} aria-controls="io_flow_panel" aria-describedby={hintId} onClick={togglePanel}>
                <FlowSvg className={styles.menu_svg} aria-hidden="true" />
                <span className={styles.menu_text}>
                    <span className={styles.menu_label}>{t("io_flow.open")}</span>
                </span>
                <span id={hintId} hidden>{hint}</span>
            </button>
        </Tooltip>
    );
};

// Shown once a check (at start or on the update page) found a new version; opens the update page.
// That a version is out is a state, shown by a mark on the update icon and the short word with
// the version (「更新 0.6.1」, #766); the sentence that announces it is the button's tooltip and its
// accessible description. A narrow bar keeps the icon and its mark (RightSideComponents.module.scss).
const SoftwareUpdateAvailableButton = () => {
    const { t } = useI18n();
    const { appUpdate } = useAppUpdate();
    const { updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const sentenceId = useId();

    if (!["available", "downloading", "installing"].includes(appUpdate.status)) return null;
    const sentence = t("main_page.update_available");
    // The version the check found; a check that names none leaves the word alone.
    const label = appUpdate.version ? t("main_page.update_button", { version: appUpdate.version }) : t("main_page.update_button_plain");

    return (
        <Tooltip bare placement="bottom" title={sentence}>
            <button type="button" className={styles.software_update_button} aria-describedby={sentenceId}
                onClick={()=>updateOpenedQuickSetting("update_software")}>
                <span className={styles.update_icon}>
                    <RefreshSvg className={styles.refresh_svg} aria-hidden="true"/>
                    <span className={styles.update_mark} aria-hidden="true" />
                </span>
                <span className={styles.software_update_label}>{label}</span>
                <span id={sentenceId} hidden>{sentence}</span>
            </button>
        </Tooltip>
    );
};
