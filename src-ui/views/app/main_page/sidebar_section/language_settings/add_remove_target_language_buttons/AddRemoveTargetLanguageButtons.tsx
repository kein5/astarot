import type { ComponentType, SVGProps } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import * as styles from "./AddRemoveTargetLanguageButtons.css.ts";
import RemoveSvg from "@images/remove.svg?react";
import AddSvg from "@images/add.svg?react";
import { Button } from "../../../../../kit/index.ts";

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
    // does nothing when pressed, by mouse or by Enter and Space. Each is the kit's icon Button; it
    // stays focusable while unavailable (aria-disabled, not disabled). Enter and Space act on the
    // key going down, once while it is held, as they did before the kit: the key's own press of
    // the button is held back so it does not act a second time.
    const button = (allowed: boolean, action: () => void, label: string,
        Icon: ComponentType<SVGProps<SVGSVGElement>>) => {
        const press = () => { if (allowed && canChangeLanguageSettings()) action(); };
        return (
            <Button size="icon" className={clsx({ [styles.is_disabled]: !allowed })}
                aria-disabled={!allowed || isLanguageSettingsBusy} onClick={press} aria-label={label}
                onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (event.repeat) return; press(); } }}>
                <Icon className={styles.icon} aria-hidden="true" />
            </Button>
        );
    };

    return (
        <div className={styles.add_remove_target_language_container}>
            {button(removable, removeTargetLanguage, t("main_page.remove_target_language"), RemoveSvg)}
            {button(addable, addTargetLanguage, t("main_page.add_target_language"), AddSvg)}
        </div>
    );
};
