import { useId, type ReactNode } from "react";
import * as styles from "./Setting.css.ts";

type HeadingLevel = 2 | 3 | 4;

export type SettingGroupProps = {
    title: ReactNode;
    description?: ReactNode;
    // The page title is h2 in the settings page, so a group is h3 unless it says otherwise.
    headingLevel?: HeadingLevel;
    children: ReactNode;
};

// One block of related settings with its subheading. Rows inside it are divided by hairlines;
// groups are divided by space.
export const SettingGroup = ({ title, description, headingLevel = 3, children }: SettingGroupProps) => {
    const headingId = useId();
    const Heading = `h${headingLevel}` as const;
    return (
        <section className={styles.group} aria-labelledby={headingId}>
            <div className={styles.groupHead}>
                <Heading id={headingId} className={styles.groupTitle}>{title}</Heading>
                {description ? <p className={styles.groupDescription}>{description}</p> : null}
            </div>
            <div className={styles.rows}>{children}</div>
        </section>
    );
};

// What a row hands to its control, so the label names it and the description describes it.
export type SettingControlProps = { id: string; "aria-describedby"?: string };

export type SettingRowProps = {
    label: ReactNode;
    description?: ReactNode;
    // "inline" for a switch or one button at the row's end, "field" for inputs and selects.
    layout?: "field" | "inline";
    // Edited and not saved yet: the row carries the save bar's lilac rule.
    changed?: boolean;
    children: (control: SettingControlProps) => ReactNode;
};

export const SettingRow = ({ label, description, layout = "field", changed = false, children }: SettingRowProps) => {
    const id = useId();
    const descriptionId = description ? `${id}-description` : undefined;
    return (
        <div className={styles.row({ layout })} data-changed={changed || undefined}>
            <div className={styles.rowText}>
                <label htmlFor={id} className={styles.rowLabel}>{label}</label>
                {description ? <p id={descriptionId} className={styles.rowDescription}>{description}</p> : null}
            </div>
            <div className={styles.rowControl}>{children({ id, "aria-describedby": descriptionId })}</div>
        </div>
    );
};
