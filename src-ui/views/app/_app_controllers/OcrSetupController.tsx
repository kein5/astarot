import { useEffect } from "react";
import { useI18n } from "@useI18n";
import { useStore_IsOpenedConfigPage, useStore_SelectedConfigTabId } from "@store";
import { useOcrSetup, focusOcrModels } from "../../../logics/ocr/useOcrSetup";
import { useConsentDialog } from "../../../logics/common/useConsentDialog";
import * as styles from "../config_page/setting_section/setting_box/advanced_settings/VoiceSettings.css.ts";
import * as dialogStyles from "../config_page/setting_section/setting_box/_components/download_models/LegacyModelDownloadDialog.css.ts";
import { Button, Dialog, DialogFooter, DialogHeader, DialogTitle } from "../../kit/index.ts";

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
    // Named by its title, without a description, as before the kit (D-23, D-43).
    return <div className={`${styles.container} ${dialogStyles.host}`}>
        <Dialog ref={dialog} open={open} onOpenChange={cancel} aria-describedby={undefined}>
            <DialogHeader>
                <DialogTitle>{t("ocr_setup.title")}</DialogTitle>
                <p>{t("ocr_setup.body")}</p>
                <p>{t("ocr_setup.next")}</p>
            </DialogHeader>
            <DialogFooter>
                <Button autoFocus onClick={cancel}>{t("ocr_setup.close")}</Button>
                <Button tone="primary" onClick={review}>{t("ocr_setup.review")}</Button>
            </DialogFooter>
        </Dialog>
    </div>;
};
