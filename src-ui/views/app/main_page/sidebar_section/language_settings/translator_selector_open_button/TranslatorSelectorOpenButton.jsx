import { useI18n } from "@useI18n";
import styles from "./TranslatorSelectorOpenButton.module.scss";
import { TranslatorSelector } from "./translator_selector/TranslatorSelector";
import { useStore_IsOpenedTranslatorSelector } from "@store";
import { useLanguageSettings } from "@logics_main";
import WarningSvg from "@images/warning.svg?react";
import { isSameLanguageSelected } from "../../../../../../logics/main/sameLanguage.ts";

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
        return selected_engine?.label;
    };

    const is_loading = currentTranslationEngines.state === "pending";
    const selected_label = is_loading ? t("common.loading") : getSelectedLabel();


    const { currentIsOpenedTranslatorSelector, updateIsOpenedTranslatorSelector} = useStore_IsOpenedTranslatorSelector();

    const openTranslatorSelector = () => {
        updateIsOpenedTranslatorSelector(!currentIsOpenedTranslatorSelector.data);
    };

    return (
        <div className={styles.container}>
            <div className={styles.translator_selector_button} onClick={openTranslatorSelector}
                role="button" tabIndex={0} aria-expanded={currentIsOpenedTranslatorSelector.data === true} onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; openTranslatorSelector(); } }}>
                <p className={styles.label}>{t("main_page.translator")}:</p>
                <p className={styles.label} data-skeleton="">{selected_label}</p>
                {is_selected_same_language
                    ? <WarningSvg className={styles.warning_svg}/>
                    : null
                }
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