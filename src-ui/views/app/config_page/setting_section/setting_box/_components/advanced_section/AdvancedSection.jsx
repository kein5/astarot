import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import styles from "../setup_section/SetupSection.module.scss";

// The settings a page keeps for later (#554, the "応用" depth): changed once for a way of
// using the app, then left alone. They come after the page's own settings and its
// 「モデルとサーバー」, folded under 「詳細設定」 the way that fold is drawn, so the page has
// no new kind of part. The line beside the title shows the values in use, so a changed value
// is seen without opening the fold. Native <details>: the settings search opens it on its way
// to a setting inside, and SettingSection marks the line while a row inside has unsaved edits.
// attention: something inside is in use and should be seen, such as the translation API a
// language preset uses. The fold opens by itself then, and can still be closed.
export const AdvancedSection = ({ status, attention = false, children }) => {
    const { t } = useI18n();
    const [opened, setOpened] = useState(attention);
    useEffect(() => { if (attention) setOpened(true); }, [attention]);
    return <details data-advanced className={styles.setup} open={opened}
        onToggle={event => setOpened(event.currentTarget.open)}>
        <summary><span className={styles.title}>{t("config_page.common.advanced_section")}</span>{status && <span className={styles.status}>{status}</span>}</summary>
        <div className={styles.body}>{children}</div>
    </details>;
};
