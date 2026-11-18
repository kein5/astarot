import { useEffect, useId, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useUsagePresets } from "@logics_configs";
import TuneSvg from "@images/mui_discover_tune.svg?react";
import ArrowDownSvg from "@images/narrow_arrow_down.svg?react";
import * as styles from "./UsagePresetSelector.css.ts";
import {
    USAGE_PRESETS,
    pickedPresets,
    togglePreset,
    usagePresetLabelKey,
    usagePresetDescKey,
} from "../../../../../logics/configs/usagePresets.ts";

// The uses at the top of the settings menu (#554, Q-13): which features the main page's switches
// and this menu show. Several can be picked (Q-09). Picking changes what is shown, never a
// setting (usagePresets.ts). The list opens under its button inside the rail; the icon rail
// closes it, as it has no room for the words.
export const UsagePresetSelector = ({ isCompact }: { isCompact: boolean }) => {
    const { t } = useI18n();
    const { currentUsagePresets, setUsagePresets } = useUsagePresets();
    const picked = pickedPresets(currentUsagePresets.data);
    const pending = currentUsagePresets.state === "pending";
    const [open, setOpen] = useState(false);
    const listId = useId();
    useEffect(() => { if (isCompact) setOpen(false); }, [isCompact]);
    const expanded = open && !isCompact && picked !== null;

    const names = picked
        ? picked.map(id => t(usagePresetLabelKey(id))).join(t("config_page.usage_presets.list_separator"))
        : t("common.loading");
    const name = t("config_page.usage_presets.button_label", { names });

    return (
        <div className={styles.container}>
            <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={listId}
                aria-label={name} title={isCompact ? name : undefined} disabled={picked === null}
                data-usage-presets onClick={() => setOpen(value => !value)}>
                <TuneSvg aria-hidden="true" className={styles.icon} />
                <span className={clsx(styles.words, { [styles.hidden]: isCompact })} aria-hidden="true">
                    <span className={styles.title}>{t("config_page.usage_presets.title")}</span>
                    <span className={styles.names}>{names}</span>
                </span>
                {!isCompact && <ArrowDownSvg aria-hidden="true" className={clsx(styles.caret, { [styles.caretOpen]: expanded })} />}
            </button>
            {expanded && picked && (
                <fieldset id={listId} className={styles.list}>
                    <legend className={styles.visuallyHidden}>{t("config_page.usage_presets.title")}</legend>
                    <p className={styles.help}>{t("config_page.usage_presets.help")}</p>
                    {USAGE_PRESETS.map(({ id }) => {
                        const checked = picked.includes(id);
                        // The last use picked stays: something is always picked.
                        const last = checked && picked.length === 1;
                        return (
                            <label key={id} className={styles.item}>
                                <input type="checkbox" className={styles.checkbox} checked={checked} disabled={pending || last}
                                    data-usage-preset={id} onChange={() => setUsagePresets(togglePreset(picked, id))} />
                                <span className={styles.itemText}>
                                    <span className={styles.itemLabel}>{t(usagePresetLabelKey(id))}</span>
                                    <span className={styles.itemDesc}>{t(usagePresetDescKey(id))}</span>
                                </span>
                            </label>
                        );
                    })}
                </fieldset>
            )}
        </div>
    );
};
