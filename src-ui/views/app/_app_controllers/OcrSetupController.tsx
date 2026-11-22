import { useEffect } from "react";
import { useI18n } from "@useI18n";
import { useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useOcrSetup, focusOcrModels } from "../../../logics/ocr/useOcrSetup";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.module.scss";
import dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.module.scss";

// Turning chat reading on without its models used to end in a notice that named a
// settings path and vanished. This says what is missing where the user is and
// takes them to the models section, whose review asks for consent before anything
// is downloaded. Chat reading stays off; the user turns it on again afterwards.
export const OcrSetupController = () => {
    const { t } = useI18n();
    const { open, setOpen } = useOcrSetup();
    const { updateIsOpenedConfigPage } = useStore_IsOpenedConfigPage();
    const { updateSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { dialog, close } = useConsentDialog(open);

    useEffect(() => () => setOpen(false), [setOpen]);
    if (!open) return null;
    const cancel = () => { close(); setOpen(false); };
    const review = () => {
        cancel();
        updateSelectedConfigTabId("ocr");
        updateIsOpenedConfigPage(true);
        focusOcrModels();
    };
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <dialog ref={dialog} className={dialogStyles.dialog} aria-label={t("ocr_setup.title")}
            onCancel={event => { event.preventDefault(); cancel(); }}>
            <div className={styles.dialog_text}>
                <h3>{t("ocr_setup.title")}</h3>
                <p>{t("ocr_setup.body")}</p>
                <p>{t("ocr_setup.next")}</p>
            </div>
            <div className={styles.actions}>
                <button type="button" autoFocus onClick={cancel}>{t("ocr_setup.close")}</button>
                <button type="button" className="primary" onClick={review}>{t("ocr_setup.review")}</button>
            </div>
        </dialog>
    </div>;
};
