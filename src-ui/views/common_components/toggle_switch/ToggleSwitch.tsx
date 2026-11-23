import type { CSSProperties, MouseEvent } from "react";
import clsx from "clsx";
import * as styles from "./ToggleSwitch.css.ts";

export interface ToggleSwitchProps {
    isActive?: boolean;
    isPending?: boolean;
    width?: string;
    height?: string;
    style?: CSSProperties;
    toggleFunction?: () => void;
    showLoader?: boolean;
    className?: string;
    skeleton?: boolean;
}

export const ToggleSwitch = ({
    isActive = false,
    isPending = false,
    width,
    height,
    style,
    toggleFunction,
    showLoader = false,
    className,
    skeleton = false,
}: ToggleSwitchProps) => {
    const containerClasses = clsx(
        styles.toggle_switch_container,
        {
            [styles.is_active]: isActive,
            [styles.is_pending]: isPending,
        },
        className
    );

    const controlClasses = clsx(styles.control, {
        [styles.is_active]: isActive,
        [styles.is_pending]: isPending,
    });

    const customStyles: CSSProperties = {
        ...(width ? { "--toggle_width": width } : {}),
        ...(height ? { "--toggle_height": height } : {}),
        ...style,
    };

    const handleClick = (e: MouseEvent<HTMLDivElement>) => {
        if (toggleFunction) {
            e.stopPropagation();
            toggleFunction();
        }
    };

    return (
        <div className={containerClasses} style={customStyles} onClick={handleClick} data-skeleton={skeleton ? "" : undefined}>
            <span className={controlClasses}></span>
            {showLoader && isPending && (
                <span className={styles.loader}></span>
            )}
        </div>
    );
};
