import { useI18n } from "@useI18n";
import { store } from "@store";
import { useSettingValue } from "@logics_configs";
import { useSetupNeeds } from "../../../../../../logics/main/useSetupNeeds";
import { downloadProgress } from "../../../../../../logics/main/setupNeeds";
import { useStartupPlaceholder } from "../../../startupContext";
import styles from "./LogBox.module.scss";

// The first screen of a session. It says where to type and, in the main window,
// what the selected engines still need, each with the step that provides it: the
// download review, or the settings where the local speech recognition models are set.
// While the engine starts, the main page's startup list (StartupProgress) takes
// its place: how far the start has come and which models it is fetching.
// The greeting sits in the middle row and the list in the row below it, so the list
// changing at startup never moves the greeting (LogBox.module.scss).
export const EmptyState = () => {
    const { t } = useI18n();
    const startup = useStartupPlaceholder();
    return <div className={styles.empty}>
        <div className={styles.greeting}>
            <h1>{t("studio.empty_title")}</h1>
            <p>{t("studio.empty_description")}</p>
        </div>
        {!store.is_vr_panel && <div className={styles.next}>{startup ?? <Setup />}</div>}
    </div>;
};

const Setup = () => {
    const { t } = useI18n();
    const { needs, start } = useSetupNeeds();
    const sends = useSettingValue("EnableSendMessageToVrc");
    return <>
        {needs.length > 0 && <ul className={styles.setup} aria-label={t("studio.setup_label")}>
            {needs.map(({ id, weight, action }) => {
                const progress = downloadProgress(weight);
                // "choose": the translation model cannot be downloaded yet, so another translator is offered.
                return <li key={id}>
                    <span>{t(action === "choose" ? "studio.setup_translation_unavailable" : `studio.setup_${id}`)}</span>
                    {progress === null
                        ? <button type="button" onClick={() => start(id)}>
                            {t(action === "settings" ? "studio.setup_open_settings"
                                : action === "choose" ? "studio.setup_other_translator" : "model_downloads.review")}</button>
                        : <span role="status">{t(progress === "pending" ? "studio.setup_preparing" : "studio.setup_downloading", { progress })}</span>}
                </li>;
            })}
        </ul>}
        {sends?.data === true && <p className={styles.hint}>{t("studio.empty_vrchat_hint")}</p>}
    </>;
};
