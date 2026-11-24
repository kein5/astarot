import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { loader as spinner, tooltipContent } from "../../../../../../common_css/mixins.ts";

export const is_clicked = style({});
export const is_pending = style({});

// A 4rem square framed button at rest (matching PageLinkButton and the forms' controls), so its
// left edge sits flush with the field column's start (#1096) instead of floating on bare padding.
export const button_wrapper = style({
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "4rem",
    height: "4rem",
    padding: 0,
    backgroundColor: vars.vox_surface,
    border: `0.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        '&:hover:not([aria-disabled="true"])': { backgroundColor: vars.dark_850_color },
        '&:active:not([aria-disabled="true"])': { backgroundColor: vars.dark_925_color },
        "&:focus-visible": { outline: `0.2rem solid ${vars.primary_200_color}`, outlineOffset: "0.2rem" },
        [`&.${is_clicked}`]: { cursor: "default" },
        '&[aria-busy="true"]': { cursor: "wait" },
    },
});

export const button_svg = style({
    width: "2rem",
    height: "2rem",
    color: vars.dark_400_color,
    selectors: {
        [`&.${is_clicked}`]: { color: vars.primary_300_color },
        [`&.${is_pending}`]: { visibility: "hidden" },
    },
});

export const loader = style(spinner({ size: "2rem", lineWidth: ".2rem", position: "left", positionAmount: "50%" }));

// The button's tooltip (action_label), the app's one tooltip look (tooltipContent):
// under the button, from its left edge outwards, since the button stands at the field column's start.
export const container = style({ position: "relative" });
export const tip = style({
    display: "none",
    position: "absolute",
    zIndex: 1500,
    top: "calc(100% + .4rem)",
    left: 0,
    ...tooltipContent,
    pointerEvents: "none",
    selectors: {
        [`${button_wrapper}:hover + &, ${button_wrapper}:focus-visible + &`]: { display: "block" },
    },
});
