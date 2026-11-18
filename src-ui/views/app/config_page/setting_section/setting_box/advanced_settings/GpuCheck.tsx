import { useId, useState } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCopyToClipboard } from "@logics_common";
import { useGpuCheck } from "../../../../../../logics/support/useGpuCheck.ts";
import { deviceRows, issueUrl } from "../../../../../../logics/support/gpuCheck.ts";
import type { GpuRun } from "../../../../../../logics/support/gpuCheck.ts";
import * as styles from "./GpuCheck.css.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const key = (name: string) => `config_page.advanced_settings.gpu_check.${name}`;

// One run in the table: whether it ran, on what, and how fast; a failure by its code.
const runText = (t: Translate, run: GpuRun | null, step: "tts" | "asr"): string => {
    if (!run) return "—";
    if (!run.ok) return t(key("run_failed"), { code: run.error ?? "-" });
    const speed = typeof run.rtfx === "number" ? t(key("run_speed"), { rtfx: run.rtfx }) : "";
    const match = step === "asr" && typeof run.cer_to_cpu === "number" ? t(key("run_match"), { percent: Math.round(run.cer_to_cpu * 100) }) : "";
    return [t(key("run_ok")), speed, match].filter(Boolean).join(t(key("separator")));
};

// Why a check did not complete, in words where the code has its own.
const ERROR_TEXT: Record<string, string> = {
    gpu_check_no_speech_build: "error_no_speech_build",
    gpu_check_devices_unreadable: "error_devices_unreadable",
};
const errorText = (t: Translate, code: string): string => (ERROR_TEXT[code] ? t(key(ERROR_TEXT[code])) : t(key("failed"), { code }));

// The GPU check (#288, decision 6). It is how results from GPUs the project cannot test (AMD
// above all) are gathered: the user starts it, reads every line of the report, and sends it as
// a GitHub issue only if they choose to. The app itself sends nothing.
export const GpuCheck = () => {
    const { t } = useI18n() as { t: Translate };
    const { check, start, stop } = useGpuCheck();
    const { is_copied, copyToClipboard } = useCopyToClipboard({ duration: 1500 });
    const [linkFailed, setLinkFailed] = useState<string | null>(null);
    const reportId = useId();
    const running = check.phase !== "idle";
    const rows = deviceRows(check.report);
    const reportText = check.text ?? "";
    const issue = issueUrl(check.report, reportText);

    const openIssue = async () => {
        // The report is on the clipboard too, for an address too long to carry it.
        await copyToClipboard(reportText);
        if (!isTauri()) return;
        try {
            await openUrl(issue.url);
            setLinkFailed(null);
        } catch {
            setLinkFailed(issue.url);
        }
    };

    return (
        <div className={styles.container} data-setting-id="gpu_check">
            <p className={styles.description}>{t(key("desc"))}</p>
            <p className={styles.description}>{t(key("what"))}</p>
            <p className={styles.description}>{t(key("privacy"))}</p>
            <div className={styles.actions}>
                <button type="button" disabled={running} onClick={() => void start()}>{t(key("start"))}</button>
                {running && <button type="button" onClick={() => void stop()}>{t(key("stop"))}</button>}
            </div>
            <div role="status">
                {running && <p>{t(key(`step_${check.step ?? "environment"}`))}</p>}
                {!running && check.outcome === "cancelled" && <p>{t(key("cancelled"))}</p>}
                {!running && check.error && <p className={styles.failed}>{errorText(t, check.error)}</p>}
            </div>
            {!running && check.outcome === "done" && reportText && <>
                {rows.length > 0 && <div className={styles.tableScroll}>
                    <table className={styles.table}>
                        <caption>{t(key("table_caption"))}</caption>
                        <thead><tr>
                            <th scope="col">{t(key("column_device"))}</th>
                            <th scope="col">{t(key("column_tts"))}</th>
                            <th scope="col">{t(key("column_asr"))}</th>
                        </tr></thead>
                        <tbody>{rows.map(row => (
                            <tr key={row.device}>
                                <th scope="row">{row.device === "cpu" ? t(key("cpu")) : row.name ?? row.device}</th>
                                <td>{runText(t, row.tts, "tts")}</td>
                                <td>{runText(t, row.asr, "asr")}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>}
                <p id={reportId}>{t(key("report_label"))}</p>
                <pre className={styles.report} aria-labelledby={reportId} tabIndex={0}>{reportText}</pre>
                <div className={styles.actions}>
                    <button type="button" onClick={() => void copyToClipboard(reportText)}>{t(is_copied ? key("copied") : key("copy"))}</button>
                    <button type="button" onClick={() => void openIssue()}>{t(key("open_issue"))}</button>
                </div>
                <p className={styles.description}>{t(issue.filled ? key("issue_note") : key("issue_note_paste"))}</p>
                {linkFailed && <p role="alert">{t(key("link_failed"))} <code style={{ overflowWrap: "anywhere" }}>{linkFailed}</code></p>}
            </>}
        </div>
    );
};
