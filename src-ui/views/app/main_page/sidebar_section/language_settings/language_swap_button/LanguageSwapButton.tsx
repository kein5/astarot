import clsx from "clsx";
import { useI18n } from "@useI18n";

import * as styles from "./LanguageSwapButton.css.ts";

import NarrowArrowDownSvg from "@images/narrow_arrow_down.svg?react";
import { useLanguageSettings } from "@logics_main";

// Always named and drawn as what pressing it does (#569): the visible words and the accessible
// name are the same 「言語を入れ替え」, so the button is recognised without pointing at it. It has
// no tooltip: a tooltip does not repeat words that are in sight (#614).
export const LanguageSwapButton = () => {
    const { t } = useI18n();
    const { canChangeLanguageSettings, isLanguageSettingsBusy, swapSelectedLanguages } = useLanguageSettings();
    const label = t("main_page.swap_button_label");

    return (
        <div className={styles.container}>
            <div
                className={styles.swap_button_wrapper}
                aria-disabled={isLanguageSettingsBusy}
                onClick={() => { if (canChangeLanguageSettings()) swapSelectedLanguages(); }}
                role="button" tabIndex={0} aria-label={label}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; if (canChangeLanguageSettings()) swapSelectedLanguages(); } }}
            >
                <NarrowArrowDownSvg className={clsx(styles.narrow_arrow_down_svg, styles.reverse)} aria-hidden="true" />
                <p className={styles.label}>{label}</p>
                <NarrowArrowDownSvg className={styles.narrow_arrow_down_svg} aria-hidden="true" />
            </div>
        </div>
    );
};
