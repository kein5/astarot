import { useEffect, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import { useLocalAsrMigration } from "../../../../../../logics/transcription/useLocalAsrMigration";
import { hasOldWeights, weightsSize } from "../../../../../../logics/transcription/localAsrMigration.ts";
import styles from "../advanced_settings/VoiceSettings.module.scss";
import own from "./OldWhisperWeights.module.scss";

// The Whisper weights an earlier version downloaded and nothing reads any more (#288).
// Shown while any remain, and after a delete to say what it did. Deleting asks first, in
// place, so it works the same in the settings and inside the one-time notice dialog.
export const OldWhisperWeights = ({ inDialog = false }) => {
    const { t } = useI18n();
    const { weights, outcome, deleting, error, deleteWeights } = useLocalAsrMigration();
    const [confirming, setConfirming] = useState(false);
    const deleteButton = useRef(null), result = useRef(null), focusDelete = useRef(false);
    const wasDeleting = useRef(deleting);
    // Focus follows the steps: back to the delete button after Cancel or Delete (it shows the
    // wait), then to the result once the backend has answered.
    useEffect(() => {
        if (!confirming && focusDelete.current) {
            focusDelete.current = false;
            deleteButton.current?.focus();
        }
    }, [confirming]);
    useEffect(() => {
        if (wasDeleting.current && !deleting) (result.current ?? deleteButton.current)?.focus();
        wasDeleting.current = deleting;
    }, [deleting]);

    const remaining = hasOldWeights(weights);
    if (!remaining && !outcome && !error) return null;
    const size = weightsSize(weights?.total_bytes);
    const leave = () => { focusDelete.current = true; setConfirming(false); };
    const Heading = inDialog ? "h4" : "h3";
    return <section className={inDialog ? own.part : styles.container} aria-label={t("old_whisper_weights.label")}
        data-setting-id={inDialog ? undefined : "old_whisper_weights"}>
        <Heading>{t("old_whisper_weights.label")}</Heading>
        {remaining && <p>{t("old_whisper_weights.desc", { size })}</p>}
        {outcome && (remaining
            ? <p role="alert" tabIndex={-1} ref={result}>{t("old_whisper_weights.failed", { size })}</p>
            : <p role="status" tabIndex={-1} ref={result}>{t("old_whisper_weights.deleted", { size: weightsSize(outcome.freed_bytes) })}</p>)}
        {error && <p role="alert">{t("old_whisper_weights.unavailable")}</p>}
        {remaining && (confirming
            ? <div className={own.confirm} role="group" aria-label={t("old_whisper_weights.delete")}>
                <p>{t("old_whisper_weights.confirm", { size })}</p>
                <div className={own.actions}>
                    {/* The safe answer takes the focus. */}
                    <button type="button" autoFocus onClick={leave}>{t("old_whisper_weights.cancel")}</button>
                    <button type="button" className={own.danger} onClick={() => { leave(); deleteWeights(); }}>
                        {t("old_whisper_weights.confirm_delete")}</button>
                </div>
            </div>
            // Not disabled while deleting, so it keeps the focus; repeat presses are ignored.
            : <button type="button" ref={deleteButton} className={`${styles.quiet} ${own.delete}`} aria-disabled={deleting || undefined}
                onClick={() => { if (!deleting) setConfirming(true); }}>
                {t(deleting ? "old_whisper_weights.deleting" : "old_whisper_weights.delete")}</button>)}
    </section>;
};
