import clsx from "clsx";
import { useId } from "react";
import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { useI18n } from "@useI18n";
import { Hint } from "../hint/Hint";
import * as styles from "./Fold.css.ts";

// The app's one fold: a native <details>, so the settings search opens it on its way to a setting
// inside and assistive technology says whether it is open. Two sizes (Fold.css.ts): "bar" for a
// part of a page, "link" for a few more words. The words and the chevron of what pressing does are
// for the eye only; the details element carries the state.
export type FoldSize = "bar" | "link";

// The data-* attributes callers put on the fold or its summary (the settings search, the tests).
type DataAttributes = { [key: `data-${string}`]: string | boolean | undefined };

// hint: what the fold is for, on a page that keeps descriptions out of sight (#614), as a setup
// section's title has it: a mark beside the title opens the words with the pointer on the title or
// keyboard focus on the summary, and they are the summary's accessible description.
export interface FoldProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title">, DataAttributes {
    // What the summary says: a title, and on a bar its readout or counts beside it.
    summary: ReactNode;
    size?: FoldSize;
    summaryProps?: HTMLAttributes<HTMLElement> & DataAttributes;
    bodyClassName?: string;
    hint?: string;
}

export const Fold = ({ summary, size = "bar", summaryProps, bodyClassName, hint, className, children, ...details }: FoldProps) => {
    const { t } = useI18n();
    const id = useId();
    const hintId = hint ? `${id}-hint` : undefined;
    const title = hint ? <span data-hint-host>{summary}<Hint text={hint} id={hintId} row /></span> : summary;
    return (
        <details {...details} className={clsx(styles.fold, size === "bar" ? styles.bar : styles.link, className)}>
            <summary {...summaryProps} data-hint-row={hint ? true : summaryProps?.["data-hint-row"]}
                aria-describedby={hintId ?? summaryProps?.["aria-describedby"]} className={clsx(styles.summary, summaryProps?.className)}>
                {size === "bar" ? <span className={styles.summaryText}>{title}</span> : title}
                <span className={styles.toggle} aria-hidden="true">
                    {size === "bar" && <>
                        <span className={styles.openWord}>{t("config_page.common.fold_open")}</span>
                        <span className={styles.closeWord}>{t("config_page.common.fold_close")}</span>
                    </>}
                    <svg className={styles.chevron} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </span>
            </summary>
            <div className={clsx(styles.body, bodyClassName)}>{children}</div>
        </details>
    );
};
