import { fallbackVar, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The dictionary's file in and out (#792): the buttons on one row, wrapping in a narrow window,
// and what the last one did under them.
export const files = style({
    display: "grid",
    gap: ".8rem",
    minWidth: 0,
});

// What the last one did: a line each, wrapping where it reads well.
export const status = style({ textWrap: "pretty" });

export const actions = style({
    display: "flex",
    flexWrap: "wrap",
    gap: ".8rem",
});

export const problem = style({
    color: fallbackVar(vars.vox_state_warning, "#cb944f"),
});
