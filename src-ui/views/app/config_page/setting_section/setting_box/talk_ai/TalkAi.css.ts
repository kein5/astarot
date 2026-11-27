import { fallbackVar, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The Talk AI page: its sections stacked as the other pages' are, spaced by their headings.
export const container = style({ display: "flex", flexDirection: "column" });

export const section = style({ display: "flex", flexDirection: "column", gap: "1.2rem", minWidth: 0 });

// The conversation's phase in words. The colour only repeats them (DESIGN.md "Roles in settings").
export const status = style({
    margin: 0,
    fontSize: "1.4rem",
    lineHeight: 1.5,
    color: fallbackVar(vars.dark_basic_text_color, "#edf3ff"),
    selectors: {
        "&[data-phase='connecting']": { color: fallbackVar(vars.vox_state_warning, "#e0b25c") },
        "&[data-phase='ready']": { color: fallbackVar(vars.vox_state_active, "#c9a8ff") },
        "&[data-phase='failed']": { color: fallbackVar(vars.vox_state_failed, "#f08a8a") },
    },
});

// A short line about what applies now, beside the controls it is about.
export const note = style({
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem 1.2rem",
    fontSize: "1.3rem",
    lineHeight: 1.5,
    color: fallbackVar(vars.vox_description_text, "#adbed6"),
});

// What a disabled button waits for, under it in the control column at the rows' right end (#1096).
export const reason = style({
    margin: 0,
    textAlign: "end",
    fontSize: "1.3rem",
    lineHeight: 1.5,
    color: fallbackVar(vars.vox_description_text, "#adbed6"),
});

export const problem = style({
    margin: 0,
    fontSize: "1.3rem",
    lineHeight: 1.5,
    color: fallbackVar(vars.vox_state_failed, "#f08a8a"),
});

// The consent's own checkbox in a dialog (a native input, D-16).
export const check = style({
    display: "flex",
    alignItems: "flex-start",
    gap: ".8rem",
    fontSize: "1.3rem",
    lineHeight: 1.5,
});
