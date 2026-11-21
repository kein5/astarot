import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useI18n } from "@useI18n";
import { companionBridge, type CompanionBridge } from "../../logics/companion/bridge.ts";
import { panelState, type CompanionStatus, type Switch } from "../../logics/companion/status.ts";
import * as styles from "./CompanionPanel.css.ts";

// The tray companion's control panel (experimental feature "tray_companion", Issue #355): the
// everyday switches, opened from the tray or from the handle beside the captions. The hidden
// main window owns the state; this page only shows it and asks.
export const CompanionPanel = ({ bridge = companionBridge }: { bridge?: CompanionBridge }) => {
    const { t, i18n } = useI18n();
    const [status, setStatus] = useState<CompanionStatus | null>(null);
    const first = useRef<HTMLButtonElement>(null) as RefObject<HTMLButtonElement>;
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
        const changed = bridge.onChanged(() => { void refresh(); });
        const opened = bridge.onOpened(() => { void refresh(true); });
        Promise.all([changed, opened]).then(() => refresh(true), () => {});
        return () => {
            disposed = true;
            changed.then(off => off(), () => {});
            opened.then(off => off(), () => {});
        };
    }, [bridge]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") bridge.hide().catch(() => {}); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [bridge]);

    const state = panelState(status);
    const ready = status?.ready === true;
    const ask = (action: Parameters<CompanionBridge["request"]>[0]) =>
        bridge.request(action).catch(error => console.warn("Companion request failed", error));

    return (
        <main className={styles.panel} aria-labelledby={titleId}>
            <header className={styles.header}>
                <h1 id={titleId} className={styles.title}>ASTAROT</h1>
                <p role="status" className={styles.state} data-state={state}>
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
                <button type="button" className={styles.linkButton} onClick={() => ask("open_main")}>
                    {t("companion.open_main")}
                </button>
                <button type="button" className={styles.linkButton} onClick={() => bridge.hide().catch(() => {})}>
                    {t("companion.close")}
                </button>
            </footer>
        </main>
    );
};

type SwitchRowProps = {
    label: string;
    value: Switch | undefined;
    disabled: boolean;
    onClick: () => void;
    buttonRef?: RefObject<HTMLButtonElement>;
    t: (key: string) => string;
};

// A switch whose main switch is greyed out (blocked) says it cannot be used and stays pressable:
// pressing it brings the main window forward with the reason, as the tray does (#562).
const SwitchRow = ({ label, value, disabled, onClick, buttonRef, t }: SwitchRowProps) => {
    const on = value?.on === true, pending = value?.pending === true, blocked = value?.blocked === true;
    return (
        <button ref={buttonRef} type="button" role="switch" aria-checked={on} aria-busy={pending}
            aria-disabled={blocked || undefined} data-blocked={blocked}
            disabled={disabled || pending} className={styles.switchRow} onClick={onClick}>
            <span className={styles.switchLabel}>{label}</span>
            <span className={styles.switchValue}>{t(blocked ? "companion.unavailable" : on ? "companion.on" : "companion.off")}</span>
            <span className={styles.track} aria-hidden="true"><span className={styles.thumb} /></span>
        </button>
    );
};
