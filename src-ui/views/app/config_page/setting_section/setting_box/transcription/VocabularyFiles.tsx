import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useI18n } from "@useI18n";
import * as styles from "./VocabularyFiles.css.ts";
import voiceStyles from "../advanced_settings/VoiceSettings.module.scss";
import { MAX_IMPORT_BYTES, importVocabulary } from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { ImportResult, Vocabulary } from "../../../../../../logics/transcription/vocabularyTerms.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// A request to the core, answered with its reply (useRealtimeASR's send); false when it could not
// be sent.
type Send = (endpoint: string, data?: unknown) => Promise<unknown>;

// A file the field gives: its size and its text.
type PickedFile = { size: number; text: () => Promise<string> };

type Props = {
    builtin: readonly string[] | null;
    vocabulary: Vocabulary;
    disabled: boolean;
    // The vocabulary after a file was read; the form keeps it until the settings are saved.
    onVocabulary: (vocabulary: Vocabulary) => void;
    send: Send;
};

// What the last import or export did, said under the buttons.
type Outcome =
    | { kind: "imported"; result: ImportResult }
    | { kind: "unreadable" | "too_large" | "export_failed" }
    | { kind: "exported"; file: string };

// The file named in the core's reply to a write-out, or null when it was not written.
const writtenFile = (reply: unknown): string | null => {
    if (!reply || typeof reply !== "object" || Reflect.get(reply, "status") !== 200) return null;
    const result: unknown = Reflect.get(reply, "result");
    const file: unknown = result && typeof result === "object" ? Reflect.get(result, "file") : undefined;
    return typeof file === "string" ? file : null;
};

const importedText = (t: Translate, result: ImportResult): string[] => {
    // What was done, then what the dictionary now holds, then the lines left.
    const done = result.empty ? [t("realtime.vocabulary_import_empty")]
        : result.unchanged ? [t("realtime.vocabulary_import_nothing")]
        : [t("realtime.vocabulary_import_done"), t("realtime.vocabulary_import_counts", { own: result.own, changed: result.changed, removed: result.removed })];
    const skipped = ([["invalid", result.invalid], ["duplicate", result.duplicate], ["over", result.over]] as const)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => t(`realtime.vocabulary_import_${reason}`, { count }));
    return skipped.length ? [...done, t("realtime.vocabulary_import_skipped", { parts: skipped.join(t("realtime.vocabulary_import_separator")) })] : done;
};

// The dictionary in and out of a file (#792): the dictionary in use, written out by the core into
// a folder of its own, and read back from a file the user picks. Reading a file makes the
// dictionary the file's terms (importVocabulary) and changes the draft only; saving stays with the
// save bar. It waits for the built-in terms, which it needs to tell a changed one from a new one.
export const VocabularyFiles = ({ builtin, vocabulary, disabled, onVocabulary, send }: Props) => {
    const { t } = useI18n() as { t: Translate };
    const input = useRef<HTMLInputElement>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [exporting, setExporting] = useState(false);

    const read = async (file: PickedFile) => {
        if (file.size > MAX_IMPORT_BYTES) { setOutcome({ kind: "too_large" }); return; }
        let text: string;
        try { text = await file.text(); } catch { setOutcome({ kind: "unreadable" }); return; }
        if (!builtin) return;
        const result = importVocabulary(vocabulary, builtin, text);
        setOutcome({ kind: "imported", result });
        if (!result.empty && !result.unchanged) onVocabulary(result.vocabulary);
    };
    const picked = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // The same file can be picked again.
        event.target.value = "";
        if (file) void read(file);
    };
    const exportFile = async () => {
        setExporting(true);
        const file = writtenFile(await send("/run/export_vocabulary", vocabulary));
        setExporting(false);
        setOutcome(file ? { kind: "exported", file } : { kind: "export_failed" });
    };

    const lines = !outcome ? []
        : outcome.kind === "imported" ? importedText(t, outcome.result)
        : outcome.kind === "exported" ? [t("realtime.vocabulary_export_done", { file: outcome.file })]
        : [t(`realtime.vocabulary_${outcome.kind === "export_failed" ? "export_failed" : `import_${outcome.kind}`}`)];
    const problem = outcome !== null && (outcome.kind === "unreadable" || outcome.kind === "too_large" || outcome.kind === "export_failed"
        || (outcome.kind === "imported" && outcome.result.empty));

    return (
        <div className={styles.files}>
            <div className={styles.actions}>
                <button type="button" disabled={disabled || !builtin} onClick={() => input.current?.click()}>{t("realtime.vocabulary_import")}</button>
                {/* The browser's own file picker, behind the button: text files only. */}
                <input ref={input} type="file" accept=".txt,text/plain" hidden tabIndex={-1} aria-hidden="true" onChange={picked} />
                <button type="button" disabled={disabled || exporting} onClick={() => void exportFile()}>{t("realtime.vocabulary_export")}</button>
                {outcome?.kind === "exported" && <button type="button" className={voiceStyles.quiet}
                    onClick={() => void send("/run/open_filepath_vocabulary_exports")}>{t("realtime.vocabulary_export_open")}</button>}
            </div>
            <div role="status" className={problem ? `${styles.status} ${styles.problem}` : styles.status}>{lines.map(line => <p key={line}>{line}</p>)}</div>
        </div>
    );
};
