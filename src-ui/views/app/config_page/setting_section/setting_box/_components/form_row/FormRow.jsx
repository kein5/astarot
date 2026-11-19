import { cloneElement, isValidElement, useId } from "react";
import clsx from "clsx";
import { Description } from "../description/Description";
import { Hint, useHintDescriptions } from "../hint/Hint";
import styles from "./FormRow.module.scss";

// The settings row (DESIGN.md roles): item label with its description directly
// under it on the left, the control on the right; stacked under 700px. The
// control gets the label's id target and points at the description. `group`
// rows hold several buttons, labelled and described as one group. `actions`
// sit under the control, such as a refresh for a device list.
// On a page that keeps descriptions out of sight (#614) a text description is the label's
// hint instead; keepDescription keeps one on screen, such as the value in use.
export const FormRow = ({ label, description, children, actions = null, group = false, fold = true, keepDescription = false, className }) => {
    const id = useId();
    const labelId = `${id}-label`, descriptionId = description ? `${id}-description` : undefined;
    const hint = useHintDescriptions() && typeof description === "string" && !keepDescription;
    const control = group
        ? <div role="group" aria-labelledby={labelId} aria-describedby={descriptionId} className={styles.group}>{children}</div>
        : isValidElement(children)
            ? cloneElement(children, { id: children.props.id ?? id, "aria-describedby": [children.props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined })
            : children;
    const labelElement = group
        ? <span id={labelId} className={styles.label}>{label}</span>
        : <label id={labelId} htmlFor={children?.props?.id ?? id} className={styles.label}>{label}</label>;
    return <div className={clsx(styles.row, className)} data-setting-label={typeof label === "string" ? label : undefined} data-hint-row>
        <div className={styles.text}>
            {hint
                ? <div className={styles.label_line} data-hint-host>{labelElement}<Hint text={description} id={descriptionId} row /></div>
                : labelElement}
            {description && !hint && <Description id={descriptionId} text={description} className={styles.description} fold={fold} />}
        </div>
        <div className={styles.control}>
            {control}
            {actions}
        </div>
    </div>;
};
