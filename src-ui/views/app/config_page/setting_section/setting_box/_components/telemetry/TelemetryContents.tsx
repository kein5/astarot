import { useI18n } from "@useI18n";
import { useOthers } from "@logics_configs";
import { telemetryRows, sentSummary } from "../../../../../../../logics/common/telemetryRows";
import * as styles from "./TelemetryContents.css.ts";
import { Fold } from "../fold/Fold";

// The fields every usage event carries, in the order it carries them. Until the event comes, the
// contents are drawn with these rows and no values, so the fold opened before the answer does
// not grow by them when it comes (#912). What depends on the PC (its hardware, where events go,
// what was sent) is added with the answer.
const ALWAYS = ["event", "v", "timestamp", "app_version", "os", "os_version", "locale"] as const;

// "See what is sent": the usage event this PC would send now, field by field and as the
// data itself, and (with_sent) what was sent before. The backend builds it with the call
// that builds what it sends. It is asked for when the user opens it, not before; the fold
// says so (data-asks-on-open), as what comes then answers the opening.
export const TelemetryContents = ({ with_sent = false }: { with_sent?: boolean }) => {
    const { t } = useI18n();
    const { currentTelemetryPreview, getTelemetryPreview } = useOthers();
    const preview = currentTelemetryPreview.data;
    const event = preview?.app_started;
    const sent = preview?.sent ?? [];
    const waiting = !event && (currentTelemetryPreview.state === "pending" || preview == null);
    const rows = event ? telemetryRows(event, t)
        : ALWAYS.map(key => ({ key, label: t(`telemetry_contents.fields.${key}`), value: "…" }));

    return <Fold data-asks-on-open className={styles.contents} onToggle={toggled => { if (toggled.currentTarget.open) getTelemetryPreview(); }}
        summary={t("telemetry_contents.show")}>
        {!event && !waiting
            ? <p role="status">{t("telemetry_contents.unavailable")}</p>
            : <>
                <p>{t("telemetry_contents.intro")}</p>
                {/* While it is asked for, a screen reader hears so; the rows keep their place, unseen words. */}
                {waiting && <p role="status" className={styles.hidden}>{t("telemetry_contents.loading")}</p>}
                <dl className={styles.rows} aria-busy={waiting || undefined}>
                    {rows.map(row => <div key={row.key} className={styles.row}>
                        <dt>{row.label}</dt><dd>{row.value}</dd>
                    </div>)}
                </dl>
                <p>{t("telemetry_contents.error_note")}</p>
                {preview?.endpoint && <p>{t("telemetry_contents.destination", { endpoint: preview.endpoint })}</p>}
                {/* Not in the event: what the receiver notes on its own when one arrives. */}
                <p>{t("telemetry_contents.receiver_note")}</p>
                <Fold size="link" className={styles.raw} summary={t("telemetry_contents.raw")}>
                    <pre tabIndex={0}>{event ? JSON.stringify(event, null, 2) : "…"}</pre>
                </Fold>
                {with_sent && <section className={styles.sent} aria-label={t("telemetry_contents.sent_title")}>
                    <h4>{t("telemetry_contents.sent_title")}</h4>
                    {waiting
                        ? <p>…</p>
                        : sent.length === 0
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
