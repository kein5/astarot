import { style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

export const reset_button = style({
    width: "fit-content",
    backgroundColor: vars.dark_875_color,
    padding: "0.6rem",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: "0.4rem",
    flexShrink: 0,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_825_color },
        "&:active": { backgroundColor: vars.dark_925_color },
    },
});

export const reset_svg = style({
    width: "1.4rem",
    color: vars.dark_550_color,
    selectors: {
        [`${reset_button}:hover &`]: { color: vars.dark_200_color },
    },
});
