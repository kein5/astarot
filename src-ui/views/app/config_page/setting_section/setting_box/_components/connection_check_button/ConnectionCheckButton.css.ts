import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const container = style({
    flexShrink: 0,
});

// The same secondary button as the other settings forms (VoiceSettings).
export const button = style({
    fontSize: "1.4rem",
    fontWeight: 500,
    minHeight: "3.6rem",
    padding: ".6rem 1.2rem",
    color: vars.dark_200_color,
    background: vars.dark_850_color,
    border: ".1rem solid transparent",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:hover:enabled": { background: vars.dark_600_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
        "&:disabled": { opacity: .5, cursor: "default" },
    },
});
