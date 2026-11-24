import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_turned_on = style({});
export const reverse = style({});

// One language: its role as a small heading, then the language as the kit's
// button (LanguageSelectorOpenButton.tsx), which spans the rail.
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

// The language, then its country in the description color.
export const selected_language = style({
    minWidth: 0,
    overflowWrap: "anywhere",
    selectors: {
        "& + &": { color: vars.vox_secondary_text },
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

// The arrow points right while the list is closed and left while it is open.
export const arrow_left_svg = style({
    flexShrink: 0,
    width: "1.4rem",
    color: vars.dark_500_color,
    transform: "rotate(180deg)",
    selectors: {
        [`&.${reverse}`]: { transform: "none" },
    },
});
