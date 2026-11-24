import { useI18n } from "@useI18n";
import clsx from "clsx";
import * as styles from "./SidebarCompactModeButton.css.ts";
import { Button } from "../../../../../kit/index.ts";

import { useIsMainPageCompactMode } from "@logics_main";
import ArrowLeftSvg from "@images/arrow_left.svg?react";

export const SidebarCompactModeButton = () => {
    const { t } = useI18n();
    const { toggleIsMainPageCompactMode, currentIsMainPageCompactMode } = useIsMainPageCompactMode();

    const class_names = clsx(styles["arrow_left_svg"], {
        [styles["reverse"]]: currentIsMainPageCompactMode.data
    });

    // The kit's icon Button; the bar keeps it at its size (SidebarCompactModeButton.css.ts).
    return (
        <Button size="icon" data-sidebar-toggle="" aria-label={t("studio.toggle_sidebar")}
            aria-expanded={!currentIsMainPageCompactMode.data} className={styles.container} onClick={toggleIsMainPageCompactMode}>
            <ArrowLeftSvg className={class_names} preserveAspectRatio="none" aria-hidden="true" />
        </Button>
    );
};
