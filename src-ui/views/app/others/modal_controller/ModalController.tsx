import type { RefObject } from "react";
import { useI18n } from "@useI18n";
import { useConsentDialog } from "../../../../logics/common/useConsentDialog";
import styles from "./ModalController.module.scss";
import { useStore_OpenedQuickSetting, useStore_IsOpenedDropdownMenu } from "@store";
import { Updater } from "@setting_box";

// A modal dialog for the update page, opened from the update button of the top bar (the subtitle
// overlay switches in place since #939, its settings on the captions and VR page). It closes with its button, Escape
// (unless a dropdown inside is open, which Escape closes first) or a click
// outside. Focus moves to the close button and back to the opener.
export const ModalController = ({ fallback }: { fallback?: RefObject<HTMLElement | null> | null }) => {
    const { t } = useI18n();
    const { currentOpenedQuickSetting, updateOpenedQuickSetting } = useStore_OpenedQuickSetting();
    const { currentIsOpenedDropdownMenu } = useStore_IsOpenedDropdownMenu();
    const opened = currentOpenedQuickSetting.data;
    const dropdownOpen = currentIsOpenedDropdownMenu.data !== "";
    const { dialog, close: closeDialog } = useConsentDialog(opened !== "", fallback);
    const close = () => {
        closeDialog();
        updateOpenedQuickSetting("");
    };

    if (opened === "") return null;
    const title = t("config_page.side_menu_labels.updater");
    return (
        <dialog ref={dialog} className={styles.container} aria-label={title}
            onKeyDownCapture={event => {
                // Let the dropdown's document listener handle Escape without
                // also triggering the native dialog's default cancel action.
                if (event.key === "Escape" && dropdownOpen) event.preventDefault();
            }}
            onCancel={event => { event.preventDefault(); if (!dropdownOpen) close(); }}>
            <div className={styles.bg_onclick_close_area} onClick={close}></div>
            <div className={styles.wrapper}>
                <button type="button" autoFocus className={styles.close_button} onClick={close}>
                    {t("common.close_button_label")}
                </button>
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
