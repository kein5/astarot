import { useState } from "react";
import type { ReactNode } from "react";
import styles from "./Tooltip.module.scss";
import clsx from "clsx";

export interface TooltipProps {
    title: ReactNode;
    children?: ReactNode;
    placement?: string;
    className?: string;
    // The popper's style in the shape MUI took it; only a margin below is read.
    slotProps?: { popper?: { sx?: unknown } };
}

export const Tooltip = ({ title, children, placement = "top", className, slotProps }: TooltipProps) => {
    const [isVisible, setIsVisible] = useState(false);

    let marginBottom = "0.8rem"; // Default offset
    try {
        if (slotProps?.popper?.sx) {
            // Crude extraction if they passed MUI style sx
            const sxStr = JSON.stringify(slotProps.popper.sx);
            if (sxStr.includes("marginBottom")) {
                marginBottom = "0.2em"; // Using what was hardcoded in project
            }
        }
    } catch {}

    return (
        // Named as shadcn/ui's Tooltip parts: the wrapper takes the pointer and the focus, so it is
        // the trigger; the bubble is the content.
        <div
            className={clsx(styles.tooltipWrapper, className)}
            data-slot="tooltip-trigger"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
            onFocus={() => setIsVisible(true)}
            onBlur={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div
                    data-slot="tooltip-content"
                    className={clsx(styles.tooltipBox, styles[`placement-${placement}`])}
                    style={{ "--margin-bottom": marginBottom }}
                >
                    {title}
                </div>
            )}
        </div>
    );
};
