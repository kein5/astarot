import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./SpeakerNames.css.ts";
import { MAX_SPEAKER_NAME, isSpeakerName, tidySpeakerName } from "../../../../../../../logics/common/speakerNames.ts";
import type { SessionSpeakerNames } from "../../../../../../../logics/common/speakerNames.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// Who spoke, as the log writes it (#447). Without names it stays "話者A・B"; once a voice has a
// name, each voice is written on its own: its name, or "話者B".
export const speakersText = (t: Translate, labels: readonly string[], names: SessionSpeakerNames | undefined): string => {
    const separator = t("main_page.message_log.speakers_separator");
    if (!labels.some(label => names?.[label])) {
        return t("main_page.message_log.speakers", { speakers: labels.join(separator) });
    }
    return labels.map(label => names?.[label] || t("main_page.message_log.speaker_label", { label })).join(separator);
};

type EditorProps = {
    labels: readonly string[];
    names: SessionSpeakerNames | undefined;
    // The names of this row's voices; the caller merges them into the session's names.
    onSave: (names: SessionSpeakerNames) => void;
    onClose: () => void;
};

// The form under a row that names its voices. Enter saves and Escape closes it; the focus goes
// back to the speakers' button (the caller's). Nothing changes until the core takes the names.
export const SpeakerNamesEditor = ({ labels, names, onSave, onClose }: EditorProps) => {
    const { t } = useI18n() as { t: Translate };
    const id = useId();
    const first = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState<SessionSpeakerNames>(() =>
        Object.fromEntries(labels.map(label => [label, names?.[label] ?? ""])));
    useEffect(() => { first.current?.focus(); }, []);
    const valid = labels.every(label => isSpeakerName(draft[label] ?? ""));

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!valid) return;
        onSave(Object.fromEntries(labels.map(label => [label, tidySpeakerName(draft[label] ?? "")])));
        onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
    };

    return (
        <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown} aria-describedby={`${id}-hint`}>
            {labels.map((label, index) => (
                <label key={label} className={styles.field}>
                    {t("main_page.message_log.speaker_name_field", { label })}
                    <input ref={index === 0 ? first : undefined} className={styles.input} type="text"
                        value={draft[label] ?? ""} maxLength={MAX_SPEAKER_NAME} spellCheck={false} autoComplete="off"
                        aria-invalid={!isSpeakerName(draft[label] ?? "") || undefined}
                        onChange={event => setDraft(current => ({ ...current, [label]: event.target.value }))} />
                </label>
            ))}
            <div className={styles.actions}>
                <button type="submit" className={styles.save} disabled={!valid}>{t("main_page.message_log.speaker_names_save")}</button>
                <button type="button" className={styles.cancel} onClick={onClose}>{t("main_page.message_log.speaker_names_cancel")}</button>
            </div>
            <p id={`${id}-hint`} className={styles.hint}>{t("main_page.message_log.speaker_names_hint")}</p>
        </form>
    );
};
