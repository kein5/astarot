import { useI18n } from "@useI18n";
import * as styles from "./Topbar.css.ts";
import { useIsOpenedConfigPage } from "@logics_common";
import { useStore_SelectedConfigTabId } from "@store";
import { StopActions } from "../../others/stop_actions/StopActions";
import ArrowLeftSvg from "@images/arrow_left.svg?react";
import { Button } from "../../../kit/index.ts";
import { isSettingsWindow } from "../../../../logics/common/settingsWindow.ts";
import clsx from "clsx";

// Every setting saves by itself (#1111): each settings page says so where the save bar was, so
// how its changes are kept is known before anything is changed. About sets nothing and says nothing.
export const AppliesNow = () => {
    const { t } = useI18n();
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    if (currentSelectedConfigTabId.data === "about_vrct") return null;
    return <p className={styles.applies_now}>{t("voice_ui.applies_now")}</p>;
};

export const Topbar = () => {
    const { t } = useI18n();
    const { setIsOpenedConfigPage } = useIsOpenedConfigPage();
    // The settings window (#1236) has no "Go back": the main window is beside it, and its title
    // bar's close button closes it (decided on 2026-11-26).
    const settingsWindow = isSettingsWindow();
    return <div className={styles.container}>
        <StopActions classes={styles} />
        {/* The words keep their slot on every page, so the stop actions stay put. */}
        <div className={clsx(styles.save_slot, { [styles.save_slot_last]: settingsWindow })}><AppliesNow /></div>
        {/* The kit's plain button; in a narrow window only its arrow is left. */}
        {!settingsWindow && (
            <Button className={styles.back} data-settings-back="" aria-label={t("common.go_back_button_label")} onClick={() => setIsOpenedConfigPage(false)}>
                <ArrowLeftSvg aria-hidden="true" />
                <span className={styles.back_label} aria-hidden="true">{t("common.go_back_button_label")}</span>
            </Button>
        )}
    </div>;
};
