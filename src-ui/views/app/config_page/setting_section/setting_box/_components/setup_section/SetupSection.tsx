import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { Description } from "../description/Description";
import { Hint, useHintDescriptions } from "../hint/Hint";
import { Fold } from "../fold/Fold";
import * as styles from "./SetupSection.css.ts";

// One-time setup on a page (models, runtimes, downloads, servers), folded
// (DESIGN.md "Roles in settings"). The summary carries a one-line status, so it
// can stay closed. `attention` opens it while something in it needs the user.
// desc: what the fold is for. On a page that keeps descriptions out of sight (#614) it is the
// title's hint, opened by the pointer on the title or keyboard focus on the summary, and the
// summary's accessible description; elsewhere the first paragraph inside the fold. The title's
// element holds the title only, as a label's does: the mark is beside it. A title given as text
// labels the fold's line (data-setting-label), so the settings search leads to the fold.
export interface SetupSectionProps {
    title: ReactNode;
    status?: ReactNode;
    desc?: string;
    attention?: boolean;
    // needed: the page's feature cannot work until this setup is done (#1230). The fold starts
    // open then, and opens when it becomes needed, so the missing step is the first thing seen;
    // it can still be closed.
    needed?: boolean;
    children?: ReactNode;
}

export const SetupSection = ({ title, status, desc, attention = false, needed = false, children }: SetupSectionProps) => {
    const [opened, setOpened] = useState(needed);
    useEffect(() => { if (needed) setOpened(true); }, [needed]);
    const id = useId();
    // The words of the title's hint, when the page shows descriptions as hints.
    const hint = useHintDescriptions() && desc ? desc : undefined;
    const descriptionId = hint ? `${id}-description` : undefined;
    const titleElement = <span className={styles.title}>{title}</span>;
    // A bar of the app's one fold (Fold.tsx): the title and its status, and what pressing does.
    return <Fold data-setup className={styles.setup} open={opened || attention}
        onToggle={event => setOpened(event.currentTarget.open)}
        summaryProps={{ "data-hint-row": hint ? true : undefined, "aria-describedby": descriptionId,
            "data-setting-label": typeof title === "string" ? title : undefined }}
        summary={<>
            {hint ? <span data-hint-host>{titleElement}<Hint text={hint} id={descriptionId} row /></span> : titleElement}
            {status && <span className={styles.status}>{status}</span>}
        </>}>
        {desc && !hint && <Description text={desc} />}
        {children}
    </Fold>;
};
