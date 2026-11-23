import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { loader as spinner } from "../../../../../../common_css/mixins.ts";

export const is_pending = style({});

export const container = style({
    display: "flex",
    width: "100%",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "1rem",
    position: "relative",
});

export const delete_button = style({
    padding: "0.4rem",
    fontSize: "1.4rem",
    flexShrink: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: "0.2rem",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_850_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        "&:disabled": { cursor: "default" },
        "&:disabled:hover": { backgroundColor: "transparent" },
        [`&.${is_pending}`]: { pointerEvents: "none" },
    },
});

export const delete_svg = style({
    width: "2.2rem",
    color: vars.error_bc_color,
    selectors: {
        [`${delete_button}:disabled &`]: { color: vars.dark_700_color },
        [`${delete_button}.${is_pending} &`]: { color: vars.dark_600_color },
    },
});

export const loader = style(spinner({ size: "2rem", lineWidth: "0.2rem", position: "left", positionAmount: "-2.2rem" }));
