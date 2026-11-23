import { style } from "@vanilla-extract/css";
import type { StyleRule } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_disabled = style({});
export const is_busy = style({});

export const add_remove_target_language_container = style({
    width: "100%",
    display: "flex",
    justifyContent: "end",
    alignItems: "center",
    gap: ".2rem",
    padding: "0 .2rem",
});

// The remove and add buttons are drawn alike.
const button: StyleRule = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "0.6rem 1rem",
    // At least 24px to hit; the icons stay small.
    minWidth: "3.2rem",
    minHeight: "2.4rem",
    cursor: "pointer",
    backgroundColor: vars.dark_825_color,
    borderRadius: "0.4rem",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_875_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        [`&.${is_disabled}`]: { pointerEvents: "none" },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".1rem" },
        [`&.${is_busy}`]: { opacity: 0.55, cursor: "wait" },
    },
};

export const remove_target_language_button = style(button);
export const add_target_language_button = style(button);

const svg: StyleRule = {
    width: "0.8rem",
    color: vars.dark_200_color,
    selectors: {
        [`${remove_target_language_button}.${is_disabled} &, ${add_target_language_button}.${is_disabled} &`]: {
            color: vars.dark_700_color,
        },
    },
};

export const remove_svg = style(svg);
export const add_svg = style(svg);
