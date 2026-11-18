import styles from "./SectionLabelComponent.module.scss";

// data-setting-label lets the settings search scroll to a section heading.
// sub: a group inside a fold such as 「詳細設定」 (#554). It is a subheading there
// (DESIGN.md "Roles in settings"), so the fold does not hold the page's category headings.
export const SectionLabelComponent = (props) => {
    if (props.sub) {
        return (
            <div className={styles.sub_container} data-subheading
                data-setting-label={typeof props.label === "string" ? props.label : undefined}>
                <h3 className={styles.sub_label}>{props.label}</h3>
                {props.desc && <p className={styles.section_desc}>{props.desc}</p>}
            </div>
        );
    }
    return (
        <div className={styles.container} data-section-label
            data-setting-label={typeof props.label === "string" ? props.label : undefined}>
            <div className={styles.heading_row}>
                <h2 className={styles.section_label}>{props.label}</h2>
                <div className={styles.section_line}></div>
            </div>
            {props.desc && <p className={styles.section_desc}>{props.desc}</p>}
        </div>
    );
};
