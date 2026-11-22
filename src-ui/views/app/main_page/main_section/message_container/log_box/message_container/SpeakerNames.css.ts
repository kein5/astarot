import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// Who spoke a caption of the game audio, and the form that names the voices (#447). Sizes are in
// em: the log's own font size setting scales the whole row.

// The speakers as a button: drawn as a small button at rest (the raised surface and a hairline),
// in the received colour, so it reads as something to press without a hover.
export const who = style({
    font: "inherit",
    fontSize: "1em",
    lineHeight: 1.3,
    padding: "0 .45em",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    color: vars.received_300_color,
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_875_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.vox_focus}`, outlineOffset: ".1rem" },
    },
});

// Read by screen readers on a row that goes on with the voices of the row before it.
export const hidden = style({
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: 0,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
});

export const form = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "end",
    gap: ".6em .8em",
    marginTop: ".4em",
    padding: ".6em .8em",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    maxWidth: "100%",
});

export const field = style({
    display: "flex",
    flexDirection: "column",
    gap: ".2em",
    minWidth: 0,
    fontSize: "1em",
    color: vars.vox_secondary_text,
});

export const input = style({
    font: "inherit",
    width: "14em",
    maxWidth: "100%",
    padding: ".3em .5em",
    border: `.1rem solid ${vars.dark_600_color}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_canvas,
    color: vars.dark_basic_text_color,
    selectors: {
        "&:focus-visible": { outline: `.2rem solid ${vars.vox_focus}`, outlineOffset: ".1rem" },
    },
});

export const actions = style({
    display: "flex",
    gap: ".6em",
});

const button = {
    font: "inherit",
    fontWeight: 500,
    padding: ".3em .9em",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:focus-visible": { outline: `.2rem solid ${vars.vox_focus}`, outlineOffset: ".1rem" },
    },
} as const;

// The step the form exists for: lilac, with Dark Plum text on it (DESIGN.md, Colors).
export const save = style({
    ...button,
    border: `.1rem solid ${vars.primary_600_color}`,
    backgroundColor: vars.primary_600_color,
    color: vars.vox_on_primary,
    selectors: {
        ...button.selectors,
        "&:hover": { backgroundColor: vars.primary_550_color },
        "&:active": { backgroundColor: vars.primary_700_color },
    },
});

export const cancel = style({
    ...button,
    border: `.1rem solid ${vars.vox_border}`,
    backgroundColor: "transparent",
    color: vars.dark_basic_text_color,
    selectors: {
        ...button.selectors,
        "&:hover": { backgroundColor: vars.dark_800_color },
    },
});

export const hint = style({
    flexBasis: "100%",
    margin: 0,
    fontSize: ".9em",
    color: vars.vox_description_text,
});
