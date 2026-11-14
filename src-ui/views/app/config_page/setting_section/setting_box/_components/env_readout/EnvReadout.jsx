import { useRef } from "react";
import clsx from "clsx";
import styles from "./EnvReadout.module.scss";

// What this PC and session report now (DESIGN.md "Environment readout"): GPU
// and memory, server state, download progress, model support. The words carry
// the state; tone only colors them ("neutral", "active", "warning", "failed").
// Readouts that change while the page is open are announced as a status.
//
// `progress` adds a mark before the words for work that ends in success (a download, a server
// start): "working" spins, "done" is a check. The check only fills in and draws itself when the
// work finishes while the page is open; one that was done already just shows.
export const EnvReadout = ({ tone = "neutral", live = true, actions = null, progress, className, children }) => {
    const last = useRef(progress);
    const arrived = useRef(false);
    if (last.current !== progress) {
        arrived.current = last.current === "working" && progress === "done";
        last.current = progress;
    }
    return <div className={clsx(styles.readout, styles[tone], className)}>
        {(progress === "working" || progress === "done") &&
            <ProgressMark state={progress} arrived={progress === "done" && arrived.current} />}
        <div className={styles.text} role={live ? "status" : undefined}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
    </div>;
};

const ProgressMark = ({ state, arrived }) =>
    <span className={clsx(styles.mark, styles[`mark_${state}`], arrived && styles.arrived)} aria-hidden="true"
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
