import { useEffect, useRef } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import ArrowLeftSvg from "@images/arrow_left.svg?react";
import { Tooltip } from "../../../common_components/tooltip/Tooltip";

import * as styles from "./SidebarSection.css.ts";
import { useIsMainPageCompactMode } from "@logics_main";

import { Logo } from "./logo/Logo";
import { MainFunctionSwitch } from "./main_function_switch/MainFunctionSwitch";
import { LanguageSettings } from "./language_settings/LanguageSettings";
import { LanguageReadout } from "./language_readout/LanguageReadout";
import { OpenSettings } from "./open_settings/OpenSettings.tsx";

// The top bar's toggle (SidebarCompactModeButton) carries this attribute.
const TOGGLE = "[data-sidebar-toggle]";

const isNode = (target: EventTarget | null): target is Node => target !== null && "nodeType" in target;
const isElement = (target: EventTarget | null): target is Element => isNode(target) && "closest" in target;

export const SidebarSection = () => {
    const { t } = useI18n();
    const { currentIsMainPageCompactMode, isAutomaticCompact, toggleIsMainPageCompactMode } = useIsMainPageCompactMode();
    // A narrow window keeps the icon rail; its toggle opens the full rail over the
    // conversation for a moment instead of squeezing the conversation beside it.
    const is_overlay = isAutomaticCompact === true && currentIsMainPageCompactMode.data === false;
    const container_class_name = clsx(styles.container, {
        [styles.isCompactMode]: currentIsMainPageCompactMode.data,
        [styles.isOverlay]: is_overlay,
    });

    const root = useRef<HTMLDivElement>(null);
    const latest = useRef(toggleIsMainPageCompactMode);
    latest.current = toggleIsMainPageCompactMode;
    // Focus goes back to the top bar's toggle: what had it in the rail is gone.
    const close = () => {
        latest.current();
        document.querySelector<HTMLElement>(TOGGLE)?.focus();
    };
    // The opened rail closes like a menu: its own close button, Escape, or a press
    // outside it. The top bar's toggle is under the rail.
    useEffect(() => {
        if (!is_overlay) return;
        const outside = (event: PointerEvent) => {
            if (isNode(event.target) && root.current?.contains(event.target)) return;
            // The toggle handles its own press; closing here as well would reopen the rail.
            if (isElement(event.target) && event.target.closest(TOGGLE)) return;
            latest.current();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            close();
        };
        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    }, [is_overlay]);

    return (
        <div ref={root} className={container_class_name}>
            <Logo />
            {/* The top bar's toggle is under the opened rail; this one is on it. */}
            {is_overlay && <Tooltip bare placement="right" title={t("studio.close_sidebar")}>
                <button type="button" className={styles.closeOverlay} aria-label={t("studio.close_sidebar")} onClick={close}>
                    <ArrowLeftSvg className={styles.closeOverlaySvg} preserveAspectRatio="none" aria-hidden="true" />
                </button>
            </Tooltip>}
            <div className={styles.scrollContainer}>
                <MainFunctionSwitch />
                {currentIsMainPageCompactMode.data ? <LanguageReadout /> : <LanguageSettings />}
            </div>
            <OpenSettings />
        </div>
    );
};
