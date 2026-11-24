import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./SpeakerNames.css.ts";
import { MAX_SPEAKER_NAME, isSpeakerName, tidySpeakerName } from "../../../../../../../logics/common/speakerNames.ts";
import type { SessionSpeakerNames } from "../../../../../../../logics/common/speakerNames.ts";
import { speakerColorIndex } from "../../../../../../../logics/common/speakerLabels.ts";
import { vars } from "../../../../../../theme/vars.css.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// The colors of the voices in the log (#1036): only the label that says who spoke takes its
// voice's color, and the words stay in the log's own. Several voices in one caption take the
// first one's color, as the caption overlay's line does. The label's words always stay, so a
// voice is never told by color alone.
const SPEAKER_INK = [vars.vox_speaker_a, vars.vox_speaker_b, vars.vox_speaker_c, vars.vox_speaker_d];
export const speakerInk = (labels: readonly string[] | undefined): string | undefined =>
    labels?.length ? SPEAKER_INK[speakerColorIndex(labels[0])] : undefined;

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
