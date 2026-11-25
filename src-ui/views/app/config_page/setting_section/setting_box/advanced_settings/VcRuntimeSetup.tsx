import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { activeSetupPhases, useVcRuntimes } from "../../../../../../logics/voice/useVcRuntimes";
import { useConsentDialog } from "../../../../../../logics/common/useConsentDialog";
import * as styles from "./VoiceSettings.css.ts";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import * as runtimeStyles from "./VcRuntimeSetup.css.ts";
import { Button, Progress } from "../../../../../kit/index.ts";

const gb = (value: number) => `${(value / 1e9).toFixed(1)} GB`;

// Offers to prepare an engine's runtime where the backend can; elsewhere it renders nothing.
// current: the runtime folder in the form; onUse writes an installed folder into it.
// fit: where it is one of a pair of builds for different GPUs (the translation's, #945), whether
// it fits the user's GPU. A badge under its name says so; the one that fits offers its review as
// the main action, and the other is quieter, leaves its summary out and offers no download.
export type RuntimeFit = "fits" | "unneeded";
export interface VcRuntimeSetupProps {
    engine: string;
    current?: string;
    disabled?: boolean;
    onUse?: (path: string) => void;
    fit?: RuntimeFit;
}

export const VcRuntimeSetup = ({ engine, current, disabled, onUse, fit }: VcRuntimeSetupProps) => {
    const { t } = useI18n();
    const { catalog, state, error, pending, send } = useVcRuntimes();
    const [open, setOpen] = useState(false), [consent, setConsent] = useState(false), [linkError, setLinkError] = useState<string | null>(null);
    const section = useRef<HTMLElement>(null);
    const hints = useHintDescriptions();
    const helpId = useId();
    const { dialog, close: closeDialog } = useConsentDialog(open, section);
    useEffect(() => {
        send("/get/data/vc_runtime_catalog"); send("/get/data/vc_runtime_state");
    }, [send]);
    const entry = catalog?.runtimes?.find(row => row.id === engine);
    if (!entry) return null;
    const job = state.jobs[engine], installed = state.installed[engine];
    const active = activeSetupPhases.includes(job?.phase);
    const busy = !!pending || Object.values(state.jobs).some(item => activeSetupPhases.includes(item.phase));
    // A runtime may word a step or a failure its own way (DirectML is not CUDA): `<key>_<notice>`.
    const own = (key: string, fallback: string) => t(`${key}_${entry.notice}`, { defaultValue: fallback });
    const failure = (code: string) => own(`vc_runtime.errors.${code}`, t(`vc_runtime.errors.${code}`, { defaultValue: t("vc_runtime.errors.vc_runtime_failed") }));
    const close = () => { closeDialog(); setOpen(false); setConsent(false); setLinkError(null); };
    const openLink = async (event: MouseEvent<HTMLAnchorElement>, url: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(url); setLinkError(null); }
        catch { setLinkError(url); }
    };
    // What the runtime holds and needs is its title's hint on a page that shows descriptions as
    // hints (#614); a build not needed for the user's GPU says only that.
    const help = fit !== "unneeded" ? t(`vc_runtime.help_${entry.notice}`) : null;
    const title = t("vc_runtime.title", { name: entry.name });
    return <section ref={section} tabIndex={-1} className={styles.download_entry} data-fit={fit} aria-label={title}
        aria-describedby={help && hints ? helpId : undefined}>
        {help && hints
            ? <div className={runtimeStyles.titleLine} data-hint-host><strong>{title}</strong><Hint text={help} id={helpId} focusable /></div>
            : <strong>{title}</strong>}
        {fit && <div className={styles.card_badges}>
            <span className={styles.badge} data-tone={fit === "fits" ? "recommended" : undefined}>{t(`vc_runtime.fit_${fit}`)}</span>
        </div>}
        {help && !hints && <p>{help}</p>}
        {/* The saved folder holds a runtime this version cannot use (the earlier PyTorch RVC runtime). */}
        {!installed && !active && current && current === entry.destination && <p role="alert">{t("vc_runtime.outdated")}</p>}
        {!installed && <p>{t("vc_runtime.size", { download: gb(entry.download_bytes), disk: gb(entry.disk_bytes) })} · {entry.license}</p>}
        {/* Seed-VC needs the NVIDIA GPU; RVC sets up its CPU runtime instead and says what that means. */}
        {entry.requires_gpu !== false && !entry.gpu_ready && !installed && <p role="alert">{t("vc_runtime.gpu_missing")}</p>}
        {entry.device === "cpu" && !installed && <p>{t("vc_runtime.cpu_only")}</p>}
        {job && <EnvReadout tone={job.phase === "ready" ? "active" : job.phase === "failed" ? "failed" : "neutral"}
            progress={active && job.phase !== "cancelling" ? "working" : job.phase === "ready" ? "done" : undefined}>
            <p>{own(`vc_runtime.phase_${job.phase}`, t(`vc_runtime.phase_${job.phase}`))}{active && job.step > 0 && ` · ${job.step} / ${job.steps}`}</p>
        </EnvReadout>}
        {active && <Progress aria-label={t("vc_runtime.progress")}
            value={job.total_bytes ? job.received_bytes : job.step} max={job.total_bytes || job.steps} />}
        {job?.error_code && <p role="alert">{failure(job.error_code)}</p>}
        {/* Installed, but its GPU check failed: it converts on the CPU. */}
        {job?.warning_code && <p role="status">{t(`vc_runtime.warnings.${job.warning_code}`)}</p>}
        {error && <p role="alert">{failure(error)}</p>}
        {installed && <p>{t("vc_runtime.installed")}: <code style={{ overflowWrap: "anywhere" }}>{installed}</code></p>}
        <div className={styles.actions}>
            {active && <Button disabled={job.phase === "cancelling" || !!pending}
                onClick={() => send("/run/cancel_vc_runtime_setup", { id: engine, job_id: job.job_id })}>{t("vc_runtime.cancel")}</Button>}
            {/* The translation's runtimes are chosen through the compute device, not here. */}
            {onUse && installed && installed !== current && <Button disabled={disabled} onClick={() => onUse(installed)}>{t("vc_runtime.use")}</Button>}
            {/* Fetched and waiting for the next start (Windows, #900): starting again would only wait again. */}
            {/* A build not needed for the user's GPU offers no download (#614, beta.2): its badge says so. */}
            {!installed && !active && job?.phase !== "restart_required" && fit !== "unneeded" && <Button tone={fit === "fits" ? "primary" : "plain"}
                disabled={busy || (entry.requires_gpu !== false && !entry.gpu_ready)}
                onClick={() => { setConsent(false); setOpen(true); }}>{t(job ? "vc_runtime.resume" : "vc_runtime.review")}</Button>}
        </div>
        {open && <dialog ref={dialog} aria-label={t("vc_runtime.warning_title")} onCancel={event => { event.preventDefault(); close(); }}>
            <div className={styles.dialog_text}>
                <h3>{t("vc_runtime.warning_title")}</h3>
                <p>{t(`vc_runtime.notice_${entry.notice}`)}</p>
                <p>{t("vc_runtime.size", { download: gb(entry.download_bytes), disk: gb(entry.disk_bytes) })}</p>
                <p>{t(`vc_runtime.connection_notice_${entry.notice}`)}</p>
                <p>{own("vc_runtime.no_start", t("vc_runtime.no_start"))}</p>
                <p>{t("model_downloads.license_links")}: {entry.licenses.map(url => <span key={url}> <a href={url} onClick={event => openLink(event, url)} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{url}</a> </span>)}</p>
                {linkError && <div role="alert"><p>{t("model_downloads.link_error")}</p><code style={{ overflowWrap: "anywhere" }}>{linkError}</code></div>}
                <p>{t("model_downloads.destination")}: <code style={{ overflowWrap: "anywhere" }}>{entry.destination}</code></p>
            </div>
            <label className={styles.checkLabel}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{t("vc_runtime.consent")}</label>
            <div className={styles.actions}>
                <button type="button" autoFocus onClick={close}>{t("model_downloads.back")}</button>
                <button type="button" disabled={!consent || busy} onClick={() => {
                    if (!consent || busy) return;
                    send("/run/start_vc_runtime_setup", { id: engine, consent: true, version: entry.version }); close();
                }}>{t("vc_runtime.start")}</button>
            </div>
        </dialog>}
    </section>;
};
