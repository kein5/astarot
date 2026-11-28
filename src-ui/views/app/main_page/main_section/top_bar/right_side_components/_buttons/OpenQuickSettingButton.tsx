import { useI18n } from "@useI18n";
import clsx from "clsx";
import * as styles from "./OpenQuickSettingButton.css.ts";
import WarningSvg from "@images/warning.svg?react";
import type { AtomStatus } from "@store";
import { Toggle } from "../../../../../../kit/index.ts";

type OpenQuickSettingButtonProps = {
    label: string;
    // On or off; another value shows no state.
    variable?: boolean;
    state?: AtomStatus;
    is_pending?: boolean;
    is_available?: boolean;
    note?: string | null;
    onClickFunction?: () => void;
};

// One line of the quick settings panel: the kit's Toggle at the compact size (D-27, decided on
// 2026-11-25), with the name on the left and the state in words on the right, and under it why
// it cannot be used. The visible name and state are its name; it reports pressed only once its
// state is known, and keeps none of its own. One that cannot be used is disabled; a pending one
// stays focusable, so the keyboard keeps its place, and a press does nothing.
export const OpenQuickSettingButton = (props: OpenQuickSettingButtonProps) => {
    const { t } = useI18n();
    const variable = (typeof props.variable === "boolean") ? props.variable : null;
    const is_available = (typeof props.is_available === "boolean") ? props.is_available : true;
    const is_pending = props.is_pending === true || props.state === "pending";

    const stateClassName = clsx(styles.button_indicator_label, variable ? styles.is_enabled : styles.is_disabled,
        is_available && styles.is_available, is_pending && styles.is_pending);

    return (
        <div className={styles.row}>
            <Toggle size="compact" className={clsx(is_pending && styles.is_pending)}
                pressed={variable === true} aria-pressed={variable ?? undefined}
                disabled={!is_available} aria-disabled={is_pending ? true : undefined}
                onClick={is_pending ? undefined : props.onClickFunction}>
                <span className={styles.words}>
                    <span className={clsx(styles.button_label, is_pending && styles.is_pending)}>{props.label}</span>
                    {variable !== null && (
                        <span className={stateClassName}>
                            {variable ? t("main_page.state_text_enabled") : t("main_page.state_text_disabled")}
                            {variable && !is_available && <WarningSvg className={styles.warning_svg} />}
                        </span>
                    )}
                </span>
            </Toggle>
            {props.note && <p className={styles.note}>{props.note}</p>}
        </div>
    );
};
