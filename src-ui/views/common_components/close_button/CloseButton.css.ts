import { style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

export const close_button_wrapper = style({
    position: "absolute",
    top: 0,
    left: "100%",
    transform: "translate(-50%, -50%) rotate(45deg)",
    display: "flex",
    justifyContent: "center",
    alignItems: "end",
    aspectRatio: "1 / 1",
    transition: "background-color 0.1s ease",
});

export const size_large = style({
    width: "6.8rem",
});

export const size_small = style({
    width: "5.6rem",
});

export const variant_default = style({
    selectors: {
        "&:hover": { backgroundColor: vars.error_bc_color },
        "&:active": { backgroundColor: vars.error_bc_active_color },
    },
});

export const variant_active_error = style({
    backgroundColor: vars.error_bc_color,
    selectors: {
        "&:active": { backgroundColor: vars.error_bc_active_color },
    },
});

export const x_mark_svg = style({
    transform: "rotate(-45deg)",
    color: vars.dark_700_color,
    transition: "transform 0.12s ease-out",
    selectors: {
        [`${size_large} &`]: { width: "2.4rem" },
        [`${size_small} &`]: { width: "2rem" },
        [`${variant_default}:hover &`]: { color: vars.dark_200_color, transform: "rotate(45deg)" },
        [`${variant_active_error} &`]: { color: vars.dark_200_color },
        [`${variant_active_error}:hover &`]: { transform: "rotate(45deg)" },
    },
});
