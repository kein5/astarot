import type { RefObject } from "react";
import { useI18n } from "@useI18n";
import { useConsentDialog } from "../../../../logics/common/useConsentDialog";
import * as styles from "./ModalController.css.ts";
import { useStore_OpenedQuickSetting } from "@store";
import { Updater } from "@setting_box";
import { Button, useAppear } from "../../../kit/index.ts";

// A modal dialog for the update page, opened from the update button of the top bar (the subtitle
// overlay switches in place since #939, its settings on the captions and VR page). It closes with its button, Escape
// or a click outside. Focus moves to the close button and back to the opener. Its frame and its pale
// backdrop stay its own (decision 2 of #764); its close button is the kit's plain Button at the
// panel's top right (decided on 2026-11-25). Shown, it comes in as the kit's dialogs do (#1378).
export const ModalController = ({ fallback }: { fallback?: RefObject<HTMLElement | null> | null }) => {
    const { t } = useI18n();
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const opened = currentOpenedQuickSetting.data;
    const { dialog, close: closeDialog } = useConsentDialog(opened !== "", fallback);
    useAppear(dialog, opened !== "", "dialog");
    const close = () => {
        closeDialog();
        updateOpenedQuickSetting("");
    };

    if (opened === "") return null;
    const title = t("config_page.side_menu_labels.updater");
    return (
        <dialog ref={dialog} className={styles.container} aria-label={title}
            onCancel={event => { event.preventDefault(); close(); }}>
            <div className={styles.bg_onclick_close_area} onClick={close}></div>
            <div className={styles.wrapper}>
                <div className={styles.close_row}>
                    <Button autoFocus onClick={close}>{t("common.close_button_label")}</Button>
                </div>
                <QuickSettingsController />
            </div>
        </dialog>
    );
};

const QuickSettingsController = () => {
    const { currentOpenedQuickSetting } = useStore_OpenedQuickSetting();

    switch (currentOpenedQuickSetting.data) {
        case "update_software":
            return <Updater />;
        default:
            return null;
    }
};
