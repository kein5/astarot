import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../../theme/vars.css.ts";

export const open_webpage_button_wrapper = style({
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "fit-content",
});

export const open_webpage_button = style({
    padding: "0.6rem 1.2rem",
    display: "flex",
    gap: "1rem",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: "0.4rem",
    cursor: "pointer",
    flexShrink: 0,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_825_color },
        "&:active": { backgroundColor: vars.dark_900_color },
    },
});

// An external link looks like the other links in settings: blue and underlined (#476).
export const open_webpage_text = style({
    fontSize: "1.2rem",
    color: vars.primary_300_color,
    textDecoration: "underline",
    selectors: {
        [`${open_webpage_button}:hover &`]: { color: vars.primary_200_color },
    },
});

export const external_link_svg = style({
    color: vars.primary_300_color,
    width: "1.6rem",
    flexShrink: 0,
});
