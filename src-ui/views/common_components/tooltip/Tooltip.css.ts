import { keyframes, style } from "@vanilla-extract/css";
import { tooltipContent } from "../../common_css/mixins.ts";

const fadeIn = keyframes({
    to: { opacity: 1 },
});

export const tooltipWrapper = style({
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
});

// The wrapper without a box: its control is laid out as the child of the wrapper's parent.
export const bare = style({
    display: "contents",
});

// Placed in the window by the component (left and top), at the end of the page.
export const tooltipBox = style({
    position: "fixed",
    zIndex: 1500,
    pointerEvents: "none",
    ...tooltipContent,
    opacity: 0,
    animation: `${fadeIn} 0.15s cubic-bezier(0.4, 0, 0.2, 1) forwards`,
    // A small delay.
    animationDelay: "0.1s",
    "@media": { "(prefers-reduced-motion: reduce)": { animation: "none", opacity: 1 } },
});
