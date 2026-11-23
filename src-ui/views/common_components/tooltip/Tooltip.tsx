import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import * as styles from "./Tooltip.css.ts";
import clsx from "clsx";
import { placeTooltip, wordsInSight } from "./tooltipPlacement.ts";
import type { TooltipSide } from "./tooltipPlacement.ts";

// The app's tooltip for a control (DESIGN.md "Principles": it opens on mouse-over and on keyboard
// focus). The bubble is drawn at the end of the page, placed in the window from the control's
// box, so a scrolling or clipping parent (the rail, the top bar, the log) cuts nothing of it and
// it takes no room in the layout.
//
// It is a picture of words the control already carries for screen readers: its name, or a
// description the control points at with aria-describedby (a node that stays in the page). The
// bubble itself is aria-hidden, so nothing is read twice.
//
// It does not reach inside a modal <dialog>, which is drawn over the page: the settings' Hint is
// for those.
export interface TooltipProps {
    // The words. Without them only the children are drawn.
    title: ReactNode;
    children?: ReactNode;
    // The side of the control the bubble opens on when it fits there (tooltipPlacement.ts).
    placement?: TooltipSide;
    className?: string;
    // bare: the wrapper makes no box (display: contents), so the control stays the child of its
    // parent's layout exactly as it was without a tooltip.
    bare?: boolean;
    // beside: a selector of an ancestor of the control. The bubble then opens beside that ancestor,
    // level with the control: a small button in a row of the rail shows its tooltip beside the
    // rail, not over the row's own words.
    beside?: string;
    // The popper's style in the shape MUI took it; only a margin below is read.
    slotProps?: { popper?: { sx?: unknown } };
}

// The space between the control and the bubble, in rem.
const GAP = .8, CLOSE_GAP = .24, EDGE = .8;

// Keyboard focus, not the focus a click leaves behind: a pressed button does not keep its
// tooltip open over what it opened. Where the browser cannot say, the focus counts.
const keyboardFocus = (target: unknown) => typeof Element === "undefined" || !(target instanceof Element) || target.matches(":focus-visible");

export const Tooltip = ({ title, children, placement = "top", className, bare = false, beside, slotProps }: TooltipProps) => {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [place, setPlace] = useState<CSSProperties | null>(null);
    const wrapper = useRef<HTMLSpanElement>(null), bubble = useRef<HTMLDivElement>(null);
    const has_words = title !== undefined && title !== null && title !== false && title !== "";
    const open = has_words && (hovered || focused);
    // The MUI offset the resend button passes brings its bubble closer.
    const gap = slotProps?.popper?.sx && JSON.stringify(slotProps.popper.sx).includes("marginBottom") ? CLOSE_GAP : GAP;

    const close = () => { setHovered(false); setFocused(false); };
    // The control is the wrapper's first element; a wrapper with a box of its own hugs it.
    const control = () => wrapper.current?.firstElementChild ?? wrapper.current;
    // Words the control shows already are not repeated in a bubble.
    const repeats = () => { const target = control(); return typeof title === "string" && !!target && wordsInSight(target, title); };

    useLayoutEffect(() => {
        if (!open) { setPlace(null); return; }
        const target = control(), box = bubble.current;
        if (!target || !box) return;
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
        const own = target.getBoundingClientRect(), frame = beside ? target.closest(beside)?.getBoundingClientRect() : undefined;
        const anchor = frame ? { left: frame.left, width: frame.width, top: own.top, height: own.height } : own;
        const { left, top } = placeTooltip(anchor, box.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight }, placement, gap * rem, EDGE * rem);
        setPlace({ left, top });
        // The bubble does not follow a control that moves: it closes.
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        return () => {
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
        };
    }, [open, title, placement, gap, beside]);

    if (!has_words) return <>{children}</>;
    const content = open && (
        <div ref={bubble} role="tooltip" aria-hidden="true" data-slot="tooltip-content" className={styles.tooltipBox}
            style={place ?? { left: 0, top: 0, visibility: "hidden" }}>
            {title}
        </div>
    );
    const page = globalThis.document?.body;
    return (
        // Named as shadcn/ui's Tooltip parts: the wrapper takes the pointer and the focus, so it is
        // the trigger; the bubble is the content.
        <span
            ref={wrapper}
            className={clsx(styles.tooltipWrapper, { [styles.bare]: bare }, className)}
            data-slot="tooltip-trigger"
            onMouseEnter={() => { if (!repeats()) setHovered(true); }}
            onMouseLeave={() => setHovered(false)}
            onFocus={(event: FocusEvent) => { if (keyboardFocus(event.target) && !repeats()) setFocused(true); }}
            onBlur={() => setFocused(false)}
            // A press or a key that acts puts the bubble away, so it never covers what the control opens.
            onPointerDown={close}
            onKeyDown={(event: KeyboardEvent) => { if (event.key === "Escape" || event.key === "Enter" || event.key === " ") close(); }}
        >
            {children}
            {content && (page ? createPortal(content, page) : content)}
        </span>
    );
};
