import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The dictionary's terms (#792): a bar of the app's one fold (_components/fold/Fold.css.ts) under
// the switch of the built-in terms. The bar says how many terms are in use.

// A new term: its written form, its readings and the button, on one line while they fit.
export const add = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: ".8rem 1.2rem",
});

export const addField = style({
    display: "grid",
    gap: ".4rem",
    flex: "1 1 16rem",
    minWidth: 0,
});

// Each field's name above it, not beside it as the settings page lays out its other labels: the
// two fields and the button make one line of their own.
globalStyle(`${add} ${addField}`, {
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: ".4rem",
});

export const rows = style({
    display: "grid",
    gap: ".4rem",
    margin: 0,
    padding: 0,
    listStyle: "none",
    containerType: "inline-size",
});

// One term a row: the written form, its readings, its state and what can be done, in columns so
// the states and the buttons are read down one edge.
export const row = style({
    display: "grid",
    gridTemplateColumns: "minmax(8rem, 14rem) minmax(0, 1fr) auto",
    alignItems: "center",
    gap: ".4rem 1.2rem",
    padding: ".2rem .8rem",
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
    // A term the user took out stays in its place, quiet, so it can be put back.
    selectors: {
        "&[data-state='removed']": { color: fallbackVar(vars.dark_500_color, "#9daec6") },
        "&[data-state='changed']": { background: fallbackVar(vars.vox_surface, "#1b2333") },
    },
    "@container": {
        // A narrow content (a narrow window): the readings go under the written form, and the
        // buttons stay at the row's end, beside both.
        "(max-width: 52rem)": { gridTemplateColumns: "minmax(0, 1fr) auto", rowGap: 0 },
    },
});

export const written = style({
    minWidth: 0,
    overflowWrap: "anywhere",
    fontWeight: 600,
    selectors: { [`${row}[data-state='removed'] &`]: { textDecoration: "line-through", fontWeight: 400 } },
});

export const readings = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".4rem .8rem",
    minWidth: 0,
    overflowWrap: "anywhere",
    "@container": {
        "(max-width: 52rem)": { gridColumn: 1, gridRow: 2 },
    },
});

export const actions = style({
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: ".6rem",
    "@container": {
        "(max-width: 52rem)": { gridColumn: 2, gridRow: "1 / span 2" },
    },
});

// Fifty rows of actions: smaller than the page's buttons, so the list stays a list. The row and
// the actions together outweigh the settings page's own button rule.
globalStyle(`${row} ${actions} button`, {
    minHeight: "3.2rem",
    padding: ".3rem 1rem",
    fontSize: "1.3rem",
});

// The readings being changed: the field and its two buttons, the reason under them.
export const edit = style({
    display: "grid",
    gap: ".4rem",
    minWidth: 0,
    // The buttons are put away while the readings are changed: the field takes their room too.
    gridColumn: "2 / -1",
    "@container": {
        "(max-width: 52rem)": { gridColumn: "1 / -1", gridRow: 2 },
    },
});

export const editLine = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".6rem",
});

// A term without a reading: said in words, quieter than the readings of the others.
export const none = style({
    color: fallbackVar(vars.vox_description_text, "#9daec6"),
});

export const problem = style({
    color: fallbackVar(vars.vox_state_warning, "#cb944f"),
});
