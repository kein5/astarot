import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./VocabularyBuiltin.css.ts";
import voiceStyles from "../advanced_settings/VoiceSettings.module.scss";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import { builtinRows, changeReadings, readingsText, restoreAllBuiltin, restoreBuiltin, takeOut }
    from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { BuiltinRow, ReadingsChange, Vocabulary } from "../../../../../../logics/transcription/vocabularyTerms.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

type Props = {
    // The built-in terms as the app ships them (/get/data/builtin_vocabulary).
    builtin: readonly string[];
    vocabulary: Vocabulary;
    disabled: boolean;
    // The vocabulary after a change; the form keeps it until the settings are saved.
    onVocabulary: (vocabulary: Vocabulary) => void;
};

// The built-in VRChat terms, each with the user's change over it (#792): its readings changed,
// taken out, or as the app ships it. The changes are the user's own dictionary built on the
// built-in one; a term left as it ships follows a newer app's list.
export const VocabularyBuiltin = ({ builtin, vocabulary, disabled, onVocabulary }: Props) => {
    const { t } = useI18n() as { t: Translate };
    const hints = useHintDescriptions();
    const id = useId();
    // The written form whose readings are being changed, and the readings as typed.
    const [editing, setEditing] = useState<string | null>(null);
    const [typed, setTyped] = useState("");
    const rows = builtinRows(builtin, vocabulary);
    const changed = rows.filter(row => row.state === "changed").length;
    const removed = rows.filter(row => row.state === "removed").length;
    const editedRow = rows.find(row => row.shipped === editing);
    const trial: ReadingsChange | null = editedRow ? changeReadings(vocabulary, editedRow.shipped, typed) : null;

    const startEdit = (row: BuiltinRow) => { setEditing(row.shipped); setTyped(readingsText(row.readings)); };
    const apply = () => {
        if (!trial?.ok) return;
        onVocabulary(trial.vocabulary);
        setEditing(null);
    };
    const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") { event.preventDefault(); apply(); }
        if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
    };

    return (
        <details className={styles.fold}>
            <summary className={styles.summary}>
                <span>{t("realtime.vocabulary_builtin_list", { count: rows.length })}</span>
                {changed > 0 && <span className={voiceStyles.badge} data-tone="changed">{t("realtime.vocabulary_changed_count", { count: changed })}</span>}
                {removed > 0 && <span className={voiceStyles.badge}>{t("realtime.vocabulary_removed_count", { count: removed })}</span>}
            </summary>
            {/* How the changes lie over the built-in list and follow a newer app: the list's hint on a
                page that keeps descriptions out of sight (#614), a line elsewhere. */}
            {hints
                ? <span className={voiceStyles.hinted} data-hint-host><span>{t("realtime.vocabulary_builtin_about")}</span>
                    <Hint text={t("realtime.vocabulary_builtin_help")} focusable /></span>
                : <p>{t("realtime.vocabulary_builtin_help")}</p>}
            <ul className={styles.rows} aria-label={t("realtime.vocabulary_builtin_list", { count: rows.length })}>
                {rows.map(row => {
                    const term = row.written;
                    const isEditing = editing === row.shipped;
                    return <li key={row.shipped} className={styles.row} data-state={row.state}>
                        <span className={styles.written}>{term}</span>
                        {isEditing
                            ? <span className={styles.edit}>
                                <span className={styles.editLine}>
                                    <input value={typed} readOnly={disabled} spellCheck={false} maxLength={300} autoFocus
                                        aria-label={t("realtime.vocabulary_readings_of", { term })}
                                        aria-describedby={trial && !trial.ok ? `${id}-problem` : undefined}
                                        aria-invalid={trial && !trial.ok ? true : undefined}
                                        onChange={event => setTyped(event.target.value)} onKeyDown={onKey} />
                                    <button type="button" disabled={disabled || !trial?.ok} onClick={apply}>{t("realtime.vocabulary_readings_apply")}</button>
                                    <button type="button" onClick={() => setEditing(null)}>{t("realtime.vocabulary_readings_cancel")}</button>
                                </span>
                                {trial && !trial.ok && <span id={`${id}-problem`} className={styles.problem} role="status">
                                    {t(trial.reason === "full" ? "realtime.vocabulary_readings_full" : "realtime.vocabulary_readings_invalid")}</span>}
                            </span>
                            : <span className={styles.readings}>
                                {row.readings.length ? <span>{readingsText(row.readings)}</span>
                                    : <span className={styles.none}>{t("realtime.vocabulary_no_reading")}</span>}
                                {row.state !== "builtin" && <span className={voiceStyles.badge} data-tone={row.state === "changed" ? "changed" : undefined}>
                                    {t(`realtime.vocabulary_state_${row.state}`)}</span>}
                            </span>}
                        {!isEditing && <span className={styles.actions}>
                            {row.state !== "removed" && <button type="button" className={voiceStyles.quiet} disabled={disabled} onClick={() => startEdit(row)}
                                aria-label={t("realtime.vocabulary_change_readings_of", { term })}>{t("realtime.vocabulary_change_readings")}</button>}
                            {row.state === "changed" && <button type="button" className={voiceStyles.quiet} disabled={disabled} onClick={() => onVocabulary(restoreBuiltin(vocabulary, row.shipped))}
                                aria-label={t("realtime.vocabulary_restore_of", { term })}>{t("realtime.vocabulary_restore")}</button>}
                            {row.state === "removed"
                                ? <button type="button" className={voiceStyles.quiet} disabled={disabled} onClick={() => onVocabulary(restoreBuiltin(vocabulary, row.shipped))}
                                    aria-label={t("realtime.vocabulary_put_back_of", { term })}>{t("realtime.vocabulary_put_back")}</button>
                                : <button type="button" className={voiceStyles.quiet} disabled={disabled} onClick={() => onVocabulary(takeOut(vocabulary, row.shipped))}
                                    aria-label={t("realtime.vocabulary_take_out_of", { term })}>{t("realtime.vocabulary_take_out")}</button>}
                        </span>}
                    </li>;
                })}
            </ul>
            <div><button type="button" disabled={disabled || (!changed && !removed)}
                onClick={() => { setEditing(null); onVocabulary(restoreAllBuiltin(vocabulary, builtin)); }}>{t("realtime.vocabulary_restore_all")}</button></div>
        </details>
    );
};
