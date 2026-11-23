import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_turned_on = style({});
export const reverse = style({});

// One language: its role as a small heading, then the language as a field-like
// button. About 5.6rem a block, so a preset with three target languages still
// leaves the translator in sight at common window sizes.
export const container = style({
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    padding: ".2rem",
    gap: "0.3rem",
});

export const title_container = style({
    display: "flex",
    alignItems: "center",
    gap: ".4rem",
    minHeight: "1.8rem",
});

// Shown while the side it labels is on (the mic for yours, the speaker for theirs).
export const category_svg = style({
    width: "1.4rem",
    flexShrink: 0,
    color: vars.vox_state_active,
    display: "none",
    selectors: {
        [`&.${is_turned_on}`]: { display: "block" },
    },
});

export const title = style({
    fontSize: "1.2rem",
    color: vars.vox_secondary_text,
});

export const dropdown_menu_container = style({
    position: "relative",
    border: `.1rem solid ${vars.dark_775_color}`,
    color: "inherit",
    font: "inherit",
    backgroundColor: vars.vox_surface,
    width: "100%",
    minHeight: "3.2rem",
    padding: ".4rem 2.4rem .4rem .8rem",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: ".4rem",
    textAlign: "left",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_850_color },
        "&:active": { backgroundColor: vars.dark_900_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".1rem" },
        '&[aria-expanded="true"]': { borderColor: vars.primary_300_color },
    },
});

// The language, then its country; the country wraps under it when the rail is too narrow.
export const selected_language = style({
    maxWidth: "100%",
    overflowWrap: "anywhere",
    fontSize: "1.3rem",
    lineHeight: 1.4,
    selectors: {
        "& + &": {
            fontSize: "1.2rem",
            color: vars.vox_secondary_text,
        },
    },
});

// The field's description: read with it, shown as its tooltip.
export const visually_hidden = style({
    position: "absolute",
    width: ".1rem",
    height: ".1rem",
    margin: "-.1rem",
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
});

export const arrow_left_svg = style({
    position: "absolute",
    top: "50%",
    right: ".6rem",
    width: "1.4rem",
    color: vars.dark_500_color,
    transform: "translateY(-50%) rotate(180deg)",
    selectors: {
        [`&.${reverse}`]: { transform: "translateY(-50%)" },
    },
});
