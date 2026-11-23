import { useI18n } from "@useI18n";
import * as styles from "./TranslatorSelectorOpenButton.css.ts";
import { TranslatorSelector } from "./translator_selector/TranslatorSelector";
import { useStore_IsOpenedTranslatorSelector } from "@store";
import { useLanguageSettings } from "@logics_main";
import WarningSvg from "@images/warning.svg?react";
import ArrowLeftSvg from "@images/arrow_left.svg?react";
import clsx from "clsx";
import { isSameLanguageSelected } from "../../../../../../logics/main/sameLanguage.ts";
import { translatorLabel } from "../../../../../../logics/main/translatorLabel.ts";

export const TranslatorSelectorOpenButton = () => {
    const { t } = useI18n();
    const {
        currentSelectedYourLanguages,
        currentSelectedTargetLanguages,
        currentSelectedPresetTabNumber,
        currentTranslationEngines,
        currentSelectedTranslationEngines,
    } = useLanguageSettings();

    // const new_labels = [
    //     {id: "CTranslate2", label: "AI\nCTranslate2"}
    // ];

    const translation_engines = currentTranslationEngines.data;
    // const translation_engines = updateLabelsById(currentTranslationEngines.data, new_labels);

    const selected_engine_id = currentSelectedTranslationEngines.data[currentSelectedPresetTabNumber.data];

    const is_selected_same_language = isSameLanguageSelected(
        currentSelectedYourLanguages.data[currentSelectedPresetTabNumber.data]?.["1"],
        currentSelectedTargetLanguages.data[currentSelectedPresetTabNumber.data],
    );

    const getSelectedLabel = () => {

        const selected_engine = translation_engines.find(
            d => d.id === selected_engine_id
        );
        return translatorLabel(selected_engine, t);
    };

    const is_loading = currentTranslationEngines.state === "pending";
    const selected_label = is_loading ? t("common.loading") : getSelectedLabel();


    const { currentIsOpenedTranslatorSelector, updateIsOpenedTranslatorSelector} = useStore_IsOpenedTranslatorSelector();

    const openTranslatorSelector = () => {
        updateIsOpenedTranslatorSelector(!currentIsOpenedTranslatorSelector.data);
    };

    const is_opened = currentIsOpenedTranslatorSelector.data === true;
    const title = t("main_page.translator");

    // Like a language above it: its role as a small heading, then the engine as a
    // field-like button whose arrow says the list opens below it.
    return (
        <div className={styles.container}>
            <p className={styles.title}>{title}</p>
            <div className={styles.translator_selector_button} onClick={openTranslatorSelector}
                role="button" tabIndex={0} aria-expanded={is_opened}
                aria-label={selected_label ? `${title}: ${selected_label.replace(/\s+/g, " ")}` : title}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; openTranslatorSelector(); } }}>
                <span className={styles.label} data-skeleton="">{selected_label}</span>
                {is_selected_same_language
                    ? <WarningSvg className={styles.warning_svg} aria-hidden="true"/>
                    : null
                }
                <ArrowLeftSvg className={clsx(styles.arrow_svg, { [styles.is_opened]: is_opened })} aria-hidden="true" />
            </div>
            {currentIsOpenedTranslatorSelector.data &&
                <TranslatorSelector
                    selected_id={selected_engine_id}
                    translation_engines={translation_engines}
                    is_selected_same_language={is_selected_same_language}
                />
            }
        </div>
    );
};