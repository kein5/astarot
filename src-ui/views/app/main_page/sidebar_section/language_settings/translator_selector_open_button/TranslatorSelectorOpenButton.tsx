import { useRef } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./TranslatorSelectorOpenButton.css.ts";
import { TranslatorSelector } from "./translator_selector/TranslatorSelector";
import { useStore_IsOpenedTranslatorSelector } from "@store";
import { useLanguageSettings } from "@logics_main";
import WarningSvg from "@images/warning.svg?react";
import ArrowLeftSvg from "@images/arrow_left.svg?react";
import clsx from "clsx";
import { Button, Popover, PopoverTrigger } from "../../../../../kit/index.ts";
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

    const is_opened = currentIsOpenedTranslatorSelector.data === true;
    const setOpened = (opened: boolean) => { updateIsOpenedTranslatorSelector(opened); };
    const title = t("main_page.translator");
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Like a language above it: its role as a small heading, then the engine as the kit's plain
    // Button at the compact size, centered as the kit draws it, whose arrow points right where the
    // list opens. The list is the kit's Popover (D-25, decided on 2026-11-25): the button opens and
    // closes it (aria-expanded), and whether it is open is the store's, as other places open it too
    // (useOpenTranslatorList). Enter and Space act on the key going down, once while it is held, as
    // they did before the kit: the key's own press of the button is held back so it does not act
    // twice. While the engine starts, the whole button is the placeholder (data-skeleton,
    // MainPage.css.ts) and its words are hidden.
    return (
        <div className={styles.container}>
            <p className={styles.title}>{title}</p>
            <Popover open={is_opened} onOpenChange={setOpened}>
                <PopoverTrigger asChild>
                    <Button ref={buttonRef} size="compact" data-skeleton=""
                        aria-label={selected_label ? `${title}: ${selected_label.replace(/\s+/g, " ")}` : title}
                        onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; setOpened(!is_opened); } }}>
                        <span className={styles.label}>{selected_label}</span>
                        {is_selected_same_language
                            ? <WarningSvg className={styles.warning_svg} aria-hidden="true"/>
                            : null
                        }
                        <ArrowLeftSvg className={clsx(styles.arrow_svg, { [styles.is_opened]: is_opened })} aria-hidden="true" />
                    </Button>
                </PopoverTrigger>
                {is_opened &&
                    <TranslatorSelector
                        anchorRef={buttonRef}
                        selected_id={selected_engine_id}
                        translation_engines={translation_engines}
                        is_selected_same_language={is_selected_same_language}
                    />
                }
            </Popover>
        </div>
    );
};
