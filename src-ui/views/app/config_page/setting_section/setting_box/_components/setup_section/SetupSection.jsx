import { useId, useState } from "react";
import { Description } from "../description/Description";
import { Hint, useHintDescriptions } from "../hint/Hint";
import styles from "./SetupSection.module.scss";

// One-time setup on a page (models, runtimes, downloads, servers), folded
// (DESIGN.md "Roles in settings"). The summary carries a one-line status, so it
// can stay closed. `attention` opens it while something in it needs the user.
// desc: what the fold is for. On a page that keeps descriptions out of sight (#614) it is the
// title's hint, opened by the pointer on the title or keyboard focus on the summary, and the
// summary's accessible description; elsewhere the first paragraph inside the fold.
export const SetupSection = ({ title, status, desc, attention = false, children }) => {
    const [opened, setOpened] = useState(false);
    const id = useId();
    const hint = useHintDescriptions() && typeof desc === "string";
    const descriptionId = hint ? `${id}-description` : undefined;
    return <details data-setup className={styles.setup} open={opened || attention}
        onToggle={event => setOpened(event.currentTarget.open)}>
        <summary data-hint-row={hint || undefined} aria-describedby={descriptionId}>
            <span className={styles.title} data-hint-host={hint || undefined}>{title}{hint && <Hint text={desc} id={descriptionId} row />}</span>
            {status && <span className={styles.status}>{status}</span>}
        </summary>
        <div className={styles.body}>
            {desc && !hint && <Description text={desc} />}
            {children}
        </div>
    </details>;
};
