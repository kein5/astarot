import { useId, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import * as styles from "./TranslatorSelector.css.ts";
import { useI18n } from "@useI18n";

import { useStore_IsOpenedTranslatorSelector } from "@store";
import { useLanguageSettings } from "@logics_main";
import { useOpenSettings } from "../../../../../../../logics/common/useOpenSettings.ts";
import type { TranslatorStatus } from "@ui_configs";
import { LOCAL_TRANSLATION_ENGINE_NAME_KEY, translatorLabel } from "../../../../../../../logics/main/translatorLabel.ts";
import { isAnchorInScrollport, translatorPanelMaxHeight, translatorPopoverSide } from "./translatorPlacement.ts";
import type { PopoverSide } from "./translatorPlacement.ts";
import { Button, PopoverContent, ToggleGroup, ToggleGroupItem } from "../../../../../../kit/index.ts";

// Space between the rail/button and the popover, and to the window's edges, in rem.
const GAP = 0.8;
const MARGIN = 0.8;
// The panel's width, in rem: three engines a row, narrower in a window that cannot hold it. Radix
// mounts the panel after the button, so the side it opens on is chosen from this, not measured.
const PANEL = 38;
const PANEL_WIDTH = `min(${PANEL}rem, calc(100vw - ${2 * MARGIN}rem))`;

type TranslatorSelectorProps = {
    anchorRef?: RefObject<HTMLElement | null>;
    selected_id: string | undefined;
    translation_engines: TranslatorStatus[];
    is_selected_same_language: boolean;
};

// Where the panel opens, the room it keeps from the window's edges and how tall it may be, in px;
// until measured, beside the button.
type Place = PopoverSide & { top: number; edge: number; maxHeight?: number };
const UNMEASURED: Place = { side: "right", align: "end", sideOffset: 0, top: 0, edge: 0 };

const isNode = (target: EventTarget | null): target is Node => target !== null && "nodeType" in target;

// The translator list, the content of the kit's Popover that the translator button opens
// (TranslatorSelectorOpenButton.tsx; D-25, decided on 2026-11-25). It floats beside the rail, out of
// the rail's flow, so neither the rail nor the conversation moves (#1095), and holds the engines as
// the kit's ToggleGroup (D-27): radios named by the engines, the one in use checked, each a stop of
// the Tab key (rovingFocus off), as the engine buttons were. Opening it moves the focus to the panel
// without scrolling anything. Escape closes it and gives the focus back to the button; a press
// outside or the focus leaving it closes it and leaves the focus where it went; so does the button
// scrolling out of sight in the rail. Choosing an engine, or the one in use, closes it and gives the
// focus back to the button.
// A greyed engine says by its grey that it cannot be used now; why is its description for screen
// readers, and the way to set it up is a button under the engines that opens the translation
// settings, not a sentence that sends the user there (#1266 T-7).
export const TranslatorSelector = ({ anchorRef, selected_id, translation_engines, is_selected_same_language }: TranslatorSelectorProps) => {
    const { t } = useI18n();
    const { updateIsOpenedTranslatorSelector } = useStore_IsOpenedTranslatorSelector();
    const { canChangeLanguageSettings, setSelectedTranslationEngines } = useLanguageSettings();
    const openSettings = useOpenSettings();
    // Unavailable engines leave the tab order, so their reason cannot wait for
    // focus: it is on screen, and it describes the group the keyboard enters.
    const reason_id = useId();
    const has_unavailable = translation_engines.some(engine => !engine.is_available);
    const panel = useRef<HTMLDivElement>(null);
    const [place, setPlace] = useState<Place>(UNMEASURED);
    const closeRef = useRef(updateIsOpenedTranslatorSelector);
    closeRef.current = updateIsOpenedTranslatorSelector;
    // Whether the panel closes because of something outside it, which keeps the focus where it went.
    const outside = useRef(false);

    // The side it opens on, from the button's, the rail's and the window's boxes, again when the
    // window's size changes. It closes when the button scrolls out of sight in the rail; Radix moves
    // the panel with the button while it is in sight.
    useLayoutEffect(() => {
        const anchor = anchorRef?.current;
        if (!anchor || typeof window === "undefined") return;
        const update = () => {
            const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
            const anchorRect = anchor.getBoundingClientRect();
            const railRect = anchor.closest("[data-sidebar-rail]")?.getBoundingClientRect();
            const mainRect = anchor.closest("[data-main-page]")?.getBoundingClientRect();
            const side = translatorPopoverSide({
                anchor: anchorRect,
                railRight: railRect ? railRect.right : anchorRect.right,
                panelWidth: PANEL * rem,
                viewportWidth: window.innerWidth,
                gap: GAP * rem,
                margin: MARGIN * rem,
            });
            const topEdge = mainRect ? mainRect.top : 0;
            const maxHeight = translatorPanelMaxHeight({ viewportHeight: window.innerHeight, topEdge, margin: MARGIN * rem });
            setPlace({ ...side, top: topEdge + MARGIN * rem, edge: MARGIN * rem, maxHeight });
        };
        const onScroll = (event: Event) => {
            const scrollport = anchor.closest("[data-sidebar-scroll]");
            const target = event.target;
            // The panel's own scrolling, or another part's, is not the rail's.
            if (!scrollport || !isNode(target) || !target.contains(anchor)) return;
            if (isAnchorInScrollport(anchor.getBoundingClientRect(), scrollport.getBoundingClientRect())) return;
            outside.current = true;
            closeRef.current(false);
        };
        update();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [anchorRef]);

    // Choosing an engine (the one in use too) closes the list; while the language settings are
    // busy, the choice waits and the list stays open.
    const pick = (id: string) => {
        if (!canChangeLanguageSettings()) return;
        if (id !== selected_id) setSelectedTranslationEngines(id);
        updateIsOpenedTranslatorSelector(false);
    };

    return (
        <PopoverContent ref={panel} data-translator-selector="" className={styles.container} style={{ width: PANEL_WIDTH, maxHeight: place.maxHeight }}
            aria-label={t("main_page.translator")}
            side={place.side} align={place.align} sideOffset={place.sideOffset}
            collisionPadding={{ top: place.top, right: place.edge, bottom: place.edge, left: place.edge }}
            onOpenAutoFocus={event => { event.preventDefault(); panel.current?.focus({ preventScroll: true }); }}
            onInteractOutside={() => { outside.current = true; }}
            onCloseAutoFocus={event => {
                event.preventDefault();
                if (!outside.current) anchorRef?.current?.focus({ preventScroll: true });
                outside.current = false;
            }}>
            <div className={styles.relative_container}>
                {has_unavailable && !is_selected_same_language &&
                    <span id={reason_id} className={styles.visually_hidden}>{t("main_page.translator_selector.unavailable_reason")}</span>
                }
                <ToggleGroup type="single" rovingFocus={false} className={styles.engines} value={selected_id ?? ""}
                    aria-label={t("main_page.translator")} aria-describedby={has_unavailable || is_selected_same_language ? reason_id : undefined}
                    onValueChange={value => { const id = value || selected_id; if (id) pick(id); }}>
                    <div className={styles.wrapper}>
                        {translation_engines.map(({ id: engineId, label, is_available, is_default }) => (
                            <TranslatorBox
                                key={engineId}
                                id={engineId}
                                label={translatorLabel({ id: engineId, label }, t)}
                                is_available={is_available}
                                is_default={is_default}
                                reason_id={reason_id}
                                onPick={pick}
                            />
                        ))}
                    </div>
                </ToggleGroup>
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
                {has_unavailable && !is_selected_same_language &&
                    <Button className={styles.settings} data-translator-settings=""
                        onClick={() => { updateIsOpenedTranslatorSelector(false); openSettings({ page: "translation" }); }}>
                        {t("main_page.feature_settings.open_page", { page: t("config_page.side_menu_labels.translation") })}
                    </Button>}
            </div>
        </PopoverContent>
    );
};

type TranslatorBoxProps = {
    id: string;
    label: string;
    is_available: boolean;
    is_default: boolean | undefined;
    reason_id: string;
    onPick: (id: string) => void;
};

// One engine, an item of the kit's ToggleGroup. An unavailable one is disabled, so it leaves the tab
// order and the pointer cannot choose it, and the reason describes it; the keyboard cannot choose it
// either. While the language settings are busy, an engine stays focusable but dimmed
// (aria-disabled). Enter and Space act on the key going down, once while it is held.
const TranslatorBox = (props: TranslatorBoxProps) => {
    const { t } = useI18n();
    const { isLanguageSettingsBusy } = useLanguageSettings();

    const selectTranslator = () => {
        if (!props.is_available) return;
        props.onPick(props.id);
    };

    return (
        <ToggleGroupItem value={props.id} className={styles.box} disabled={!props.is_available}
            aria-disabled={props.is_available ? isLanguageSettingsBusy : undefined}
            aria-describedby={props.is_available ? undefined : props.reason_id}
            onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; selectTranslator(); } }}>
            <span className={styles.engine}>
                <span className={styles.translator_name}>{props.label}</span>
                {props.is_default && <span className={styles.label_default}>{t("common.default_label")}</span>}
            </span>
        </ToggleGroupItem>
    );
};
