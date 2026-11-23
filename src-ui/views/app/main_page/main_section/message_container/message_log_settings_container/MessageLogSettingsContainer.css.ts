import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

const CONTAINER_HEIGHT = "18rem";
const TOGGLE_CONFIG_SIZE = "3rem";

export const to_visible_toggle_bar = style({});
export const is_hovered = style({});
export const is_opened = style({});

// The panel hangs above the log and slides down into it. In a very low window it is no taller
// than the log (#563): the offsets are fractions of its own height, so the same strip shows
// while it is closed, and its settings scroll inside it instead of being cut off.
export const container = style({
    position: "absolute",
    top: 0,
    left: 0,
    height: CONTAINER_HEIGHT,
    maxHeight: "100%",
    width: "100%",
    backgroundColor: vars.dark_825_color,
    transform: `translateY(calc(-100% - ${TOGGLE_CONFIG_SIZE}))`,
    transition: "transform 0.12s ease-out",
    padding: "0.6rem",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    selectors: {
        [`&.${to_visible_toggle_bar}`]: { transform: "translateY(calc(-100% + 1rem))" },
        [`&.${is_hovered}`]: { transform: "translateY(calc(-100% + 2rem))" },
        [`&.${is_opened}`]: {
            transform: "none",
            backgroundColor: vars.dark_825_color_cc,
            backdropFilter: "blur(0.6rem)",
        },
        [`&:not(.${is_opened})`]: { cursor: "pointer" },
    },
});

export const container_relative_wrapper = style({
    position: "absolute",
    width: "100%",
    height: "100%",
});

export const config_svg_wrapper = style({
    position: "absolute",
    left: "50%",
    bottom: `-${TOGGLE_CONFIG_SIZE}`,
    transform: "translate(-50%, -50%) rotate(0deg)",
    backgroundColor: vars.dark_825_color,
    width: TOGGLE_CONFIG_SIZE,
    borderRadius: "50%",
    aspectRatio: "1 / 1",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    transition: "width 0.12s ease-out, bottom 0.12s ease-out, transform 0.12s ease-out",
    selectors: {
        [`${container}.${to_visible_toggle_bar} &`]: { transform: "translate(-50%, -50%) rotate(180deg)" },
        [`${container}.${is_opened} &`]: { width: "0%", bottom: 0 },
    },
});

export const config_svg = style({
    // The toggle's size / 1.6.
    width: "1.875rem",
    color: vars.dark_500_color,
});

// Hidden things leave the tab order. In a panel lower than its settings, they scroll.
export const settings = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    minHeight: 0,
    overflowY: "auto",
    visibility: "hidden",
    selectors: {
        '&[data-opened="true"]': { visibility: "visible" },
    },
});

export const others_wrapper = style({
    width: "100%",
    display: "flex",
});

export const resend_checkbox_toggle = style({
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "0.6rem 1.2rem",
    gap: "1rem",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_850_color },
    },
});

export const resend_checkbox_label = style({
    fontSize: "1.4rem",
});
