import clsx from "clsx";
import { useId } from "react";
import { Switch } from "../../../../../../kit/index.ts";
import * as styles from "./SettingSwitch.css.ts";

// A setting's value as the store holds it, as far as the switch reads it.
export interface SettingSwitchValue {
    state?: string;
    data?: unknown;
}

export interface SettingSwitchProps {
    label?: string;
    variable: SettingSwitchValue;
    is_available?: boolean;
    toggleFunction?: () => void;
    // Draws the name beside the switch, for a switch inside a row of other controls.
    show_label?: boolean;
    // The smaller target of a switch among other controls (a device's "Auto select").
    dense?: boolean;
    "aria-describedby"?: string;
}

// The on/off control of the settings pages: the kit's Switch (K-02, decided on 2026-11-25;
// DESIGN.md "Components"). The settings rows name it with their own label; `show_label` also draws
// the name beside it, for a switch inside a row of other controls (a device's "Auto select"). Its
// label around it is the target a press lands on, as large as the checkbox's was, so the row keeps
// its height. While its change waits for the core, or while it cannot be used, it stays in place
// and in the tab order (aria-busy, aria-disabled) and ignores presses and keys, so focus is kept.
export const SettingSwitch = ({
    label,
    variable,
    is_available = true,
    toggleFunction,
    show_label = false,
    dense = false,
    "aria-describedby": describedBy,
}: SettingSwitchProps) => {
    const id = useId();
    const pending = variable.state === "pending";
    const unavailable = !is_available || pending;

    return (
        <div className={styles.container}>
            <label htmlFor={id} className={clsx(styles.target, { [styles.dense]: dense })}
                data-pending={pending || undefined} data-unavailable={!is_available || undefined}>
                <Switch
                    id={id}
                    checked={variable.data === true}
                    aria-label={show_label ? undefined : label}
                    aria-describedby={describedBy}
                    aria-busy={pending}
                    aria-disabled={unavailable}
                    // Drawn as the kit draws a switch that cannot be used, without leaving the tab order.
                    data-disabled={is_available ? undefined : ""}
                    onClick={(event) => {
                        event.stopPropagation();
                        if (unavailable) event.preventDefault();
                    }}
                    onKeyDown={(event) => {
                        if (unavailable && (event.key === " " || event.key === "Enter")) event.preventDefault();
                    }}
                    onCheckedChange={() => {
                        if (!unavailable && toggleFunction) toggleFunction();
                    }}
                />
                {pending && <span className={styles.loader} aria-hidden="true"></span>}
                {show_label && <span className={styles.text}>{label}</span>}
            </label>
        </div>
    );
};
