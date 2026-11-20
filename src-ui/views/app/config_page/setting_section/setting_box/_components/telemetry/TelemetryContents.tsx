import { useI18n } from "@useI18n";
import { useOthers } from "@logics_configs";
import { telemetryRows, sentSummary } from "../../../../../../../logics/common/telemetryRows";
import styles from "./TelemetryContents.module.scss";
import { Fold } from "../fold/Fold";

// "See what is sent": the usage event this PC would send now, field by field and as the
// data itself, and (with_sent) what was sent before. The backend builds it with the call
// that builds what it sends. It is asked for when the user opens it, not before.
export const TelemetryContents = ({ with_sent = false }: { with_sent?: boolean }) => {
    const { t } = useI18n();
    const { currentTelemetryPreview, getTelemetryPreview } = useOthers();
    const preview = currentTelemetryPreview.data;
    const event = preview?.app_started;
    const sent = preview?.sent ?? [];

    return <Fold className={styles.contents} onToggle={toggled => { if (toggled.currentTarget.open) getTelemetryPreview(); }}
        summary={t("telemetry_contents.show")}>
        {!event
            ? <p role="status">{t(currentTelemetryPreview.state === "pending" || preview == null
                ? "telemetry_contents.loading" : "telemetry_contents.unavailable")}</p>
            : <>
                <p>{t("telemetry_contents.intro")}</p>
                <dl className={styles.rows}>
                    {telemetryRows(event, t).map(row => <div key={row.key} className={styles.row}>
                        <dt>{row.label}</dt><dd>{row.value}</dd>
                    </div>)}
                </dl>
                <p>{t("telemetry_contents.error_note")}</p>
                {preview?.endpoint && <p>{t("telemetry_contents.destination", { endpoint: preview.endpoint })}</p>}
                {/* Not in the event: what the receiver notes on its own when one arrives. */}
                <p>{t("telemetry_contents.receiver_note")}</p>
                <Fold size="link" className={styles.raw} summary={t("telemetry_contents.raw")}>
                    <pre tabIndex={0}>{JSON.stringify(event, null, 2)}</pre>
                </Fold>
                {with_sent && <section className={styles.sent} aria-label={t("telemetry_contents.sent_title")}>
                    <h4>{t("telemetry_contents.sent_title")}</h4>
                    {sent.length === 0
                        ? <p>{t("telemetry_contents.sent_none")}</p>
                        : <ul>
                            {[...sent].reverse().map((row, index) => <li key={`${row.at}-${index}`}>
                                <Fold size="link" className={styles.raw}
                                    summary={<>{row.at} — {sentSummary(row.body, t)} — {t(row.accepted ? "telemetry_contents.sent_accepted" : "telemetry_contents.sent_failed")}</>}>
                                    <pre tabIndex={0}>{JSON.stringify(row.body, null, 2)}</pre>
                                </Fold>
                            </li>)}
                        </ul>}
                </section>}
            </>}
    </Fold>;
};
