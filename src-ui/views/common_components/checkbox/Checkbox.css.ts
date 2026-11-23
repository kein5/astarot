import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";
import { loader as spinner } from "../../common_css/mixins.ts";

// The checked colour a setting may give its box; the settings' Lilac otherwise.
const CHECKED = `var(--checkbox-color, ${vars.primary_600_color})`;
const BORDER_WIDTH = "var(--checkbox-border-width, 0.2rem)";
const SIZE = "var(--checkbox-size, 2.8rem)";

export const checkbox_container = style({
    height: "100%",
    display: "flex",
    justifyContent: "end",
    alignItems: "center",
});

export const is_pending = style({});
export const is_disabled = style({});
export const has_label = style({});

export const checkbox_wrapper = style({
    display: "inline-block",
    cursor: "pointer",
    padding: "var(--checkbox-padding, 2rem)",
    // The box ends where the row's fields end; the target keeps its padding on the other sides (#474).
    paddingInlineEnd: 0,
    position: "relative",
    selectors: {
        [`&.${is_pending}`]: { pointerEvents: "none" },
        [`&.${is_disabled}`]: { pointerEvents: "none" },
        // A checkbox with its label beside it: the label is part of the target.
        [`&.${has_label}`]: {
            display: "inline-flex",
            alignItems: "center",
            gap: "0.8rem",
        },
    },
});

export const text = style({
    fontSize: "1.4rem",
    color: vars.dark_500_color,
    whiteSpace: "nowrap",
});

const input = `${checkbox_wrapper} input[type="checkbox"]`;

export const cbx = style({
    selectors: {
        [`${checkbox_wrapper}:hover &`]: {
            border: `${CHECKED} solid ${BORDER_WIDTH}`,
        },
        [`${checkbox_wrapper}.${is_pending} &`]: {
            borderColor: vars.primary_800_color,
        },
        [`${checkbox_wrapper}.${is_disabled} &`]: {
            filter: "grayscale(100%)",
            borderColor: vars.dark_800_color,
        },
        [`${checkbox_wrapper} &`]: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: SIZE,
            height: SIZE,
            borderRadius: "0.4rem",
            border: `${vars.dark_700_color} solid ${BORDER_WIDTH}`,
            transition: "background-color 0.12s ease, border-color 0.12s ease",
            padding: `calc(${SIZE} / 7)`,
        },
        [`${input}:focus-visible + &`]: {
            outline: `0.2rem solid ${vars.primary_200_color}`,
            outlineOffset: "0.3rem",
        },
        [`${input}:checked + &`]: {
            backgroundColor: CHECKED,
            borderColor: CHECKED,
        },
    },
});

globalStyle(`${checkbox_wrapper} ${cbx} svg`, {
    display: "block",
    width: "100%",
    height: "100%",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    // The check sits on the Lilac fill, so it is Dark Plum, as text on Lilac is (DESIGN.md
    // "Colors": 5.4:1, where white is 3.1:1) and as shadcn/ui's primary-foreground check is.
    stroke: vars.vox_on_primary,
    strokeWidth: "1.4",
    strokeDasharray: "1",
    strokeDashoffset: "1",
});

// Hidden visually but still in the tab order, so the setting works from the
// keyboard; the drawn box shows its state and focus.
globalStyle(input, {
    position: "absolute",
    opacity: 0,
    width: "1px",
    height: "1px",
    margin: 0,
});

globalStyle(`${input}:checked + ${cbx} svg`, {
    strokeDashoffset: "0",
    transition: "stroke-dashoffset 0.12s ease",
});

export const loader = style(spinner({ size: "2rem", lineWidth: "0.2rem", position: "right", positionAmount: "-2rem" }));
