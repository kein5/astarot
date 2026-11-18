import type { MouseEventHandler } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import XMarkSvg from "@images/cancel.svg?react";
import styles from "./CloseButton.module.scss";

export interface CloseButtonProps {
    onClick?: MouseEventHandler<HTMLButtonElement>;
    size?: string;
    variant?: string;
    className?: string;
    "aria-label"?: string;
}

export const CloseButton = ({ onClick, size = "large", variant = "default", className, "aria-label": ariaLabel }: CloseButtonProps) => {
    const { t } = useI18n();
    return (
        <button
            type="button"
            aria-label={ariaLabel ?? t("common.close_button_label")}
            className={clsx(
                styles.close_button_wrapper,
                styles[`size_${size}`],
                styles[`variant_${variant}`],
                className
            )}
            onClick={onClick}
        >
            <div className={styles.close_button}>
                <XMarkSvg className={styles.x_mark_svg} aria-hidden="true" focusable="false" />
            </div>
        </button>
    );
};
