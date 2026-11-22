import type { ComponentType, SVGProps } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import styles from "./AddRemoveTargetLanguageButtons.module.scss";
import RemoveSvg from "@images/remove.svg?react";
import AddSvg from "@images/add.svg?react";

import { useLanguageSettings } from "@logics_main";

export const AddRemoveTargetLanguageButtons = () => {
    const { t } = useI18n();
    const {
        currentSelectedPresetTabNumber,
        currentSelectedTargetLanguages,
        canChangeLanguageSettings,
        isLanguageSettingsBusy,
        removeTargetLanguage,
        addTargetLanguage,
    } = useLanguageSettings();

    // A second target can be removed once it is on; a third can be added until it is on.
    const targets = currentSelectedTargetLanguages.data[currentSelectedPresetTabNumber.data];
    const removable = targets["2"].enable === true;
    const addable = targets["3"].enable !== true;

    // One rule for the look, the pointer and the keyboard: a button that looks unavailable
    // does nothing when pressed, by mouse or by Enter and Space.
    const button = (allowed: boolean, action: () => void, label: string, className: string | undefined,
        Icon: ComponentType<SVGProps<SVGSVGElement>>, iconClass: string | undefined) => {
        const press = () => { if (allowed && canChangeLanguageSettings()) action(); };
        return (
            <div className={clsx(className, { [styles.is_disabled]: !allowed, [styles.is_busy]: isLanguageSettingsBusy })}
                aria-disabled={!allowed || isLanguageSettingsBusy} onClick={press}
                role="button" tabIndex={0} aria-label={label}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; press(); } }}>
                <Icon className={iconClass} aria-hidden="true" />
            </div>
        );
    };

    return (
        <div className={styles.add_remove_target_language_container}>
            {button(removable, removeTargetLanguage, t("main_page.remove_target_language"),
                styles.remove_target_language_button, RemoveSvg, styles.remove_svg)}
            {button(addable, addTargetLanguage, t("main_page.add_target_language"),
                styles.add_target_language_button, AddSvg, styles.add_svg)}
        </div>
    );
};
