import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The dictionary's terms (#792): a fold under the switch of the built-in terms, drawn as one of the
// app's raised parts with a hairline all round. Closed, it is a single bar that says how many terms
// are in use and how many the user added, changed or took out, so the state is read without
// opening; the whole bar opens it. Open, the bar heads the list, a hairline under it.
export const fold = style({
    minWidth: 0,
    border: `.1rem solid ${fallbackVar(vars.dark_800_color, "#344662")}`,
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
    // The bar's corners follow the fold's.
    overflow: "clip",
});

export const summary = style({
    display: "flex",
    alignItems: "center",
    gap: ".8rem 1.2rem",
    padding: "1.2rem 1.6rem",
    background: fallbackVar(vars.vox_surface, "#332341"),
    cursor: "pointer",
    listStyle: "none",
    transition: `background-color ${fallbackVar(vars.vox_motion_fast, "120ms")} ${fallbackVar(vars.vox_ease, "ease-out")}`,
    selectors: {
        // The browser's own triangle gives way to the chevron at the bar's end.
        "&::-webkit-details-marker": { display: "none" },
        "&::marker": { content: '""' },
        "&:hover": { background: fallbackVar(vars.vox_secondary_hover, "#3a2a4a") },
        "&:focus-visible": { outline: `.2rem solid ${fallbackVar(vars.primary_200_color, "#d5c2fb")}`, outlineOffset: "-.2rem" },
    },
    "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});

// The title and the counts, wrapping before the toggle's words do.
export const summaryText = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".6rem 1rem",
    flex: "1 1 auto",
    minWidth: 0,
});

export const title = style({
    fontSize: "1.5rem",
    fontWeight: 600,
    color: fallbackVar(vars.dark_200_color, "#e0e8f6"),
});

// What the bar does, in words and a chevron that turns as the fold opens. The words of the other
// state are put away by the fold's own state, so nothing is kept in sync by hand.
export const toggle = style({
    display: "inline-flex",
    alignItems: "center",
    gap: ".6rem",
    flex: "none",
    fontSize: "1.3rem",
    fontWeight: 500,
    color: fallbackVar(vars.vox_secondary_text, "#c3cde0"),
});

export const openWord = style({});
export const closeWord = style({});
export const chevron = style({
    width: "1.6rem",
    height: "1.6rem",
    // A line, not a filled shape, whatever the page's icons are filled with.
    fill: "none",
    transition: `transform ${fallbackVar(vars.vox_motion_fast, "120ms")} ${fallbackVar(vars.vox_ease, "ease-out")}`,
    "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});

globalStyle(`${fold}[open] ${openWord}, ${fold}:not([open]) ${closeWord}`, { display: "none" });
globalStyle(`${fold}[open] ${chevron}`, { transform: "rotate(180deg)" });
globalStyle(`${fold}[open] > ${summary}`, { borderBottom: `.1rem solid ${fallbackVar(vars.dark_800_color, "#344662")}` });
// The settings page gives every summary its own padding and weight; the bar keeps its own.
globalStyle(`${fold} > ${summary}`, { padding: "1.2rem 1.6rem", fontWeight: 400 });
// Focus from a press is not shown; keyboard focus is (above).
globalStyle(`${fold} > ${summary}:focus:not(:focus-visible)`, { outline: "none" });

// The list under the bar.
export const body = style({
    display: "grid",
    gap: "1.2rem",
    padding: "1.2rem 1.6rem 1.6rem",
    minWidth: 0,
});

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
