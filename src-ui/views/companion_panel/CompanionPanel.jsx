import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { companionBridge } from "../../logics/companion/bridge";
import { panelState } from "../../logics/companion/status.js";
import styles from "./CompanionPanel.module.scss";

// The experimental companion form's control panel (Issue #355): the everyday
// switches, opened from the tray or from the handle beside the captions. The
// main window, hidden, owns the state; this page only shows it and asks.
export const CompanionPanel = ({ bridge = companionBridge }) => {
    const { t, i18n } = useI18n();
    const [status, setStatus] = useState(null);
    const first = useRef(null);
    const titleId = useId();

    useEffect(() => {
        let disposed = false, revision = 0;
        const refresh = async (focus = false) => {
            const current = ++revision;
            try {
                const next = await bridge.status();
                if (disposed || current !== revision) return;
                if (next.language !== i18n.language) await i18n.changeLanguage(next.language);
                setStatus(next);
            } catch (error) { console.warn("Companion panel could not read the state", error); }
            if (focus && !disposed) first.current?.focus();
        };
        const changed = bridge.onChanged(() => refresh());
        const opened = bridge.onOpened(() => refresh(true));
        Promise.all([changed, opened]).then(() => refresh(true), () => {});
        return () => {
            disposed = true;
            changed.then(off => off(), () => {});
            opened.then(off => off(), () => {});
        };
    }, [bridge]);

    useEffect(() => {
        const onKey = event => { if (event.key === "Escape") bridge.hide().catch(() => {}); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [bridge]);

    const state = panelState(status);
    const ready = status?.ready === true;
    const ask = action => bridge.request(action).catch(error => console.warn("Companion request failed", error));

    return (
        <main className={styles.panel} aria-labelledby={titleId}>
            <header className={styles.header}>
                <h1 id={titleId} className={styles.title}>VRCT-VOX</h1>
                <p role="status" className={clsx(styles.state, styles[`state_${state}`])}>
                    <span className={styles.dot} aria-hidden="true" />
                    {t(`companion.state_${state}`)}
                </p>
            </header>
            <div className={styles.switches}>
                <SwitchRow buttonRef={first} label={t("companion.mic")} value={status?.mic} disabled={!ready}
                    onClick={() => ask("toggle_mic")} t={t} />
                <SwitchRow label={t("companion.translation")} value={status?.translation} disabled={!ready}
                    onClick={() => ask("toggle_translation")} t={t} />
            </div>
            <footer className={styles.footer}>
                <button type="button" className={styles.link_button} onClick={() => ask("open_main")}>
                    {t("companion.open_main")}
                </button>
                <button type="button" className={styles.link_button} onClick={() => bridge.hide().catch(() => {})}>
                    {t("companion.close")}
                </button>
            </footer>
        </main>
    );
};

const SwitchRow = ({ label, value, disabled, onClick, buttonRef, t }) => {
    const on = value?.on === true, pending = value?.pending === true;
    return (
        <button ref={buttonRef} type="button" role="switch" aria-checked={on} aria-busy={pending}
            disabled={disabled || pending} className={clsx(styles.switch_row, { [styles.is_on]: on })} onClick={onClick}>
            <span className={styles.switch_label}>{label}</span>
            <span className={styles.switch_value}>{t(on ? "companion.on" : "companion.off")}</span>
            <span className={styles.track} aria-hidden="true"><span className={styles.thumb} /></span>
        </button>
    );
};
