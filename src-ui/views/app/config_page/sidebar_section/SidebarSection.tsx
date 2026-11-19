import styles from "./SidebarSection.module.scss";
import { useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import {
    useStore_SelectedConfigTabId,
    useStore_IsBreakPoint,
} from "@store";
import { useUsagePresets } from "@logics_configs";

import MicSvg from "@images/mic.svg?react";
import TtsSpeakerSvg from "@images/tts_speaker.svg?react";
import VoiceConversionSvg from "@images/voice_conversion.svg?react";
import AppearanceSvg from "@images/mui_palette.svg?react";
import TranslationSvg from "@images/translation.svg?react";
import GraphicEqSvg from "@images/mui_graphic_eq.svg?react";
import HMDSvg from "@images/mui_head_mounted_device.svg?react";
import KeyboardAltSvg from "@images/mui_keyboard_alt.svg?react";
import CodeBlocksSvg from "@images/mui_code_blocks.svg?react";
import ScienceSvg from "@images/mui_science.svg?react";
import RefreshSvg from "@images/refresh.svg?react";
import ChatTranscribeSvg from "@images/chat_transcribe.svg?react";
import DocumentScannerSvg from "@images/mui_document_scanner.svg?react";

import vrct_vox_icon from "@images/brand/icon-small.svg";

import { VersionLabel } from "../version_label/VersionLabel";
import { splitFeatureLabel } from "../../../../logics/common/featureLabel.ts";
import { visibleMenuGroups } from "../../../../logics/configs/settingsMenu.ts";
import { isTabShown, pickedPresets } from "../../../../logics/configs/usagePresets.ts";
import { UsagePresetSelector } from "./usage_presets/UsagePresetSelector.tsx";
import type { SettingsMenuGroup } from "../../../../logics/configs/settingsMenu.ts";

// Keyboard focus expands the rail; focus from a click or from opening the page does
// not, or the rail would stay over the page after the pointer left. A focus counts as
// keyboard focus when a key was pressed just before it (:focus-visible is not
// reliable for this in WebKitGTK). Text fields always keep it open for typing.
let lastKeyDownAt = -Infinity;
if (typeof window !== "undefined") {
    window.addEventListener("keydown", () => { lastKeyDownAt = performance.now(); }, true);
}
const isKeyboardFocus = (element: Element) =>
    element.matches?.("input:not([type=checkbox]):not([type=radio]), textarea") === true
    || performance.now() - lastKeyDownAt < 1000;

export const SidebarSection = () => {
    const { t } = useI18n();
    const { currentIsBreakPoint } = useStore_IsBreakPoint();
    const [isPointerOver, setIsPointerOver] = useState(false);
    const [hasKeyboardFocus, setHasKeyboardFocus] = useState(false);
    // Expand for the pointer and for keyboard focus (see isKeyboardFocus).
    const isHovered = isPointerOver || hasKeyboardFocus;

    const container_class_names = clsx(styles.container, {
        [styles.is_small]: currentIsBreakPoint.data,
        [styles.is_expanded]: isHovered,
    });

    const isCompact = currentIsBreakPoint.data && !isHovered;
    // The uses picked at the top choose the pages in the menu (usagePresets.ts). The page open
    // now stays in it, also when the search or a main page button opened it.
    const { currentUsagePresets } = useUsagePresets();
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const picked = pickedPresets(currentUsagePresets.data);
    const groups = visibleMenuGroups(tab => isTabShown(picked, tab, tab === currentSelectedConfigTabId.data));

    return (
        <div
            className={container_class_names}
            onMouseEnter={() => setIsPointerOver(true)}
            onMouseLeave={() => setIsPointerOver(false)}
            onFocusCapture={event => setHasKeyboardFocus(isKeyboardFocus(event.target))}
            onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHasKeyboardFocus(false); }}
        >
            <div className={styles.scroll_container}>
                <div className={styles.scroll_content}>
                    <UsagePresetSelector isCompact={isCompact} />
                    {/* Four groups, each under its heading, in the order a conversation uses them (#554). */}
                    <nav className={styles.tabs_wrapper} aria-label={t("config_page.side_menu_label")}>
                        {groups.map(group => (
                            <TabGroup key={group.id} group={group} isSmall={currentIsBreakPoint.data} isHovered={isHovered} />
                        ))}
                    </nav>
                </div>
                <VersionLabel isCompact={isCompact} />
            </div>
        </div>
    );
};

type TabIconProps = {
    tab_id: string;
    className?: string;
};

export const TabIcon = ({ tab_id, className }: TabIconProps) => {
    switch (tab_id) {
        case "tts": return <TtsSpeakerSvg className={className} />;
        case "rvc": return <VoiceConversionSvg className={className} />;
        case "device": return <MicSvg className={className} />;
        case "appearance": return <AppearanceSvg className={clsx(className, styles.mui_icon)} />;
        case "translation": return <TranslationSvg className={className} />;
        case "transcription": return <GraphicEqSvg className={clsx(className, styles.mui_icon)} />;
        case "vrchat": return <ChatTranscribeSvg className={clsx(className, styles.mui_icon, styles.ocr_icon)} />;
        case "ocr": return <DocumentScannerSvg className={clsx(className, styles.mui_icon)} />;
        case "vr": return <HMDSvg className={clsx(className, styles.mui_icon)} />;
        case "hotkeys": return <KeyboardAltSvg className={clsx(className, styles.mui_icon)} />;
        case "advanced_settings": return <CodeBlocksSvg className={clsx(className, styles.mui_icon)} />;
        case "experimental_features": return <ScienceSvg className={clsx(className, styles.mui_icon)} />;
        case "updater": return <RefreshSvg className={clsx(className, styles.updater_icon)} />;
        case "about_vrct": return <img alt="" src={vrct_vox_icon} className={clsx(className, styles.about_vrct_icon)} />;
        default: return null;
    }
};

// One group of the menu: its heading, then its pages. The icon rail has no room for the
// heading's words; a thin rule stands for it there, and the group keeps its name for
// screen readers.
type TabGroupProps = {
    group: SettingsMenuGroup;
    isSmall: boolean;
    isHovered: boolean;
};

const TabGroup = ({ group, isSmall, isHovered }: TabGroupProps) => {
    const { t } = useI18n();
    const headingId = `settings_menu_group_${group.id}`;
    const isCompact = isSmall && !isHovered;
    return (
        <div role="group" aria-labelledby={headingId} className={styles.tab_group}>
            <p id={headingId} className={clsx(styles.group_label, { [styles.is_compact]: isCompact })}>
                <span className={styles.group_label_text}>{t(`config_page.side_menu_groups.${group.id}`)}</span>
            </p>
            {group.tabs.map(tab_id => <Tab key={tab_id} tab_id={tab_id} isSmall={isSmall} isHovered={isHovered} />)}
        </div>
    );
};

type TabProps = {
    tab_id: string;
    isSmall: boolean;
    isHovered: boolean;
};

const Tab = (props: TabProps) => {
    const { t } = useI18n();
    const { updateSelectedConfigTabId, currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const onclickFunction = () => {
        updateSelectedConfigTabId(props.tab_id);
    };

    const is_selected = currentSelectedConfigTabId.data === props.tab_id;

    const tab_container_class_names = clsx(styles["tab_container"], {
        [styles["is_selected"]]: is_selected,
        [styles["is_small"]]: props.isSmall && !props.isHovered
    });
    const switch_indicator_class_names = clsx(styles["switch_indicator"], {
        [styles["is_selected"]]: is_selected
    });

    const getLabel = () => t(`config_page.side_menu_labels.${props.tab_id}`);
    // Every tab is one line, so the tabs are all the same height and the menu does not change
    // its layout with the language or the font. A feature's short name in brackets (「（ASR）」)
    // did not fit beside its name in the 20.8rem rail and took a second line; the menu shows the
    // name, and the full name stays in the tooltip, for screen readers and on the page itself.
    const fullLabel = getLabel();
    const label = splitFeatureLabel(fullLabel);

    return (
        <button type="button" className={tab_container_class_names} aria-label={fullLabel} aria-current={is_selected ? "page" : undefined}
            title={label.abbr ? fullLabel : undefined} onClick={onclickFunction}>
            <div className={styles.tab_icon_wrapper} aria-hidden="true">
                <TabIcon tab_id={props.tab_id} className={styles.tab_icon} />
            </div>
            <p className={clsx(styles.tab_text, {
                [styles.hide]: props.isSmall && !props.isHovered
            })}>{label.name}</p>
            <div className={switch_indicator_class_names}></div>
        </button>
    );
};