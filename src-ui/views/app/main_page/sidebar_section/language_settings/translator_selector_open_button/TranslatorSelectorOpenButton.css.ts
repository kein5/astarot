import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const is_opened = style({});

// The same block as a language above it (LanguageSelectorOpenButton): a small heading, then the
// engine as the kit's button (TranslatorSelectorOpenButton.tsx), which spans the rail.
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

// The engine's name wraps inside the button; it is never cut.
export const label = style({
    minWidth: 0,
    overflowWrap: "anywhere",
});

export const warning_svg = style({
    flexShrink: 0,
    width: "1.6rem",
    color: vars.warning_color,
});

// The arrow points right while the list is closed, toward where it opens beside the rail, and
// left while it is open.
export const arrow_svg = style({
    flexShrink: 0,
    width: "1.4rem",
    color: vars.dark_500_color,
    transform: "rotate(180deg)",
    selectors: {
        [`&.${is_opened}`]: { transform: "none" },
    },
});
