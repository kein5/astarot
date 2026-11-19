import { useId, useState } from "react";
import { useI18n } from "@useI18n";
import { useCopyToClipboard } from "@logics_common";
import * as styles from "./VocabularyBulk.css.ts";
import { Hint, useHintDescriptions } from "../_components/hint/Hint";
import { addTerms, termsText } from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { BulkResult } from "../../../../../../logics/transcription/vocabularyTerms.ts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

// Why lines were not added, naming only the reasons that happened ("" when every line was added).
const skippedText = (t: Translate, result: BulkResult): string => {
    const parts = ([["duplicates", result.duplicates], ["invalid", result.invalid], ["over", result.over]] as const)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => t(`realtime.vocabulary_bulk_${reason}`, { count }));
    return parts.length ? t("realtime.vocabulary_bulk_skipped", { parts: parts.join(t("realtime.vocabulary_bulk_separator")) }) : "";
};

type Props = {
    terms: readonly string[];
    disabled: boolean;
    // The user's terms after a bulk add; the form keeps them until the settings are saved.
    onTerms: (terms: string[]) => void;
};

// Several terms at once, one a line, and the user's terms copied as such lines (#446). Lines the
// core would refuse, and those over the limit, stay in the field to be put right.
export const VocabularyBulk = ({ terms, disabled, onTerms }: Props) => {
    const { t } = useI18n() as { t: Translate };
    const { is_copied, copyToClipboard } = useCopyToClipboard({ duration: 1500 });
    const hints = useHintDescriptions();
    const id = useId();
    const [text, setText] = useState("");
    const [result, setResult] = useState<BulkResult | null>(null);

    const add = () => {
        const next = addTerms(terms, text);
        setResult(next);
        setText(next.rest.join("\n"));
        if (next.added) onTerms(next.terms);
    };

    return (
        <div>
            {/* How to write the lines: the hint after the field's name on a page that keeps descriptions
                out of sight (#614), opened by the pointer on the name or focus in the field. */}
            <label data-hint-row={hints || undefined}>
                <span className={styles.name} data-hint-host={hints || undefined}><span>{t("realtime.vocabulary_bulk")}</span>
                    {hints && <Hint text={t("realtime.vocabulary_bulk_help")} id={`${id}-help`} row />}</span>
                <textarea readOnly={disabled} value={text} rows={4} spellCheck={false}
                    aria-describedby={`${id}-help`} placeholder={t("realtime.vocabulary_bulk_placeholder")}
                    onChange={event => setText(event.target.value)} /></label>
            {!hints && <p id={`${id}-help`}>{t("realtime.vocabulary_bulk_help")}</p>}
            <div className={styles.actions}>
                <button type="button" disabled={disabled || !text.trim()} onClick={add}>{t("realtime.vocabulary_bulk_add")}</button>
                <button type="button" disabled={!terms.length} onClick={() => void copyToClipboard(termsText(terms))}>
                    {t(is_copied ? "realtime.vocabulary_copied" : "realtime.vocabulary_copy")}</button>
            </div>
            <div role="status">
                {result && <p>{t("realtime.vocabulary_bulk_added", { count: result.added })}</p>}
                {result && skippedText(t, result) && <p>{skippedText(t, result)}</p>}
                {result && result.rest.length > 0 && <p>{t("realtime.vocabulary_bulk_rest")}</p>}
            </div>
        </div>
    );
};
