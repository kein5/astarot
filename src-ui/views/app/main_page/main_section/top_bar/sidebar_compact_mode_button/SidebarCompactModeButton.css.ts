import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    height: "4rem",
    width: "3.2rem",
    flexShrink: 0,
    borderRadius: ".8rem",
    color: vars.dark_400_color,
    cursor: "pointer",
    selectors: {
        "&:hover": { background: vars.dark_850_color },
        "&:disabled": { display: "none" },
    },
});
export const reverse = style({});
export const arrow_left_svg = style({
    width: "1.2rem",
    height: "2rem",
    selectors: {
        [`&.${reverse}`]: { transform: "rotate(180deg)" },
    },
});
