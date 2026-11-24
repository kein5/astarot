import { useId } from "react";
import type { ComponentType, SVGProps } from "react";
import { useI18n } from "@useI18n";
import { createLanguageNames } from "../../../../../../logics/common/languageNames.ts";
import clsx from "clsx";
import * as styles from "./LanguageSelectorOpenButton.css.ts";
import ArrowLeftSvg from "@images/arrow_left.svg?react";
import { Tooltip } from "../../../../../common_components/tooltip/Tooltip";
import { Button } from "../../../../../kit/index.ts";
import { useStore_IsOpenedLanguageSelector } from "@store";
import {
    useIsMainPageCompactMode,
    useLanguageSettings,
} from "@logics_main";

// Which side of the pair the button opens the language list for.
export type LanguageSelectorKey = "your_language" | "target_language";

type LanguageSelectorOpenButtonProps = {
    TurnedOnSvgComponent: ComponentType<SVGProps<SVGSVGElement>>;
    is_turned_on: boolean;
    selector_key: LanguageSelectorKey;
    // The slot of that side ("1" to "3").
    target_key: string;
};

export const LanguageSelectorOpenButton = ({ TurnedOnSvgComponent, is_turned_on, selector_key, target_key }: LanguageSelectorOpenButtonProps) => {
    const { t, i18n } = useI18n();
    const { updateIsOpenedLanguageSelector, currentIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const { closeOverlay } = useIsMainPageCompactMode();
    const hint_id = useId();

    const {
        currentSelectedPresetTabNumber,
        currentSelectedYourLanguages,
        currentSelectedTargetLanguages,
    } = useLanguageSettings();

    const is_opened = currentIsOpenedLanguageSelector.data[selector_key] === true && currentIsOpenedLanguageSelector.data.target_key === target_key;

    const toggleSelector = () => {
        if (is_opened) { // Close Language Selector
            updateIsOpenedLanguageSelector({ your_language: false, target_language: false, target_key: "1" });
        } else { // Open Language Selector
            // The selector opens in the conversation column; the rail opened over it in a
            // narrow window would cover its back button and search field.
            closeOverlay();
            updateIsOpenedLanguageSelector({
                your_language: selector_key === "your_language",
                target_language: selector_key === "target_language",
                target_key: target_key,
            });
        }
    };

    const arrow_class_names = clsx(styles.arrow_left_svg, {
        [styles.reverse]: is_opened,
    });

    const category_class_names = clsx(styles.category_svg, {
        [styles.is_turned_on]: is_turned_on,
    });

    const getVariable = (target_selector_key: LanguageSelectorKey) => {
        if (target_selector_key === "your_language") return currentSelectedYourLanguages.data[currentSelectedPresetTabNumber.data];
        return currentSelectedTargetLanguages.data[currentSelectedPresetTabNumber.data];
    };

    const getTitle = (target_selector_key: LanguageSelectorKey) => {
        if (target_selector_key === "your_language") return t("main_page.your_language");
        if (currentSelectedTargetLanguages.data[currentSelectedPresetTabNumber.data]["2"].enable === false) return t("main_page.target_language");
        return `${t("main_page.target_language")} ${target_key}`;
    };

    const title = getTitle(selector_key);
    // What this language is for, in both directions (#569); the swap button no longer says that
    // the pair is translated both ways. It is the field's tooltip and accessible description, so
    // the rail keeps its height; the language list shows it as a line.
    const hint = selector_key === "your_language" ? t("main_page.your_language_hint") : t("main_page.target_language_hint");

    if (getVariable(selector_key)[target_key].enable === false) return null;

    const display = createLanguageNames(i18n.language).name(getVariable(selector_key)[target_key]);
    const language_text = display.language || t("common.loading");
    const country_text = display.country;

    return (
        <div className={styles.container}>
            <div className={styles.title_container}>
                <TurnedOnSvgComponent className={category_class_names} />
                <p className={styles.title}>{title}</p>
            </div>
            {/* A button so the selector also opens from the keyboard: the kit's plain Button at the
                compact size, its language and arrow centered as the kit draws them (decided on
                2026-11-25). */}
            <Tooltip bare placement="right" title={hint}>
                <Button size="compact" onClick={toggleSelector}
                    aria-label={country_text ? `${title}: ${language_text} (${country_text})` : `${title}: ${language_text}`} aria-expanded={is_opened}
                    aria-describedby={hint_id}>
                    <span className={styles.selected_language} data-skeleton="">{language_text}</span>
                    {country_text && <span className={styles.selected_language} data-skeleton="">({country_text})</span>}
                    <ArrowLeftSvg className={arrow_class_names} aria-hidden="true" />
                </Button>
            </Tooltip>
            <span id={hint_id} className={styles.visually_hidden}>{hint}</span>
        </div>
    );
};
