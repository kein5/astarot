import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import * as styles from "./TranslatorSelector.css.ts";
import { useI18n } from "@useI18n";

import { chunkArray } from "@utils";
import { useStore_IsOpenedTranslatorSelector } from "@store";
import { useLanguageSettings } from "@logics_main";
import type { TranslatorStatus } from "@ui_configs";
import { LOCAL_TRANSLATION_ENGINE_NAME_KEY, translatorLabel } from "../../../../../../../logics/main/translatorLabel.ts";
import { isAnchorInScrollport, placeTranslatorPopover } from "./translatorPlacement.ts";

// Space between the rail/button and the popover, and to the window's edges, in rem.
const GAP = 0.8;
const MARGIN = 0.8;

const isNode = (target: EventTarget | null): target is Node => target !== null && "nodeType" in target;

type TranslatorSelectorProps = {
    id?: string;
    anchorRef?: RefObject<HTMLElement | null>;
    selected_id: string | undefined;
    translation_engines: TranslatorStatus[];
    is_selected_same_language: boolean;
};

export const TranslatorSelector = ({ id, anchorRef, selected_id, translation_engines, is_selected_same_language }: TranslatorSelectorProps) => {
    const { t } = useI18n();
    const { updateIsOpenedTranslatorSelector } = useStore_IsOpenedTranslatorSelector();
    const columns = chunkArray(translation_engines, 2);
    // Unavailable engines leave the tab order, so their reason cannot wait for
    // focus: it is on screen, and it describes the group the keyboard enters.
    const reason_id = useId();
    const has_unavailable = translation_engines.some(engine => !engine.is_available);
    const panel = useRef<HTMLDivElement>(null);
    const [place, setPlace] = useState<CSSProperties | null>(null);
    const closeRef = useRef(updateIsOpenedTranslatorSelector);
    closeRef.current = updateIsOpenedTranslatorSelector;

    // Places the popover beside the rail from its trigger's box so it never pushes the rail
    // or the conversation (#1095). Tracks rail scroll and window resize, and closes if the
    // trigger scrolls out of sight.
    useLayoutEffect(() => {
        const anchor = anchorRef?.current;
        const box = panel.current;
        if (!anchor || !box || typeof window === "undefined") return;
        const update = () => {
            const anchorRect = anchor.getBoundingClientRect();
            const scrollport = anchor.closest("[data-sidebar-scroll]")?.getBoundingClientRect();
            if (scrollport && !isAnchorInScrollport(anchorRect, scrollport)) {
                closeRef.current(false);
                return;
            }
            const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
            const railRect = anchor.closest("[data-sidebar-rail]")?.getBoundingClientRect();
            const mainRect = anchor.closest("[data-main-page]")?.getBoundingClientRect();
            const rect = box.getBoundingClientRect();
            const next = placeTranslatorPopover({
                anchor: anchorRect,
                railRight: railRect ? railRect.right : anchorRect.right,
                panel: { width: rect.width, height: box.scrollHeight || rect.height },
                viewport: { width: window.innerWidth, height: window.innerHeight },
                gap: GAP * rem,
                margin: MARGIN * rem,
                topEdge: mainRect ? mainRect.top : 0,
            });
            setPlace({ left: next.left, top: next.top, maxHeight: next.maxHeight });
        };
        update();
        const onScroll = (event: Event) => {
            if (isNode(event.target) && box.contains(event.target)) return;
            update();
        };
        window.addEventListener("resize", update);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [anchorRef, translation_engines.length, is_selected_same_language, has_unavailable]);

    // Moves keyboard focus into the portaled popover without scrolling anything, and closes
    // on Escape (focus back to the trigger), a press outside, or focus leaving the trigger
    // and popover.
    useEffect(() => {
        if (typeof document === "undefined") return;
        panel.current?.focus?.({ preventScroll: true });
        const outside = (event: Event) => {
            if (!isNode(event.target)) return;
            if (panel.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
            closeRef.current(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeRef.current(false);
            anchorRef?.current?.focus?.({ preventScroll: true });
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("focusin", outside);
        // Capture phase so Escape closes only the popover before a parent overlay (SidebarSection).
        document.addEventListener("keydown", closeOnEscape, true);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("focusin", outside);
            document.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [anchorRef]);

    const returnFocus = () => { anchorRef?.current?.focus?.({ preventScroll: true }); };

    const content = (
        <div ref={panel} id={id} data-translator-selector="" tabIndex={-1} className={styles.container}
            style={place ?? (anchorRef ? { left: 0, top: 0, visibility: "hidden" } : undefined)}>
            <div className={styles.relative_container} role="group" aria-label={t("main_page.translator")}
                aria-describedby={has_unavailable || is_selected_same_language ? reason_id : undefined}>
                {has_unavailable && !is_selected_same_language &&
                    <p id={reason_id} className={styles.unavailable_hint}>{t("main_page.translator_selector.unavailable_hint")}</p>
                }
                <div className={styles.wrapper}>
                    {columns.map((column, column_index) => (
                        <div className={styles.column_wrapper} key={`column_${column_index}`}>
                            {column.map(({ id: engineId, label, is_available, is_default }) => (
                                <TranslatorBox
                                    key={engineId}
                                    id={engineId}
                                    label={translatorLabel({ id: engineId, label }, t)}
                                    is_available={is_available}
                                    is_default={is_default}
                                    is_selected={(engineId === selected_id)}
                                    reason_id={reason_id}
                                    onPicked={returnFocus}
                                />
                            ))}
                        </div>
                    ))}
                </div>
                {is_selected_same_language ?
                    <div className={styles.is_selected_same_language_wrapper}>
                        <p id={reason_id} className={styles.is_selected_same_language_text}>
                            {t("main_page.translator_selector.is_selected_same_language", {
                                your_language: t("main_page.your_language"),
                                target_language: t("main_page.target_language"),
                                local_engine: t(LOCAL_TRANSLATION_ENGINE_NAME_KEY),
                            })}
                        </p>
                    </div>
                : null
                }
            </div>
        </div>
    );
    const page = globalThis.document?.body;
    return page ? createPortal(content, page) : content;
};

type TranslatorBoxProps = {
    id: string;
    label: string;
    is_available: boolean;
    is_default: boolean | undefined;
    is_selected: boolean;
    reason_id: string;
    onPicked: () => void;
};

const TranslatorBox = (props: TranslatorBoxProps) => {
    const { t } = useI18n();
    const { canChangeLanguageSettings, isLanguageSettingsBusy, setSelectedTranslationEngines } = useLanguageSettings();
    const { updateIsOpenedTranslatorSelector } = useStore_IsOpenedTranslatorSelector();

    const box_class_name = clsx(
        styles.box,
        { [styles.is_selected]: props.is_selected },
        { [styles.is_available]: props.is_available }
    );
    const label_default_class_name = clsx(
        styles.label_default,
        { [styles.is_selected]: props.is_selected },
    );

    const selectTranslator = () => {
        // The stylesheet blocks the pointer on an unavailable engine; the keyboard
        // must not select it either.
        if (!props.is_available) return;
        if (!canChangeLanguageSettings()) return;
        if (props.is_selected === false) {
            setSelectedTranslationEngines(props.id);
        }
        updateIsOpenedTranslatorSelector(false);
        props.onPicked();
    };

    // Like a disabled button, an unavailable engine leaves the tab order.
    return (
        <div className={box_class_name} aria-disabled={isLanguageSettingsBusy || !props.is_available} onClick={selectTranslator}
            aria-describedby={props.is_available ? undefined : props.reason_id}
            role="button" tabIndex={props.is_available ? 0 : -1} aria-pressed={!!props.is_selected} onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; selectTranslator(); } }}>
            <p className={styles.translator_name}>{props.label}</p>
            {props.is_default && <p className={label_default_class_name}>{t("common.default_label")}</p>}
        </div>
    );
};