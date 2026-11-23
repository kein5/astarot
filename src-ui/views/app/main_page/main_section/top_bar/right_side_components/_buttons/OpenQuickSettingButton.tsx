import { useI18n } from "@useI18n";
import clsx from "clsx";
import * as styles from "./OpenQuickSettingButton.css.ts";
import WarningSvg from "@images/warning.svg?react";
import type { AtomStatus } from "@store";

type OpenQuickSettingButtonProps = {
    label: string;
    // On or off; another value shows no state.
    variable?: boolean;
    state?: AtomStatus;
    is_pending?: boolean;
    is_available?: boolean;
    row?: boolean;
    note?: string | null;
    onClickFunction?: () => void;
};

export const OpenQuickSettingButton = (props: OpenQuickSettingButtonProps) => {
    const { t } = useI18n();
    const variable = (typeof props.variable === "boolean") ? props.variable : null;
    const is_available = (typeof props.is_available === "boolean") ? props.is_available : true;
    const is_pending = props.is_pending === true || props.state === "pending";

    const getIndicatorLabelClassName = (base_classnames: (string | undefined)[] = []) => {
        return clsx(
            ...base_classnames,
            is_available && styles.is_available,
            is_pending && styles.is_pending
        );
    };

    // row: one line of the quick settings menu, with the name on the left and the
    // state on the right. A pending row stays focusable, so the keyboard keeps its place.
    return (
        <div className={clsx(styles.container, props.row && styles.row)}>
            {/* The visible label and state are the name; toggles report pressed. */}
            <button type="button" disabled={props.row ? !is_available : is_pending || !is_available}
                aria-disabled={props.row && is_pending ? true : undefined}
                aria-pressed={variable !== null ? variable : undefined}
                className={clsx(styles.button_wrapper, is_pending && styles.is_pending)}
                onClick={is_pending ? undefined : props.onClickFunction}
            >
                {is_pending && <span className={styles.loader}></span>}
                <p className={clsx(styles.button_label, is_pending && styles.is_pending)}>{props.label}</p>
                {variable !== null && (
                    props.variable === true ? (
                        <p className={getIndicatorLabelClassName([styles.button_indicator_label, styles.is_enabled])}>
                            {t("main_page.state_text_enabled")}
                            {is_available === false && (
                                <WarningSvg className={styles.warning_svg} />
                            )}
                        </p>
                    ) : (
                        <p className={getIndicatorLabelClassName([styles.button_indicator_label, styles.is_disabled])}>
                            {t("main_page.state_text_disabled")}
                        </p>
                    )
                )}
            </button>
            {props.note && <p className={styles.note}>{props.note}</p>}
        </div>
    );
};