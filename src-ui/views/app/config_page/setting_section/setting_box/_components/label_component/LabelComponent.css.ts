import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const label_component = style({
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    // A wide control (slider, radio group) must not squeeze the label down to
    // one or two characters per line.
    minWidth: "min(16rem, 100%)",
    maxWidth: "38rem",
    overflowWrap: "anywhere",
});

// Item label role: 1.4rem / 500. Long Japanese labels wrap instead of pushing the control out.
export const label = style({
    fontSize: "1.4rem",
    fontWeight: 500,
    lineHeight: 1.5,
    color: vars.dark_200_color,
    textWrap: "pretty",
});

// The label and its hint mark on one line (#614); the bubble opens under it.
export const label_line = style({
    display: "flex",
    alignItems: "center",
    minWidth: 0,
});

// General description role: 1.2rem / 400 in the description color (6.4:1 on the canvas).
export const desc = style({
    fontSize: "1.2rem",
    fontWeight: 400,
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
    textWrap: "pretty",
});

// A state, not a description: in the label's color.
export const note = style({
    fontSize: "1.2rem",
    fontWeight: 500,
    lineHeight: 1.6,
    color: vars.dark_200_color,
    overflowWrap: "anywhere",
    textWrap: "pretty",
});

export const warnings_section = style({
    fontWeight: 300,
    color: vars.dark_500_color,
});

export const warning_item = style({
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
});

export const warning_label = style({
    fontSize: "1.2rem",
    color: vars.warning_color,
    overflowWrap: "anywhere",
});

export const warning_svg = style({
    width: "1.4rem",
    color: vars.warning_color,
    flexShrink: 0,
});
