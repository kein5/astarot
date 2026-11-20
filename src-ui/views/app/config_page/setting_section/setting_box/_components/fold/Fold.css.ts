import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// The app's one fold (Fold.tsx), in two sizes.
// - bar: a part of a page (a setup fold, 「詳細設定」, a list, a form). Closed, it is a raised bar
//   with a hairline all round, the title and its readout at the start and "Open" with a chevron at
//   the end; the whole bar opens it. Open, the bar stays at the head of what it holds, which follows
//   at the page's own indent, so its rows keep the page's field column.
// - link: a few more words (「詳細」 of a description, a model's guidance, a raw record). A quiet
//   line with a chevron after it.
// The chevron turns as the fold opens, and keeps still with reduced motion.

const hairline = `.1rem solid ${fallbackVar(vars.dark_800_color, "#344662")}`;
const motion = `${fallbackVar(vars.vox_motion_fast, "120ms")} ${fallbackVar(vars.vox_ease, "ease-out")}`;

export const fold = style({ minWidth: 0 });
export const bar = style({});
export const link = style({});

export const summary = style({
    cursor: "pointer",
    listStyle: "none",
    selectors: {
        // The browser's own triangle gives way to the chevron.
        "&::-webkit-details-marker": { display: "none" },
        "&::marker": { content: '""' },
    },
});

// The settings page gives every summary its own padding and weight: each size keeps its own, by
// the fold and the summary together.
globalStyle(`${bar} > ${summary}`, {
    display: "flex",
    alignItems: "center",
    gap: ".8rem 1.2rem",
    padding: "1.2rem 1.6rem",
    fontWeight: 400,
    background: fallbackVar(vars.vox_surface, "#332341"),
    border: hairline,
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
    transition: `background-color ${motion}`,
});
globalStyle(`${bar} > ${summary}:hover`, { background: fallbackVar(vars.vox_secondary_hover, "#3a2a4a") });
globalStyle(`${bar} > ${summary}:focus-visible`, {
    outline: `.2rem solid ${fallbackVar(vars.primary_200_color, "#d5c2fb")}`,
    outlineOffset: ".2rem",
});
globalStyle(`${link} > ${summary}`, {
    display: "inline-flex",
    alignItems: "center",
    gap: ".4rem",
    width: "fit-content",
    padding: ".2rem 0",
    fontSize: "1.2rem",
    fontWeight: 500,
    color: fallbackVar(vars.vox_secondary_text, "#c3cde0"),
});
globalStyle(`${link} > ${summary}:hover`, { color: fallbackVar(vars.dark_200_color, "#e0e8f6") });
globalStyle(`${link} > ${summary}:focus-visible`, {
    outline: `.2rem solid ${fallbackVar(vars.primary_200_color, "#d5c2fb")}`,
    outlineOffset: ".2rem",
    borderRadius: ".4rem",
});
// Focus from a press is not shown; keyboard focus is.
globalStyle(`${fold} > ${summary}:focus:not(:focus-visible)`, { outline: "none" });

// What the bar names and reads out (a title, its readout or counts), wrapping before the toggle does.
export const summaryText = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".6rem 1.2rem",
    flex: "1 1 auto",
    minWidth: 0,
    textWrap: "pretty",
    // A bar's words are its title, as a setup fold's are; a readout beside it sets its own.
    fontSize: "1.5rem",
    fontWeight: 600,
    color: fallbackVar(vars.dark_200_color, "#e0e8f6"),
});

// What pressing does: words on a bar, the chevron on both sizes. The words of the other state are
// put away by the fold's own state, so nothing is kept in sync by hand.
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
    transition: `transform ${motion}`,
    "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
globalStyle(`${link} ${chevron}`, { width: "1.3rem", height: "1.3rem" });
globalStyle(`${fold}[open] > ${summary} ${openWord}, ${fold}:not([open]) > ${summary} ${closeWord}`, { display: "none" });
globalStyle(`${fold}[open] > ${summary} ${chevron}`, { transform: "rotate(180deg)" });
globalStyle(`${bar} > ${summary}`, { "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } } });

// What the fold holds.
export const body = style({ display: "grid", minWidth: 0 });
globalStyle(`${bar} > ${body}`, { gap: "1.6rem", paddingTop: "1.2rem" });
globalStyle(`${link} > ${body}`, { gap: ".4rem", paddingTop: ".4rem" });
