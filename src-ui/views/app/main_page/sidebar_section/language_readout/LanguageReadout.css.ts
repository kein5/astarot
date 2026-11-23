import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

// The selected language pair in the 72px icon rail: two short names, one above the other.
// Thin margins: the 72px rail, less its scrollbar, leaves about 60px for a
// name, which holds 「Japanese」 at 12px.
export const container = style({
    width: "calc(100% - .4rem)",
    margin: ".4rem .2rem .8rem",
    padding: ".8rem 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: ".3rem",
    borderRadius: vars.vox_radius,
    color: vars.vox_secondary_text,
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_875_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
    },
});

// A long name ends in an ellipsis; the tooltip and the accessible name have it whole.
export const name = style({
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "1.2rem",
    lineHeight: 1.4,
});

export const arrow = style({
    width: "1rem",
    height: "1rem",
    flexShrink: 0,
    fill: "currentColor",
    color: vars.dark_500_color,
});

export const more = style({ fontSize: "1.2rem", fontVariantNumeric: "tabular-nums", color: vars.vox_description_text });
