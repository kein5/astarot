import type { ReactNode } from "react";
import styles from "./SectionLabelComponent.module.scss";
import { Hint, useHintDescriptions } from "../hint/Hint";

// data-setting-label lets the settings search scroll to a section heading.
// sub: a group inside a fold such as 「詳細設定」 (#554). It is a subheading there
// (DESIGN.md "Roles in settings"), so the fold does not hold the page's category headings.
// desc: a line about the whole section. On a page that keeps descriptions out of sight (#614)
// it is the heading's hint instead, opened by the pointer on the heading.
export interface SectionLabelComponentProps {
    label: ReactNode;
    desc?: ReactNode;
    sub?: boolean;
}

export const SectionLabelComponent = (props: SectionLabelComponentProps) => {
    const text = props.desc;
    const hint = useHintDescriptions() && typeof text === "string";
    const desc = props.desc && !hint && <p className={styles.section_desc}>{props.desc}</p>;
    if (props.sub) {
        return (
            <div className={styles.sub_container} data-subheading
                data-setting-label={typeof props.label === "string" ? props.label : undefined}>
                <div className={styles.label_line} data-hint-host={hint || undefined}>
                    <h3 className={styles.sub_label}>{props.label}</h3>
                    {hint && <Hint text={text} focusable />}
                </div>
                {desc}
            </div>
        );
    }
    return (
        <div className={styles.container} data-section-label
            data-setting-label={typeof props.label === "string" ? props.label : undefined}>
            <div className={styles.heading_row} data-hint-host={hint || undefined}>
                <h2 className={styles.section_label}>{props.label}</h2>
                {hint && <Hint text={text} focusable />}
                <div className={styles.section_line}></div>
            </div>
            {desc}
        </div>
    );
};
