import { useI18n } from "@useI18n";
import { useWindow } from "@logics_common";
import { closeButtonLabelKey, useCloseHides } from "../../../../logics/common/closeBehavior.ts";
// import clsx from "clsx";
import * as styles from "./WindowTitleBar.css.ts";
import XMarkSvg from "@images/cancel.svg?react";
import SquareSvg from "@images/square.svg?react";
import LineSvg from "@images/line.svg?react";
import { Tooltip } from "../../../common_components/tooltip/Tooltip";

export const WindowTitleBar = () => {
    const { t } = useI18n();
    const { asyncCloseApp, asyncToggleMaximizeApp, asyncMinimizeApp} = useWindow();
    // Closing keeps the app in the tray only where a tray icon is shown; elsewhere it quits.
    // The three buttons are icons: each name is also its tooltip, so what closing does here
    // (quit, or stay in the tray) is seen before the button is pressed.
    const closeLabel = t(closeButtonLabelKey(useCloseHides()));

    return (
        <div className={styles.container}>
            <div className={styles.wrapper} data-tauri-drag-region>
                <div className={styles.title_wrapper}>
                    <span>ASTAROT</span>
                </div>

                <div className={styles.window_control_wrapper}>
                    <Tooltip bare placement="bottom" title={t("studio.minimize")}>
                        <button type="button" aria-label={t("studio.minimize")} className={styles.minimize_button} onClick={asyncMinimizeApp}>
                            <LineSvg aria-hidden="true" className={styles.line_svg}/>
                        </button>
                    </Tooltip>
                    <Tooltip bare placement="bottom" title={t("studio.maximize")}>
                        <button type="button" aria-label={t("studio.maximize")} className={styles.maximize_button} onClick={asyncToggleMaximizeApp}>
                            <SquareSvg aria-hidden="true" className={styles.square_svg}/>
                        </button>
                    </Tooltip>
                    <Tooltip bare placement="bottom" title={closeLabel}>
                        <button type="button" aria-label={closeLabel} className={styles.close_button} onClick={asyncCloseApp}>
                            <XMarkSvg aria-hidden="true" className={styles.x_mark_svg}/>
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
};
