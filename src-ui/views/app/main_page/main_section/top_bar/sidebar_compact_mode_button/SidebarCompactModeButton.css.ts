import { style } from "@vanilla-extract/css";

// The kit's icon Button (SidebarCompactModeButton.tsx) draws it; the bar does not shrink it.
export const container = style({ flexShrink: 0 });
export const reverse = style({});
export const arrow_left_svg = style({
    width: "1.2rem",
    height: "2rem",
    selectors: {
        [`&.${reverse}`]: { transform: "rotate(180deg)" },
    },
});
