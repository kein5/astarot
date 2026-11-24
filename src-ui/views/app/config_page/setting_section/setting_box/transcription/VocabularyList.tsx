import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./VocabularyList.css.ts";
import * as voiceStyles from "../advanced_settings/VoiceSettings.css.ts";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import { Fold } from "../_components/fold/Fold";
import { Button, TextField } from "../../../../../kit/index.ts";
import { addTerm, changeOwnReadings, changeReadings, deleteOwn, dictionaryRows, readingsText, restoreAllBuiltin, restoreBuiltin, takeOut }
    from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { AddResult, DictionaryRow, ReadingsChange, Vocabulary } from "../../../../../../logics/transcription/vocabularyTerms.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

type Props = {
    // The built-in terms as the app ships them (/get/data/builtin_vocabulary); null until the core
    // answers.
    builtin: readonly string[] | null;
    vocabulary: Vocabulary;
    disabled: boolean;
    // The vocabulary after a change; the form keeps it until the settings are saved.
    onVocabulary: (vocabulary: Vocabulary) => void;
};

// What the last add did, said under the fields: the term it named, or why nothing was added.
type Added = { result: AddResult; term: string };

const addedText = (t: Translate, { result, term }: Added): string => {
    if (result.ok) return t(result.kind === "builtin" ? "realtime.vocabulary_add_builtin" : "realtime.vocabulary_add_done", { term });
    return t(`realtime.vocabulary_add_${result.reason}`, { term });
};

// The dictionary in use, one list (#792): the user's own terms, then the built-in VRChat terms with
// the user's change over each (its readings changed, taken out, or as the app ships it). Terms are
// added at the head of the list. The changes are the user's own dictionary built on the built-in
// one; a built-in term left as it ships follows a newer app's list.
export const VocabularyList = ({ builtin, vocabulary, disabled, onVocabulary }: Props) => {
    const { t } = useI18n() as { t: Translate };
    const hints = useHintDescriptions();
    const id = useId();
    // The row whose readings are being changed, and the readings as typed.
    const [editing, setEditing] = useState<string | null>(null);
    const [typed, setTyped] = useState("");
    // The term being added.
    const [written, setWritten] = useState("");
    const [readings, setReadings] = useState("");
    const [added, setAdded] = useState<Added | null>(null);

    const rows = dictionaryRows(builtin, vocabulary);
    const count = (state: DictionaryRow["state"]) => rows.filter(row => row.state === state).length;
    const changed = count("changed"), removed = count("removed");
    const editedRow = rows.find(row => row.term === editing);
    const trial: ReadingsChange | null = !editedRow ? null
        : editedRow.state === "own" ? changeOwnReadings(vocabulary, editedRow.term, typed) : changeReadings(vocabulary, editedRow.term, typed);

    const startEdit = (row: DictionaryRow) => { setEditing(row.term); setTyped(readingsText(row.readings)); };
    const apply = () => {
        if (!trial?.ok) return;
        onVocabulary(trial.vocabulary);
        setEditing(null);
    };
    const onEditKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") { event.preventDefault(); apply(); }
        if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
    };
    const add = () => {
        if (disabled || !written.trim()) return;
        const result = addTerm(vocabulary, builtin, written, readings);
        setAdded({ result, term: written.trim() });
        if (!result.ok) return;
        onVocabulary(result.vocabulary);
        setWritten("");
        setReadings("");
    };
    const onAddKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") { event.preventDefault(); add(); }
    };
    // Typing again puts away what the last add said.
    const typing = (set: (value: string) => void) => (value: string) => { set(value); setAdded(null); };

    return (
        // A bar of the app's one fold (Fold.tsx), closed at first: the number of terms in use and
        // nothing more. What the user changed is read in the list (#792).
        <Fold summary={t("realtime.vocabulary_list", { count: rows.length - removed })}>
            {/* How the list is built and follows a newer app: the hint of its line on a page that
                keeps descriptions out of sight (#614), a line elsewhere. */}
            {hints
                ? <span className={voiceStyles.hinted} data-hint-host><span>{t("realtime.vocabulary_list_about")}</span>
                    <Hint text={t("realtime.vocabulary_list_help")} focusable /></span>
                : <p>{t("realtime.vocabulary_list_help")}</p>}
            {/* A new term: its written form and readings, at the head of the list it joins. */}
            <div className={styles.add}>
                <label className={styles.addField}>{t("realtime.vocabulary_new_written")}
                    <TextField value={written} readOnly={disabled} spellCheck={false} maxLength={300}
                        placeholder={t("realtime.vocabulary_new_written_placeholder")}
                        onChange={event => typing(setWritten)(event.target.value)} onKeyDown={onAddKey} /></label>
                <label className={styles.addField}>{t("realtime.vocabulary_new_readings")}
                    <TextField value={readings} readOnly={disabled} spellCheck={false} maxLength={300}
                        placeholder={t("realtime.vocabulary_new_readings_placeholder")}
                        onChange={event => typing(setReadings)(event.target.value)} onKeyDown={onAddKey} /></label>
                <Button disabled={disabled || !written.trim()} onClick={add}>{t("realtime.vocabulary_add")}</Button>
            </div>
            <p role="status" className={added && !added.result.ok ? styles.problem : undefined}>{added ? addedText(t, added) : ""}</p>
            <ul className={styles.rows} aria-label={t("realtime.vocabulary_list", { count: rows.length - removed })}>
                {rows.map(row => {
                    const term = row.written;
                    const isEditing = editing === row.term;
                    return <li key={`${row.state === "own" ? "own" : "builtin"}:${row.term}`} className={styles.row} data-state={row.state}>
                        <span className={styles.written}>{term}</span>
                        {isEditing
                            ? <span className={styles.edit}>
                                <span className={styles.editLine}>
                                    <TextField value={typed} readOnly={disabled} spellCheck={false} maxLength={300} autoFocus
                                        aria-label={t("realtime.vocabulary_readings_of", { term })}
                                        aria-describedby={trial && !trial.ok ? `${id}-problem` : undefined}
                                        invalid={!!trial && !trial.ok}
                                        onChange={event => setTyped(event.target.value)} onKeyDown={onEditKey} />
                                    <Button disabled={disabled || !trial?.ok} onClick={apply}>{t("realtime.vocabulary_readings_apply")}</Button>
                                    <Button onClick={() => setEditing(null)}>{t("realtime.vocabulary_readings_cancel")}</Button>
                                </span>
                                {trial && !trial.ok && <span id={`${id}-problem`} className={styles.problem} role="status">
                                    {t(trial.reason === "full" ? "realtime.vocabulary_readings_full" : "realtime.vocabulary_readings_invalid")}</span>}
                            </span>
                            : <span className={styles.readings}>
                                {row.readings.length ? <span>{readingsText(row.readings)}</span>
                                    : <span className={styles.none}>{t("realtime.vocabulary_no_reading")}</span>}
                            </span>}
                        {!isEditing && <span className={styles.actions}>
                            {row.state !== "removed" && <Button tone="quiet" size="compact" disabled={disabled} onClick={() => startEdit(row)}
                                aria-label={t("realtime.vocabulary_change_readings_of", { term })}>{t("realtime.vocabulary_change_readings")}</Button>}
                            {row.state === "changed" && <Button tone="quiet" size="compact" disabled={disabled} onClick={() => onVocabulary(restoreBuiltin(vocabulary, row.term))}
                                aria-label={t("realtime.vocabulary_restore_of", { term })}>{t("realtime.vocabulary_restore")}</Button>}
                            {row.state === "own"
                                ? <Button tone="danger" size="compact" disabled={disabled} onClick={() => onVocabulary(deleteOwn(vocabulary, row.term))}
                                    aria-label={t("realtime.vocabulary_remove", { term })}>{t("realtime.vocabulary_remove_short")}</Button>
                                : row.state === "removed"
                                    ? <Button tone="quiet" size="compact" disabled={disabled} onClick={() => onVocabulary(restoreBuiltin(vocabulary, row.term))}
                                        aria-label={t("realtime.vocabulary_put_back_of", { term })}>{t("realtime.vocabulary_put_back")}</Button>
                                    : <Button tone="quiet" size="compact" disabled={disabled} onClick={() => onVocabulary(takeOut(vocabulary, row.term))}
                                        aria-label={t("realtime.vocabulary_take_out_of", { term })}>{t("realtime.vocabulary_take_out")}</Button>}
                        </span>}
                    </li>;
                })}
            </ul>
            {builtin && vocabulary.builtin !== false && <div><Button disabled={disabled || (!changed && !removed)}
                onClick={() => { setEditing(null); onVocabulary(restoreAllBuiltin(vocabulary, builtin)); }}>{t("realtime.vocabulary_restore_all")}</Button></div>}
        </Fold>
    );
};
