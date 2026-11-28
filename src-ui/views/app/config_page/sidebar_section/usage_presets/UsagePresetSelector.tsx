import { Fragment, useEffect, useId, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useUsagePresets } from "@logics_configs";
import TuneSvg from "@images/mui_discover_tune.svg?react";
import ArrowDownSvg from "@images/narrow_arrow_down.svg?react";
import HelpSvg from "@images/help.svg?react";
import { Tooltip } from "../../../../common_components/tooltip/Tooltip.tsx";
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
// closes it, as it has no room for the words. Following #614 (#1106), explanations stay in
// hover/focus tooltips beside the rail rather than taking up always-visible space in the list.
export const UsagePresetSelector = ({ isCompact }: { isCompact: boolean }) => {
    const { t } = useI18n();
    const { currentUsagePresets, setUsagePresets } = useUsagePresets();
    const picked = pickedPresets(currentUsagePresets.data);
    const pending = currentUsagePresets.state === "pending";
    const [open, setOpen] = useState(false);
    const listId = useId();
    const helpId = `${listId}-help`;
    useEffect(() => { if (isCompact) setOpen(false); }, [isCompact]);
    const expanded = open && !isCompact && picked !== null;

    const names = picked
        ? picked.map(id => t(usagePresetLabelKey(id))).join(t("config_page.usage_presets.list_separator"))
        : t("common.loading");
    const name = t("config_page.usage_presets.button_label", { names });
    const help = t("config_page.usage_presets.help");

    return (
        <div className={styles.container}>
            {/* In the full rail the tooltip says what the uses do. The icon rail has no tooltip and no
                title (D-21): the rail widens as soon as the pointer or the keyboard focus reaches it,
                which shows the button's words, so a tooltip of the icon would open on a button still
                widening. The words stay the button's name. */}
            <Tooltip bare placement="right" title={isCompact ? undefined : help}>
                <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={listId}
                    aria-label={name} aria-describedby={helpId} disabled={picked === null}
                    data-usage-presets onClick={() => setOpen(value => !value)}>
                    <TuneSvg aria-hidden="true" className={styles.icon} />
                    <span className={clsx(styles.words, { [styles.hidden]: isCompact })} aria-hidden="true">
                        <span className={styles.title}>
                            <span>{t("config_page.usage_presets.title")}</span>
                            <HelpSvg aria-hidden="true" className={styles.titleHintMark} />
                        </span>
                        <span className={styles.names}>{names}</span>
                    </span>
                    {!isCompact && <ArrowDownSvg aria-hidden="true" className={clsx(styles.caret, { [styles.caretOpen]: expanded })} />}
                </button>
            </Tooltip>
            <span id={helpId} className={styles.visuallyHidden}>{help}</span>
            {expanded && picked && (
                <fieldset id={listId} aria-describedby={helpId} className={styles.list}>
                    <legend className={styles.visuallyHidden}>{t("config_page.usage_presets.title")}</legend>
                    {USAGE_PRESETS.map(({ id }) => {
                        const checked = picked.includes(id);
                        // The last use picked stays: something is always picked.
                        const last = checked && picked.length === 1;
                        const desc = t(usagePresetDescKey(id));
                        const descId = `${listId}-${id}-desc`;
                        return (
                            <Fragment key={id}>
                                <Tooltip bare placement="right" title={desc}>
                                    <label className={styles.item}>
                                        <input type="checkbox" className={styles.checkbox} checked={checked} disabled={pending || last}
                                            aria-describedby={descId} data-usage-preset={id}
                                            onChange={() => setUsagePresets(togglePreset(picked, id))} />
                                        <span className={styles.itemLabel}>
                                            <span>{t(usagePresetLabelKey(id))}</span>
                                            <HelpSvg aria-hidden="true" className={styles.hintMark} />
                                        </span>
                                    </label>
                                </Tooltip>
                                <span id={descId} className={styles.visuallyHidden}>{desc}</span>
                            </Fragment>
                        );
                    })}
                </fieldset>
            )}
        </div>
    );
};
