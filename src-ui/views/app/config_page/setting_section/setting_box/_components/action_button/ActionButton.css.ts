import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { loader as spinner, tooltipContent } from "../../../../../../common_css/mixins.ts";

export const is_clicked = style({});
export const is_pending = style({});

export const button_wrapper = style({
    position: "relative",
    padding: "2rem",
    borderRadius: "0.4rem",
    selectors: {
        '&:hover:not([aria-disabled="true"])': { backgroundColor: vars.dark_825_color },
        '&:active:not([aria-disabled="true"])': { backgroundColor: vars.dark_900_color },
        [`&.${is_clicked}`]: { cursor: "default" },
        '&[aria-busy="true"]': { cursor: "wait" },
    },
});

export const button_svg = style({
    width: "2.4rem",
    color: vars.dark_400_color,
    selectors: {
        [`&.${is_clicked}`]: { color: vars.primary_300_color },
        [`&.${is_pending}`]: { visibility: "hidden" },
    },
});

export const loader = style(spinner({ size: "2rem", lineWidth: ".2rem", position: "left", positionAmount: "50%" }));

// The button's tooltip (action_label), the app's one tooltip look (tooltipContent):
// under the button, from its right edge inwards, since the button stands at the row's end.
export const container = style({ position: "relative" });
export const tip = style({
    display: "none",
    position: "absolute",
    zIndex: 1500,
    top: "calc(100% + .4rem)",
    right: 0,
    ...tooltipContent,
    pointerEvents: "none",
    selectors: {
        [`${button_wrapper}:hover + &, ${button_wrapper}:focus-visible + &`]: { display: "block" },
    },
});
