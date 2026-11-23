import { useI18n } from "@useI18n";
import { splitDescription } from "../../../../../../../logics/configs/descriptionSplit";
import * as styles from "./Description.css.ts";
import { Fold } from "../fold/Fold";

// General description role (DESIGN.md): one visible sentence, the rest under "詳細".
// `id` lets a control point at it with aria-describedby; `fold={false}` keeps
// text that changes as you type (a character count) in view.
export interface DescriptionProps {
    text?: string | null;
    className?: string;
    id?: string;
    fold?: boolean;
}

export const Description = ({ text, className, id, fold = true }: DescriptionProps) => {
    const { t } = useI18n();
    const [first, rest] = fold ? splitDescription(text) : [text, ""];
    if (!rest) return <p id={id} className={className}>{first}</p>;
    return <div id={id} className={styles.description}>
        <p className={className}>{first}</p>
        <Fold size="link" className={styles.more} summary={t("voice_ui.details")}>
            <p className={className}>{rest}</p>
        </Fold>
    </div>;
};
