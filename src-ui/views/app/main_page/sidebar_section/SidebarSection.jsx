import { useEffect, useRef } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import ArrowLeftSvg from "@images/arrow_left.svg?react";

import styles from "./SidebarSection.module.scss";
import { useStore_IsOpenedLanguageSelector } from "@store";
import { useIsMainPageCompactMode } from "@logics_main";

import { Logo } from "./logo/Logo";
import { MainFunctionSwitch } from "./main_function_switch/MainFunctionSwitch";
import { LanguageSettings } from "./language_settings/LanguageSettings";
import { LanguageReadout } from "./language_readout/LanguageReadout";
import { OpenSettings } from "./open_settings/OpenSettings";

export const SidebarSection = () => {
    const { t } = useI18n();
    const { currentIsMainPageCompactMode, isAutomaticCompact, toggleIsMainPageCompactMode } = useIsMainPageCompactMode();
    // A narrow window keeps the icon rail; its toggle opens the full rail over the
    // conversation for a moment instead of squeezing the conversation beside it.
    const is_overlay = isAutomaticCompact === true && currentIsMainPageCompactMode.data === false;
    const container_class_name = clsx(styles.container, {
        [styles.is_compact_mode]: currentIsMainPageCompactMode.data,
        [styles.is_overlay]: is_overlay,
    });

    const { currentIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const scroll_container_class_names = clsx(styles.scroll_container, {
        [styles.is_opened]: (currentIsOpenedLanguageSelector.data.your_language === true || currentIsOpenedLanguageSelector.data.target_language === true)
    });

    const root = useRef(null);
    const latest = useRef(toggleIsMainPageCompactMode);
    latest.current = toggleIsMainPageCompactMode;
    // Focus goes back to the top bar's toggle: what had it in the rail is gone.
    const close = () => {
        latest.current();
        document.querySelector("[data-sidebar-toggle]")?.focus();
    };
    // The opened rail closes like a menu: its own close button, Escape, or a press
    // outside it. The top bar's toggle is under the rail.
    useEffect(() => {
        if (!is_overlay) return;
        const outside = event => {
            if (root.current?.contains(event.target)) return;
            if (event.target?.closest?.("[data-sidebar-toggle]")) return;
            latest.current();
        };
        const escape = event => {
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
            {is_overlay && <button type="button" className={styles.close_overlay} aria-label={t("studio.close_sidebar")}
                title={t("studio.close_sidebar")} onClick={close}>
                <ArrowLeftSvg className={styles.close_overlay_svg} preserveAspectRatio="none" aria-hidden="true" />
            </button>}
            <div className={scroll_container_class_names}>
                <MainFunctionSwitch />
                {currentIsMainPageCompactMode.data ? <LanguageReadout /> : <LanguageSettings />}
            </div>
            <OpenSettings />
        </div>
    );
};
