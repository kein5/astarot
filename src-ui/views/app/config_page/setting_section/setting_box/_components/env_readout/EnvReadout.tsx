import { useRef } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import * as styles from "./EnvReadout.css.ts";

// The classes looked up by a name made at run time: a name with no class of its own gives none.
const classNamed: Partial<Record<string, string>> = styles;

// What this PC and session report now (DESIGN.md "Environment readout"): GPU
// and memory, server state, download progress, model support. The words carry
// the state; tone only colors them ("neutral", "active", "warning", "failed").
// Readouts that change while the page is open are announced as a status.
//
// `progress` adds a mark before the words for work that ends in success (a download, a server
// start): "working" spins, "done" is a check. The check only fills in and draws itself when the
// work finishes while the page is open; one that was done already just shows.
// `reserveMark` keeps the mark's place while there is none, for a readout whose mark comes and goes
// as the user checks again (an engine's card), so its words do not move sideways (#912). The words
// then wrap beside the mark, not under it, so the readout has one shape in every state.
export type EnvReadoutTone = "neutral" | "active" | "warning" | "failed";
export type EnvReadoutProgress = "working" | "done";

type EnvReadoutProps = {
    tone?: EnvReadoutTone;
    live?: boolean;
    actions?: ReactNode;
    progress?: EnvReadoutProgress;
    reserveMark?: boolean;
    className?: string;
    children?: ReactNode;
};

export const EnvReadout = ({ tone = "neutral", live = true, actions = null, progress, reserveMark = false, className, children }: EnvReadoutProps) => {
    const last = useRef(progress);
    const arrived = useRef(false);
    if (last.current !== progress) {
        arrived.current = last.current === "working" && progress === "done";
        last.current = progress;
    }
    return <div className={clsx(styles.readout, classNamed[tone], reserveMark && styles.reserved, className)}>
        {progress === "working" || progress === "done"
            ? <ProgressMark state={progress} arrived={progress === "done" && arrived.current} />
            : reserveMark && <span className={styles.mark} aria-hidden="true" />}
        <div className={styles.text} role={live ? "status" : undefined}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
    </div>;
};

const ProgressMark = ({ state, arrived }: { state: EnvReadoutProgress; arrived: boolean }) =>
    <span className={clsx(styles.mark, classNamed[`mark_${state}`], arrived && styles.arrived)} aria-hidden="true"
        data-progress={state} data-arrived={arrived || undefined}>
        <svg viewBox="0 0 16 16">
            {state === "working"
                ? <circle className={styles.ring} cx="8" cy="8" r="6" />
                : <>
                    <circle className={styles.disc} cx="8" cy="8" r="7" />
                    <path className={styles.tick} pathLength="1" d="M4.6 8.3l2.3 2.3 4.5-4.6" />
                </>}
        </svg>
    </span>;
