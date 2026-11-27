import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@useI18n";
import { companionBridge, type CompanionBridge } from "../../logics/companion/bridge.ts";
import { actionFor, MAIN_SCREEN_ORDER, panelState, switchLabelKey, type CompanionStatus, type Switch as SwitchState } from "../../logics/companion/status.ts";
import { applyThemeTokens, themeSetting, themeTokens } from "../../logics/theme/themes.ts";
import { startupTheme } from "../../logics/theme/startupTheme.ts";
import * as styles from "./CompanionPanel.css.ts";
import { Button, Switch } from "../kit/index.ts";

// The tray companion's control panel (experimental feature "tray_companion", Issue #355): the main
// screen's feature switches, in its order and under its names (#1235), opened from the tray or from
// the handle beside the captions. The hidden main window owns the state; this page only shows it
// and asks. A switch the main window cannot turn on brings it forward to say why or to set it up
// (CompanionController), as the hexagram's labels do.
export const CompanionPanel = ({ bridge = companionBridge }: { bridge?: CompanionBridge }) => {
    const { t, i18n } = useI18n();
    const [status, setStatus] = useState<CompanionStatus | null>(null);
    const first = useRef<HTMLButtonElement>(null);
    const titleId = useId(), switchId = useId();
    // Until the main window's report comes, the theme the shell gave the page (#1259).
    const savedTheme = JSON.stringify(status?.theme ?? startupTheme() ?? null);

    useLayoutEffect(() => {
        applyThemeTokens(document.documentElement.style, themeTokens(themeSetting(JSON.parse(savedTheme))));
    }, [savedTheme]);

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
                {MAIN_SCREEN_ORDER.map((feature, index) => <SwitchRow key={feature} id={`${switchId}-${feature}`}
                    buttonRef={index === 0 ? first : undefined} label={t(switchLabelKey(feature))} value={status?.[feature]}
                    disabled={!ready} onClick={() => ask(actionFor(feature))} t={t} />)}
            </div>
            <footer className={styles.footer}>
                <Button size="compact" onClick={() => ask("open_main")}>{t("companion.open_main")}</Button>
                <Button size="compact" onClick={() => ask("open_settings")}>{t("companion.open_settings")}</Button>
                <Button size="compact" onClick={() => bridge.hide().catch(() => {})}>{t("companion.close")}</Button>
            </footer>
        </main>
    );
};

type SwitchRowProps = {
    id: string;
    label: string;
    value: SwitchState | undefined;
    disabled: boolean;
    onClick: () => void;
    buttonRef?: RefObject<HTMLButtonElement | null>;
    t: (key: string) => string;
};

// A switch whose main switch is greyed out (blocked) says it cannot be used and stays pressable:
// pressing it brings the main window forward with the reason, as the tray does (#562).
// The row is the switch's label, so pressing anywhere on it presses the kit's switch, and the
// switch is named by the row's words, what it switches and its state. The words are read only as
// that name, as they were inside the row's button, not once more beside it.
const SwitchRow = ({ id, label, value, disabled, onClick, buttonRef, t }: SwitchRowProps) => {
    const on = value?.on === true, pending = value?.pending === true, blocked = value?.blocked === true;
    const unusable = disabled || pending;
    return (
        <label htmlFor={id} className={styles.switchRow} data-checked={on} data-blocked={blocked} data-busy={pending} data-disabled={unusable}>
            <span id={`${id}-label`} className={styles.switchLabel} aria-hidden="true">{label}</span>
            <span id={`${id}-state`} className={styles.switchValue} aria-hidden="true">{t(blocked ? "companion.unavailable" : on ? "companion.on" : "companion.off")}</span>
            <Switch ref={buttonRef} id={id} checked={on} aria-labelledby={`${id}-label ${id}-state`} aria-busy={pending}
                aria-disabled={blocked || undefined} disabled={unusable} onClick={onClick} />
        </label>
    );
};
