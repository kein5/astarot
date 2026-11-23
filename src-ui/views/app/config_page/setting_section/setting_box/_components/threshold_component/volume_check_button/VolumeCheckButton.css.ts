import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../../theme/vars.css.ts";

export const is_active = style({});
export const is_pending = style({});

export const button = style({
    width: "100%",
    backgroundColor: vars.dark_800_color,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "0.8rem 1rem",
    borderRadius: "0.4rem",
    gap: "0.4rem",
    cursor: "pointer",
    // In the SCSS order: the states first, then the plain hover and press.
    selectors: {
        [`&.${is_active}`]: { backgroundColor: vars.primary_500_color },
        [`&.${is_active}:hover`]: { backgroundColor: vars.primary_450_color },
        [`&.${is_active}:active`]: { backgroundColor: vars.primary_550_color },
        [`&.${is_pending}`]: { backgroundColor: vars.dark_850_color, pointerEvents: "none" },
        "&:hover": { backgroundColor: vars.dark_775_color },
        "&:active": { backgroundColor: vars.dark_850_color },
    },
});

export const button_svg = style({
    width: "1.4rem",
    color: vars.dark_350_color,
});

export const button_text = style({
    fontSize: "1.2rem",
});

globalStyle(`${button}.${is_active} ${button_svg}, ${button}.${is_active} ${button_text}`, { color: vars.vox_on_primary });
globalStyle(`${button}.${is_pending} ${button_svg}, ${button}.${is_pending} ${button_text}`, { color: vars.dark_500_color });
