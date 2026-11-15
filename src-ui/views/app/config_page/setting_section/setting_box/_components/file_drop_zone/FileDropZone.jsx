import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { addDropZone, nameOf, sortFiles, watchDrag } from "../../../../../../../logics/common/fileDrop";
import styles from "./FileDropZone.module.scss";

// A place on a settings page to drop files from the desktop, for path fields that would
// otherwise be typed. It wakes up while files are dragged over the window, lifts when they are
// over it, and passes the paths of the accepted kinds to onFiles (it never opens the files). The
// fields stay the way to type or paste a path, and saving stays with the save bar.
export const FileDropZone = ({ accept, onFiles, hint, disabled = false }) => {
    const { t } = useI18n();
    const element = useRef(null);
    const latest = useRef({ accept, onFiles, disabled });
    latest.current = { accept, onFiles, disabled };
    const zone = useRef(null);
    const [drag, setDrag] = useState({ active: false, paths: [], over: null });
    const [result, setResult] = useState(null);
    const kinds = accept.join(" / ");

    useEffect(() => {
        let timer;
        zone.current = {
            element: element.current,
            disabled: () => latest.current.disabled,
            drop(paths) {
                const { accepted, rejected } = sortFiles(paths, latest.current.accept);
                if (accepted.length) latest.current.onFiles(accepted);
                setResult({ kind: accepted.length ? "done" : "rejected", names: accepted.map(nameOf), skipped: rejected.length });
                clearTimeout(timer);
                timer = setTimeout(() => setResult(null), 4000);
            },
        };
        const remove = addDropZone(zone.current);
        const stop = watchDrag(setDrag);
        return () => { clearTimeout(timer); remove(); stop(); };
    }, []);

    const over = drag.active && drag.over === zone.current;
    const fits = sortFiles(drag.paths, accept).accepted.length > 0;
    const state = disabled ? "disabled" : over ? (fits ? "over" : "wrong") : drag.active ? "awake" : result?.kind ?? "idle";
    const title = {
        idle: t("file_drop.title", { kinds }),
        disabled: t("file_drop.title", { kinds }),
        awake: t("file_drop.drop_here", { kinds }),
        over: t("file_drop.release"),
        wrong: t("file_drop.wrong_kind", { kinds }),
        done: t("file_drop.done", { names: result?.names.join(", ") }),
        rejected: t("file_drop.wrong_kind", { kinds }),
    }[state];
    const note = state === "done" ? t(result.skipped ? "file_drop.done_skipped" : "file_drop.save_hint", { kinds }) : hint;

    return <div ref={element} className={clsx(styles.zone, styles[state])} data-file-drop={state}>
        <span className={styles.icon} aria-hidden="true">
            <svg viewBox="0 0 24 24" className={styles.arrow}><path d="M12 15V4.5M7.5 9 12 4.5 16.5 9M5 15.5v2.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-2.5" /></svg>
            <svg viewBox="0 0 24 24" className={styles.check}><circle cx="12" cy="12" r="11" /><path pathLength="1" d="M7 12.4l3.4 3.4L17 9.2" /></svg>
        </span>
        <span className={styles.words}>
            {/* A new line rolls in when the state changes. */}
            <span key={`${state}:${title}`} className={styles.title}>{title}</span>
            {note && <span className={styles.hint}>{note}</span>}
        </span>
        {/* Only the outcome of a drop is announced; the rest follows the pointer. */}
        <span className={styles.announce} role="status">
            {result && (result.kind === "done" ? t("file_drop.done", { names: result.names.join(", ") }) : t("file_drop.wrong_kind", { kinds }))}
        </span>
    </div>;
};
