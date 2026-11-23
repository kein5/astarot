import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_opened = style({});

// The same block as a language above it (LanguageSelectorOpenButton): a small
// heading, then a field-like button. Its arrow points down because the engine
// list opens under it, inside the rail.
export const container = style({
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    padding: ".3rem .2rem",
    gap: "0.3rem",
});

export const title = style({
    minHeight: "1.8rem",
    display: "flex",
    alignItems: "center",
    fontSize: "1.2rem",
    color: vars.vox_secondary_text,
});

export const translator_selector_button = style({
    position: "relative",
    width: "100%",
    minHeight: "3.2rem",
    display: "flex",
    alignItems: "center",
    gap: ".4rem",
    padding: ".4rem 2.4rem .4rem .8rem",
    border: `.1rem solid ${vars.dark_775_color}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    textAlign: "left",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_850_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".1rem" },
        '&[aria-expanded="true"]': { borderColor: vars.primary_300_color },
    },
});

// The engine's name wraps inside the field; it is never cut.
export const label = style({
    minWidth: 0,
    fontSize: "1.3rem",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
});

export const warning_svg = style({
    flexShrink: 0,
    width: "1.6rem",
    color: vars.warning_color,
});

export const arrow_svg = style({
    position: "absolute",
    top: "50%",
    right: ".6rem",
    width: "1.4rem",
    color: vars.dark_500_color,
    transform: "translateY(-50%) rotate(-90deg)",
    selectors: {
        [`&.${is_opened}`]: { transform: "translateY(-50%) rotate(90deg)" },
    },
});
