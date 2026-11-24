import clsx from "clsx";
import { useI18n } from "@useI18n";

import * as styles from "./LanguageSwapButton.css.ts";

import NarrowArrowDownSvg from "@images/narrow_arrow_down.svg?react";
import { useLanguageSettings } from "@logics_main";
import { Button } from "../../../../../kit/index.ts";

// Always named and drawn as what pressing it does (#569): the visible words and the accessible
// name are the same 「言語を入れ替え」, so the button is recognised without pointing at it. It has
// no tooltip: a tooltip does not repeat words that are in sight (#614). It is the kit's plain
// Button at the compact size. It stays focusable while the language settings are busy
// (aria-disabled), and Enter and Space act on the key going down, once while it is held, as they
// did before the kit: the key's own press of the button is held back so it does not act twice.
export const LanguageSwapButton = () => {
    const { t } = useI18n();
    const { canChangeLanguageSettings, isLanguageSettingsBusy, swapSelectedLanguages } = useLanguageSettings();
    const label = t("main_page.swap_button_label");

    return (
        <div className={styles.container}>
            <Button
                size="compact"
                aria-disabled={isLanguageSettingsBusy}
                onClick={() => { if (canChangeLanguageSettings()) swapSelectedLanguages(); }}
                aria-label={label}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; if (canChangeLanguageSettings()) swapSelectedLanguages(); } }}
            >
                <NarrowArrowDownSvg className={clsx(styles.narrow_arrow_down_svg, styles.reverse)} aria-hidden="true" />
                <span className={styles.label}>{label}</span>
                <NarrowArrowDownSvg className={styles.narrow_arrow_down_svg} aria-hidden="true" />
            </Button>
        </div>
    );
};
