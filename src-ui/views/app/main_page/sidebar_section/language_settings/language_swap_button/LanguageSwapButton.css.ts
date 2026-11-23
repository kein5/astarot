import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const reverse = style({});

export const container = style({
    width: "100%",
    display: "flex",
    justifyContent: "center",
});

// Drawn as a button at rest (#569): the raised surface and hairline of the other plain buttons,
// sized to its words and centred between the two language fields, so it does not read as a
// third field. The arrows stay beside the words when a long label takes two lines. 2.4rem is the
// smallest target size (WCAG 2.5.8) and keeps one target language and the translator in the
// rail at 1280×720 with every switch shown.
export const swap_button_wrapper = style({
    display: "flex",
    alignItems: "center",
    gap: ".6rem",
    maxWidth: "calc(100% - 2rem)",
    minHeight: "2.4rem",
    padding: ".3rem 1rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    color: vars.dark_300_color,
    cursor: "pointer",
    selectors: {
        "&:hover": {
            backgroundColor: vars.dark_800_color,
            color: vars.dark_200_color,
        },
        "&:active": { backgroundColor: vars.dark_850_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".1rem" },
        '&[aria-disabled="true"]': { opacity: 0.55, cursor: "wait" },
    },
});

export const narrow_arrow_down_svg = style({
    width: "1.4rem",
    flexShrink: 0,
    color: "currentColor",
    selectors: {
        [`&.${reverse}`]: { transform: "rotate(180deg)" },
    },
});

export const label = style({
    minWidth: 0,
    textAlign: "center",
    fontSize: "1.2rem",
    lineHeight: 1.3,
});
