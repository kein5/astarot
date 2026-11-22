import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "@useI18n";
import styles from "./LanguageSettings.module.scss";
import { PresetTabSelector } from "./preset_tab_selector/PresetTabSelector";
import { LanguageSelectorOpenButton } from "./language_selector_open_button/LanguageSelectorOpenButton";
import { LanguageSwapButton } from "./language_swap_button/LanguageSwapButton";
import { TranslatorSelectorOpenButton } from "./translator_selector_open_button/TranslatorSelectorOpenButton";
import { AddRemoveTargetLanguageButtons } from "./add_remove_target_language_buttons/AddRemoveTargetLanguageButtons";
import { useStore_IsOpenedTranslatorSelector } from "@store";
import type { TargetHolder } from "../../../../../logics/common/targetHolder.ts";

// The element the pointer left for. The pointer can also leave for no element at all.
const isElement = (target: EventTarget | null): target is Element =>
    target !== null && "getBoundingClientRect" in target && "contains" in target && typeof target.contains === "function";

// The pointer left for the scrollbar of the rail around this part: the scrollbar is the
// ancestor's own, to the right of its content box.
export const isOnAncestorScrollbar = (event: MouseEvent<HTMLElement>) => {
    const element = event.relatedTarget;
    if (!isElement(element) || !element.contains(event.currentTarget)) return false;
    const bounds = element.getBoundingClientRect();
    return event.clientX >= bounds.left + element.clientLeft + element.clientWidth;
};

export const LanguageSettings = () => {
    const { t } = useI18n();
    const { updateIsOpenedTranslatorSelector } = useStore_IsOpenedTranslatorSelector();
    // The translator list closes when the pointer leaves the language settings, but not for
    // the rail's scrollbar, which scrolls the list into view. From the scrollbar the pointer
    // can go straight on to the conversation, and no mouseleave comes here again then: so the
    // list closes as soon as the pointer is over anything outside this part (#563).
    const stopWatching = useRef<(() => void) | null>(null);
    const endWatch = () => { stopWatching.current?.(); stopWatching.current = null; };
    useEffect(() => endWatch, []);
    const closeTranslatorSelector = (event: MouseEvent<HTMLDivElement>) => {
        endWatch();
        if (!isOnAncestorScrollbar(event)) {
            updateIsOpenedTranslatorSelector(false);
            return;
        }
        const container: TargetHolder = event.currentTarget;
        const page = event.currentTarget.ownerDocument;
        if (!page) return;
        const movedOn = (over: globalThis.MouseEvent) => {
            endWatch();
            if (!container.contains(over.target)) updateIsOpenedTranslatorSelector(false);
        };
        page.addEventListener("mouseover", movedOn, true);
        stopWatching.current = () => page.removeEventListener("mouseover", movedOn, true);
    };

    return (
        <div className={styles.container} onMouseLeave={closeTranslatorSelector}>
            {/* The heading and the three presets share a row. */}
            <div className={styles.header}>
                <p className={styles.title}>{t("main_page.language_settings")}</p>
                <PresetTabSelector />
            </div>
            <PresetContainer />
        </div>
    );
};

import MicSvg from "@images/mic.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import { useMainFunction } from "@logics_main";

const PresetContainer = () => {
    const { currentTranscriptionSendStatus, currentTranscriptionReceiveStatus } = useMainFunction();

    const yourLanguageSettings = {
        TurnedOnSvgComponent: MicSvg,
        is_turned_on: currentTranscriptionSendStatus.data,
    };

    const targetLanguageSettings = {
        TurnedOnSvgComponent: HeadphonesSvg,
        is_turned_on: currentTranscriptionReceiveStatus.data,
    };

    return (
        <div className={styles.preset_container}>
            <LanguageSelectorOpenButton {...yourLanguageSettings} selector_key="your_language" target_key="1"/>
            <LanguageSwapButton />
            <div className={styles.target_language_containers}>
                <LanguageSelectorOpenButton {...targetLanguageSettings} selector_key="target_language" target_key="1" />
                <LanguageSelectorOpenButton {...targetLanguageSettings} selector_key="target_language" target_key="2" />
                <LanguageSelectorOpenButton {...targetLanguageSettings} selector_key="target_language" target_key="3" />
            </div>
            <AddRemoveTargetLanguageButtons />
            <TranslatorSelectorOpenButton />
        </div>
    );
};
