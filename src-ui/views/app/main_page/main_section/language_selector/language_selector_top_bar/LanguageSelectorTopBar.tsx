import { useI18n } from "@useI18n";
import * as styles from "./LanguageSelectorTopBar.css.ts";
import { useStore_IsOpenedLanguageSelector } from "@store";
import { Button } from "../../../../../kit/index.ts";

export const LanguageSelectorTopBar = (props: { title?: string }) => {
    const { t } = useI18n();
    const { updateIsOpenedLanguageSelector } = useStore_IsOpenedLanguageSelector();
    const closeLanguageSelector = () => {
        updateIsOpenedLanguageSelector({
            your_language: false,
            target_language: false,
            target_key: "1"
        });
    };

    return (
        <div className={styles.container}>
            {/* The kit's plain button; the bar gives it only its place. */}
            <Button className={styles.go_back_button_wrapper} onClick={closeLanguageSelector}>{t("common.go_back_button_label")}</Button>
            <p className={styles.title}>{props.title}</p>
        </div>
    );
};