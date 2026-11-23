import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import clsx from "clsx";
import * as styles from "./ActionButton.css.ts";

export interface ActionButtonProps {
    IconComponent: ComponentType<SVGProps<SVGSVGElement>>;
    // Shown for clicked_duration ms after the action succeeds.
    ClickedIconComponent?: ComponentType<SVGProps<SVGSVGElement>>;
    clicked_duration?: number;
    // May return a promise: the button waits for it.
    onclickFunction?: () => unknown;
    onErrorFunction?: (error: unknown) => void;
    // The row's label: the button's name, unless action_label says what pressing does.
    label?: ReactNode;
    // What pressing does, where the row's label names the thing and not the action (an address
    // and its copy button, #614): the button's name, and its tooltip, which opens while the
    // pointer is on the button and while it has keyboard focus.
    action_label?: string;
    "aria-describedby"?: string;
}

export const ActionButton = ({
    IconComponent,
    ClickedIconComponent,
    clicked_duration = 1000,
    onclickFunction,
    onErrorFunction,
    label,
    action_label,
    "aria-describedby": describedBy,
}: ActionButtonProps) => {
    const [is_clicked, setIsClicked] = useState(false);
    const [is_pending, setIsPending] = useState(false);
    const running = useRef(false);
    const mounted = useRef(true);
    const timer_ref = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; clearTimeout(timer_ref.current); };
    }, []);

    const onClick = async () => {
        if (running.current) return;
        running.current = true;
        setIsPending(true);
        try {
            await onclickFunction?.();
            if (mounted.current && ClickedIconComponent) {
                setIsClicked(true);
                timer_ref.current = setTimeout(() => { running.current = false; setIsClicked(false); }, clicked_duration);
            } else {
                running.current = false;
            }
        } catch (error) {
            running.current = false;
            if (mounted.current) onErrorFunction?.(error);
        } finally {
            if (mounted.current) setIsPending(false);
        }
    };

    const ShownIcon = is_clicked && ClickedIconComponent ? ClickedIconComponent : IconComponent;
    const active_class = { [styles.is_clicked]: is_clicked };

    return (
        <div className={styles.container}>
            <button type="button" className={clsx(styles.button_wrapper, active_class)} onClick={onClick}
                aria-disabled={is_pending || is_clicked} aria-busy={is_pending}
                aria-describedby={describedBy}
                aria-label={action_label ?? (typeof label === "string" ? label : undefined)}>
                <ShownIcon className={clsx(styles.button_svg, active_class, { [styles.is_pending]: is_pending })} aria-hidden="true" />
                {is_pending && <span className={styles.loader} aria-hidden="true" />}
            </button>
            {/* The words are the button's name already, so the bubble is not read a second time. */}
            {action_label && <span role="tooltip" aria-hidden="true" data-slot="tooltip-content" className={styles.tip}>{action_label}</span>}
        </div>
    );
};

