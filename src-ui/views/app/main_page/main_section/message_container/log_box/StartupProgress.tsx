import { useI18n } from "@useI18n";
import { useStartupProgress, STARTUP_STEPS } from "../../../../../../logics/common/useStartupProgress";
import styles from "./LogBox.module.scss";

// The first screen's list while the engine starts: how far it has come and the
// models it fetches before it is ready, in the setup list's place and form.
// It is inside the inert page; StartupAnnouncer says the same to screen readers.
export const StartupProgress = () => {
    const { t } = useI18n();
    const { step, downloads } = useStartupProgress();
    return <ul className={styles.setup} aria-label={t("studio.startup_label")}>
        <li>
            <span>{t("studio.startup_status")}</span>
            {step > 0 && <span className={styles.progress}>{t("studio.startup_step", { step, total: STARTUP_STEPS })}</span>}
        </li>
        {downloads.map(({ kind, id, progress }) => <li key={`${kind}:${id}`}>
            <span>{t(`studio.startup_download_${kind}`, { id })}</span>
            <span className={styles.progress}>{t(progress === "pending" ? "studio.setup_preparing" : "studio.setup_downloading", { progress })}</span>
        </li>)}
    </ul>;
};
