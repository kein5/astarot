import { useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";

import styles from "./LanguageSwapButton.module.scss";

import NarrowArrowDownSvg from "@images/narrow_arrow_down.svg?react";
import { useLanguageSettings } from "@logics_main";

const focusVisible = element => {
    try { return element.matches(":focus-visible"); }
    catch { return true; }
};

export const LanguageSwapButton = () => {
    // Pointed at or focused from the keyboard, the words say what pressing does (#476).
    const [isHovered, setIsHovered] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const isActive = isHovered || isFocused;
    const { t } = useI18n();
    const { canChangeLanguageSettings, isLanguageSettingsBusy, swapSelectedLanguages } = useLanguageSettings();

    const label = isActive
        ? t("main_page.swap_button_label")
        : t("main_page.translate_each_other_label");

    const labelClassName = clsx(styles["label"], {
        [styles["is_hovered"]]: isActive
    });

    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => setIsHovered(false);

    return (
        <div className={styles.container}>
            <div
                className={styles.swap_button_wrapper}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                // Keyboard focus only: a click's focus would keep the words after the pointer leaves.
                onFocus={event => setIsFocused(focusVisible(event.currentTarget))}
                onBlur={() => setIsFocused(false)}
                title={t("main_page.swap_button_label")}
                aria-disabled={isLanguageSettingsBusy}
                onClick={() => { if (canChangeLanguageSettings()) swapSelectedLanguages(); }}
                role="button" tabIndex={0} aria-label={t("main_page.swap_button_label")}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; if (canChangeLanguageSettings()) swapSelectedLanguages(); } }}
            >
                <NarrowArrowDownSvg className={clsx(styles.narrow_arrow_down_svg, styles.reverse)} aria-hidden="true" />
                <p className={labelClassName}>{label}</p>
                <NarrowArrowDownSvg className={styles.narrow_arrow_down_svg} aria-hidden="true" />
            </div>
        </div>
    );
};
