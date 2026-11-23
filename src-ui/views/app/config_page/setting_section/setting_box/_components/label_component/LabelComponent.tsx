import type { ReactNode } from "react";
import * as styles from "./LabelComponent.css.ts";
import { _OpenWebpageButton } from "../_atoms/_open_webpage_button/_OpenWebpageButton";
import WarningSvg from "@images/warning.svg?react";
import { Description } from "../description/Description";
import { Hint, useHintDescriptions } from "../hint/Hint";
import { Lead } from "../lead/Lead";

// A warning shown under the label, such as a key that must be entered again.
export interface LabelWarning {
    label: ReactNode;
}

// The label column of a settings row (the templates' rows). The ids tie the control to the
// label, the description and the warnings with aria-labelledby and aria-describedby.
export interface LabelComponentProps {
    label?: ReactNode;
    label_id?: string;
    // What must be known before acting, in one sentence: what leaves the PC, or what a switch
    // changes beyond itself. It stays on screen on every page; `desc` then holds the details,
    // whose hint follows the sentence, not the label, so the bubble does not cover the sentence.
    lead?: string;
    lead_id?: string;
    desc?: ReactNode;
    description_id?: string;
    // Keeps a text description on screen on a page that shows them as hints.
    keep_desc?: boolean;
    note?: ReactNode;
    note_id?: string;
    add_warnings?: readonly LabelWarning[];
    warnings_id?: string;
    webpage_url?: string;
    open_webpage_label?: ReactNode;
}

export const LabelComponent = (props: LabelComponentProps) => {
    // On a page that keeps descriptions out of sight (#614), a text description becomes the
    // label's hint; keep_desc keeps one on screen, such as the label in a second language.
    const desc = props.desc;
    const hint = useHintDescriptions() && typeof desc === "string" && !props.keep_desc;
    const label = <p id={props.label_id} className={styles.label}>{props.label}</p>;
    return (
        <div className={styles.label_component}>
            {hint && !props.lead
                ? <div className={styles.label_line} data-hint-host>{label}<Hint text={desc} id={props.description_id} row /></div>
                : label}
            {props.lead && <Lead row text={props.lead} id={props.lead_id} details={hint ? desc : undefined} details_id={props.description_id} />}
            {props.desc && !hint
                ? typeof props.desc === "string" ? <Description id={props.description_id} text={props.desc} className={styles.desc} /> : <p id={props.description_id} className={styles.desc}>{props.desc}</p>
                : null
            }
            {/* The setting's current state when its control alone cannot say it. */}
            {props.note && <p id={props.note_id} className={styles.note}>{props.note}</p>}
            {props.add_warnings && Array.isArray(props.add_warnings) && props.add_warnings.length > 0 && (
                <div id={props.warnings_id} className={styles.warnings_section}>
                    {props.add_warnings.map((w, i) => (
                        <div className={styles.warning_item} key={i}>
                            <WarningSvg className={styles.warning_svg} aria-hidden="true" />
                            <p className={styles.warning_label}>{w.label}</p>
                        </div>
                    ))}
                </div>
            )}

            {props.webpage_url && <_OpenWebpageButton webpage_url={props.webpage_url} open_webpage_label={props.open_webpage_label} /> }
        </div>
    );
};
