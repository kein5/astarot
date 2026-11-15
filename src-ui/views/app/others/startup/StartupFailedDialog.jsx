import { useI18n } from "@useI18n";
import { useWindow } from "@logics_common";
import { useBackendStartup } from "../../../../logics/common/useBackendStartup";
import styles from "./StartupFailedDialog.module.scss";

// Shown over the locked main page when the engine could not start. It says
// why (the program never ran, or it ended before it was ready) and what to do.
//
// It is not modal: a modal dialog would block the title bar drawn in this page,
// and the error notices stay readable beside it. The page behind it is already
// inert, so the dialog's two buttons are the only things that take focus.
// "Try starting again" turns the phase back to "starting", which removes the
// dialog; another failure brings it back with the new reason.
export const StartupFailedDialog = () => {
    const { t } = useI18n();
    const { failure, retryStartup } = useBackendStartup();
    const { asyncCloseApp } = useWindow();

    const reason = failure?.kind === "exit"
        ? t("common_error.backend_startup_reason_exit", { code: failure.code ?? "?" })
        : t("common_error.backend_startup_reason_spawn");
    const detail = failure?.kind === "spawn" && failure.message
        ? t("common_error.backend_startup_detail", { message: failure.message })
        : null;

    return (
        <dialog open className={styles.dialog} role="alertdialog"
            aria-labelledby="startup_failed_title" aria-describedby="startup_failed_reason startup_failed_next">
            <h2 id="startup_failed_title" className={styles.title}>{t("common_error.backend_startup_title")}</h2>
            <p id="startup_failed_reason">{reason}</p>
            {detail && <p className={styles.detail}>{detail}</p>}
            <p id="startup_failed_next">{t("common_error.backend_startup_next")}</p>
            <div className={styles.actions}>
                <button type="button" className={styles.retry} autoFocus onClick={retryStartup}>
                    {t("common_error.backend_startup_retry")}
                </button>
                <button type="button" className={styles.quit} onClick={asyncCloseApp}>
                    {t("common_error.backend_startup_quit")}
                </button>
            </div>
        </dialog>
    );
};
