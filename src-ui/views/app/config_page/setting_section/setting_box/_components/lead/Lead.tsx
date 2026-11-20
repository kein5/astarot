import { Description } from "../description/Description";
import { Hint, useHintDescriptions } from "../hint/Hint";
import styles from "./Lead.module.scss";

// What must be known before acting, in one sentence that stays on screen (#614, DESIGN.md
// "Principles"): what leaves the PC, or what a switch changes beyond itself. Its details are the
// hint after the sentence, which opens under it, so the sentence stays in view beside them.
// A row draws it under its label (LabelComponent's `lead`): the bubble then has the id the
// control's description points at and opens with keyboard focus in the row (`row`). Drawn by
// itself, no control points at it: the mark takes keyboard focus and carries the words as its
// name, and on a page that shows descriptions the details are a description under the sentence.
export interface LeadProps {
    text: string;
    id?: string;
    details?: string;
    details_id?: string;
    row?: boolean;
}

export const Lead = ({ text, id, details, details_id, row = false }: LeadProps) => {
    const hints = useHintDescriptions();
    return <>
        <p id={id} className={row ? styles.lead : `${styles.lead} ${styles.alone}`} data-hint-host={hints && details ? true : undefined}>
            <span>{text}</span>
            {hints && details && (row ? <Hint text={details} id={details_id} row /> : <Hint text={details} focusable />)}
        </p>
        {!hints && details && <Description id={details_id} text={details} className={styles.lead} />}
    </>;
};
