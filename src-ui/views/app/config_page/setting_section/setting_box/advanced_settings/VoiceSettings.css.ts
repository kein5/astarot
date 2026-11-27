import { globalStyle, style } from "@vanilla-extract/css";
import type { CSSProperties } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";
import { leavesKit } from "./formSelectors.ts";

// The forms' look. Most of it styles plain elements inside a form section (.container) and relies
// on the order of rules of the same weight, as a stylesheet does: the classes are declared first
// and the rules follow in the order the SCSS module had them (#957).
export const container = style({});
export const fields = style({});
export const group = style({});
// A part of the text-to-speech page under its subheading (#1266 ★17): the speech.cpp models on this
// PC, or the external servers and engines; laid out as the forms' sections are.
export const part = style({});
export const quiet = style({});
export const more = style({});
export const problem_slot = style({});
export const checkLabel = style({});
export const fieldCheck = style({});
export const dialog_files = style({});
export const actions = style({});
export const count = style({});
export const hinted = style({});
export const control_column = style({});
export const download_entry = style({});
export const catalog_group = style({});
export const catalog_advice = style({});
export const catalog = style({});
export const card_key = style({});
export const card_head = style({});
export const catalog_head = style({});
export const section_head = style({});
export const status = style({});
export const card_badges = style({});
export const warning_mark = style({});
export const hardware_warning = style({});
export const restriction = style({});
export const restriction_text = style({});
export const facts = style({});
export const variant = style({});
export const variant_choice = style({});
export const link_button = style({});
export const hardware = style({});

// A rule inside a form section: each selector of the list under .container, leaving the kit's
// parts alone (formSelectors.ts).
const inForm = (...selectors: string[]) => selectors.map(selector => `${container} ${leavesKit(selector)}`).join(", ");
const BASE_SELECT = "(appearance: base-select)";
// The value that lets the engine style a select's list. csstype does not list it yet, so the word
// is read as a string and given the property's type.
const baseSelect: string = "base-select";
const BASE_SELECT_APPEARANCE = baseSelect as CSSProperties["appearance"];
const STACKED = "(max-width: 35.6rem)";
const NARROW_WINDOW = "(max-width: 700px)";

globalStyle(container, {
    display: "grid",
    gap: "1.6rem",
    padding: "2rem 0",
    minWidth: 0,
    containerType: "inline-size",
    overflowWrap: "anywhere",
    // The gap above, for the settings group's ground to start under the heading (SettingSection.css.ts).
    vars: { "--settings_section_gap": "1.6rem" },
});
globalStyle(`${container}:has(> [data-section-label]:first-child)`, { paddingTop: 0 });
globalStyle(container, {
    color: "var(--dark_200_color, #e5e7eb)",
    borderBottom: ".1rem solid var(--settings_rule, var(--vox_border, #34363b))",
});
globalStyle(inForm("form", "fieldset"), { display: "grid", gap: "1.2rem", minWidth: 0, containerType: "inline-size" });
// A part keeps the page's gap between what it holds (#1266).
globalStyle(inForm(`div.${part}`), { display: "grid", gap: "1.6rem", minWidth: 0 });
globalStyle(inForm("fieldset"), { border: ".1rem solid var(--vox_border, #344662)", borderRadius: "var(--vox_radius, .8rem)", padding: "1.6rem" });
globalStyle(inForm(`fieldset.${fields}`), { border: 0, padding: 0, margin: 0 });
// A group inside a section: space and a subheading, no frame. Frames stay for real units (one server).
globalStyle(inForm(`fieldset.${group}`), { border: 0, padding: 0, margin: "1.2rem 0 0" });
// Subheading role (DESIGN.md): 1.5rem / 600, secondary text, 24px above and 8px below.
globalStyle(inForm("legend", "h3", "h4"), { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.4, color: vars.vox_secondary_text, textWrap: "balance" });
globalStyle(inForm("legend"), { padding: "0 .4rem", maxWidth: "100%" });
globalStyle(inForm(`fieldset.${group} > legend`), { padding: 0, marginBottom: ".8rem" });
// Direct section children sit in a 16px grid gap: +8 above and -8 below give 24/8.
globalStyle(`${container} > h3, ${container} > h4`, { margin: ".8rem 0 -.8rem" });
globalStyle(inForm("h3", "h4"), { marginTop: ".8rem" });
// Item label role: 1.4rem / 500; the control inside keeps the regular weight. 16rem label + 18rem
// control + 1.6rem gap, measured inside each form/fieldset; and the documented narrow-window layout.
globalStyle(inForm("label"), {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
    gap: "1.6rem",
    alignItems: "center",
    padding: ".4rem 0",
    fontSize: "1.4rem",
    fontWeight: 500,
    minWidth: 0,
    "@container": { [STACKED]: { gridTemplateColumns: "minmax(0, 1fr)", gap: ".8rem" } },
    "@media": { [NARROW_WINDOW]: { gridTemplateColumns: "minmax(0, 1fr)", gap: ".8rem" } },
});
globalStyle(inForm("input", "select", "button"), {
    boxSizing: "border-box",
    font: "inherit",
    fontWeight: 400,
    minHeight: "4rem",
    padding: ".9rem 1.2rem",
    color: "inherit",
    borderRadius: "var(--vox_radius, .8rem)",
});
globalStyle(inForm("input", "select"), {
    width: "100%",
    minWidth: 0,
    background: "var(--vox_surface, #18253b)",
    border: ".1rem solid var(--vox_field_border, #5e6570)",
});
globalStyle(inForm("select option"), { color: "var(--dark_200_color, #e5e7eb)", background: "var(--vox_surface, #18253b)" });
// The reset removes the native arrow; without one a select reads as a text field. The arrow is
// the kit Select's (shadcn/ui's NativeSelect): a 1.6rem chevron 1.4rem from the right edge.
// Where the engine can style a select's list (WebView2), the list drops from the field and
// settles like the shared dropdown, with the same rows. Elsewhere (WebKitGTK) the system list stays.
globalStyle(inForm("select"), {
    width: "fit-content",
    minWidth: "min(20rem, 100%)",
    maxWidth: "min(32rem, 100%)",
    justifySelf: "end",
    overflow: "hidden",
    textOverflow: "ellipsis",
    paddingRight: "3.6rem",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4.25 6 8l4-3.75' fill='none' stroke='%239daec6' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 1.4rem center",
    backgroundSize: "1.6rem",
    cursor: "pointer",
});
// The kit's Select in a form keeps the width of the form's own selects (DESIGN.md "Field widths",
// #1096): its wrapper, which the kit's field fills, is compact and flush at the row's right end.
// Only the wrapper's place and width are set here; the field and its open list are the kit's.
globalStyle(`${container} [data-slot="native-select-wrapper"]`, {
    width: "fit-content",
    minWidth: "min(20rem, 100%)",
    maxWidth: "min(32rem, 100%)",
    justifySelf: "end",
});
globalStyle(inForm("select", "select::picker(select)"), { "@supports": { [BASE_SELECT]: { appearance: BASE_SELECT_APPEARANCE } } });
globalStyle(inForm("select"), { "@supports": { [BASE_SELECT]: { display: "flex", alignItems: "center" } } });
// The field keeps its own arrow (the background above).
globalStyle(inForm("select::picker-icon"), { "@supports": { [BASE_SELECT]: { display: "none" } } });
globalStyle(inForm("select::picker(select)"), {
    "@supports": {
        [BASE_SELECT]: {
            marginBlock: ".4rem",
            padding: ".4rem",
            border: `.1rem solid ${vars.dark_600_color}`,
            borderRadius: vars.vox_radius,
            background: vars.vox_surface,
            color: vars.dark_200_color,
            boxShadow: vars.vox_shadow_overlay,
            transformOrigin: "top",
            // Below the field when it fits, as the system list opens (Chromium's default picks the roomier side).
            positionTryOrder: "normal",
        },
    },
});
globalStyle(inForm("select:open::picker(select)"), {
    "@supports": { [BASE_SELECT]: { transition: `opacity ${vars.vox_motion_fast} ${vars.vox_ease}, transform ${vars.vox_motion} ${vars.vox_ease_settle}` } },
});
globalStyle(inForm("option"), { "@supports": { [BASE_SELECT]: { minHeight: 0, padding: ".8rem 1.2rem", borderRadius: ".4rem" } } });
globalStyle(inForm("option:hover", "option:focus-visible"), { "@supports": { [BASE_SELECT]: { background: vars.dark_800_color, outline: "none" } } });
globalStyle(inForm("option:checked"), { "@supports": { [BASE_SELECT]: { color: vars.primary_200_color, fontWeight: 600 } } });
globalStyle(inForm("option::checkmark"), { "@supports": { [BASE_SELECT]: { display: "none" } } });
globalStyle(inForm("input::placeholder"), { color: vars.vox_description_text, opacity: 1 });
globalStyle(inForm("button"), {
    width: "fit-content",
    maxWidth: "100%",
    whiteSpace: "normal",
    cursor: "pointer",
    background: "var(--dark_850_color, #25364f)",
    border: ".1rem solid transparent",
    fontWeight: 500,
});
globalStyle(inForm("button:hover:enabled"), { background: vars.vox_secondary_hover });
// The forms mark their primary action with the plain class name "primary" (className="primary"),
// so it is matched globally; a module class would be renamed and never match.
globalStyle(inForm("button.primary"), { background: "var(--primary_600_color, #a47af5)", color: "var(--vox_on_primary, #261633)" });
globalStyle(inForm("button.primary:hover:enabled"), { background: "var(--primary_550_color, #b897f7)" });
// A secondary action beside a primary one: an outline, not a filled button. With no fill, its
// border is its only edge, so it is the field border (DESIGN.md "Colors": 3:1 on every ground).
globalStyle(inForm(`button.${quiet}`), { background: "transparent", borderColor: vars.vox_field_border });
globalStyle(inForm(`button.${quiet}:hover:enabled`), { background: vars.dark_850_color });
globalStyle(inForm("button:active:enabled"), { background: vars.dark_925_color });
globalStyle(inForm("button.primary:active:enabled"), { background: vars.primary_800_color });
globalStyle(inForm(":focus-visible"), { outline: ".2rem solid var(--primary_200_color, #80cbc4)", outlineOffset: ".3rem" });
// A control that cannot be used is half as strong, as in shadcn/ui (disabled:opacity-50).
globalStyle(inForm(":disabled"), { opacity: .5, cursor: "not-allowed" });
// General description role: 1.2rem / 400 in the description color. Spans the form column (which
// SettingSection already bounds) and prefers phrase-aware Japanese wrapping where supported (#1112).
globalStyle(inForm("p"), { fontSize: "1.2rem", lineHeight: 1.6, color: vars.vox_description_text, overflowWrap: "anywhere", wordBreak: "auto-phrase", textWrap: "pretty" });
// Links read as links (the same blue as the translation page's), not as the description around them.
globalStyle(inForm("a"), { color: vars.primary_300_color, textDecoration: "underline" });
globalStyle(inForm("a:hover"), { color: vars.primary_200_color });
globalStyle(inForm("summary"), { cursor: "pointer", padding: ".8rem 0", fontWeight: 600 });
globalStyle(inForm(`details.${more}`), { color: "var(--dark_400_color, #adbed6)" });
globalStyle(inForm('[role="alert"]'), {
    border: `.1rem solid ${vars.warning_color}`,
    borderRadius: vars.vox_radius,
    padding: ".8rem 1.2rem",
    overflowWrap: "anywhere",
    fontSize: "1.3rem",
    color: vars.dark_200_color,
});
// Under a form's button, the line kept for its problem: one line of the problem's frame (its
// text, padding and border), so nothing moves when the problem appears (#912).
globalStyle(inForm(`.${problem_slot}`), { minHeight: "calc(1.3rem * 1.6 + 1.8rem)" });
globalStyle(inForm(`label.${checkLabel}`), { display: "flex", alignItems: "flex-start", gap: "1.2rem", cursor: "pointer" });
globalStyle(inForm('input[type="checkbox"]'), {
    appearance: "auto",
    WebkitAppearance: "checkbox",
    accentColor: vars.primary_400_color,
    width: "2rem",
    height: "2rem",
    minHeight: "2rem",
    padding: 0,
    marginTop: ".2rem",
    flexShrink: 0,
});
// A checkbox among a form's fields is at least 24px high, like the other controls there.
globalStyle(inForm(`input[type="checkbox"].${fieldCheck}`), { width: "2.4rem", height: "2.4rem", minHeight: "2.4rem", marginTop: 0 });
// The files a consent dialog downloads, under its facts.
globalStyle(inForm(`ul.${dialog_files}`), {
    margin: 0,
    paddingLeft: "2rem",
    listStyle: "disc",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});
// The consent breaks between phrases where the engine can, not inside a word.
globalStyle(inForm(`dialog > label.${checkLabel}`), { padding: 0, fontSize: "1.4rem", lineHeight: 1.5, wordBreak: "auto-phrase" });
// A range control looks like the shared Slider (6px groove filled up to the value, 18px Lilac
// thumb), not a text field. Chromium and WebKit have no part for the filled length, so the
// form sets --range-fill to the value's share and the groove paints it; the thumb, centred
// within its own width of the value's place, always covers where the paint ends.
globalStyle(inForm('input[type="range"]'), {
    appearance: "none",
    WebkitAppearance: "none",
    height: "2.4rem",
    minHeight: "2.4rem",
    padding: 0,
    background: "transparent",
    border: 0,
    cursor: "pointer",
});
globalStyle(inForm('input[type="range"]::-webkit-slider-runnable-track'), {
    height: ".6rem",
    borderRadius: ".3rem",
    background: `linear-gradient(to right, ${vars.primary_600_color} var(--range-fill, 0%), ${vars.dark_825_color} var(--range-fill, 0%))`,
});
globalStyle(inForm('input[type="range"]::-webkit-slider-thumb'), {
    WebkitAppearance: "none",
    width: "1.8rem",
    height: "1.8rem",
    marginTop: "-.6rem",
    borderRadius: "50%",
    background: vars.primary_600_color,
});
globalStyle(inForm('input[type="range"]:hover:enabled::-webkit-slider-thumb'), { boxShadow: `0 0 0 .8rem ${vars.primary_600_color_44}` });
globalStyle(inForm('input[type="range"]::-moz-range-track'), { height: ".6rem", borderRadius: ".3rem", background: vars.dark_825_color });
globalStyle(inForm('input[type="range"]::-moz-range-progress'), { height: ".6rem", borderRadius: ".3rem", background: vars.primary_600_color });
globalStyle(inForm('input[type="range"]::-moz-range-thumb'), { width: "1.8rem", height: "1.8rem", border: 0, borderRadius: "50%", background: vars.primary_600_color });

globalStyle(actions, { display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".8rem" });
// How many characters a field holds, under it at its end, in the description's size and color.
globalStyle(count, { justifySelf: "end", fontSize: "1.2rem", color: "var(--vox_description_text, #a3adc0)", fontVariantNumeric: "tabular-nums" });
// A name that no shared row draws, such as a legend, with its hint mark on its line (#614).
globalStyle(hinted, { display: "inline-flex", alignItems: "center", maxWidth: "100%" });
// Buttons and notes that belong to the fields above them stay in the control column (the label
// rows' 1fr / 1.6fr split with its 1.6rem gap) and align flush on the row's right end (#473, #1096).
globalStyle(control_column, {
    marginInlineStart: "calc((100% - 1.6rem) / 2.6 + 1.6rem)",
    "@container": { [STACKED]: { marginInlineStart: 0 } },
    "@media": { [NARROW_WINDOW]: { marginInlineStart: 0 } },
});
globalStyle(`${actions}.${control_column}`, { justifyContent: "flex-end" });
globalStyle(`div.${control_column}:not(.${actions})`, {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: ".8rem",
});
globalStyle(`p.${control_column}`, { textAlign: "end", justifySelf: "end" });
// One downloadable model: name, readout, a full-width progress bar, then its actions.
globalStyle(download_entry, { display: "grid", gap: ".8rem", minWidth: 0 });
// The model catalog: one group per use (a subheading and space, no frame), one card per model.
// A card is a real unit (one model or engine), so it keeps a quiet frame (DESIGN.md, Roles): the
// kit's Card (D-28), its parts named by their data-slot. What a card is, what state it is in and
// what it offers are read from where its parts sit (#614): its name with its state at the end of
// that line, in the same place on every card; what speaks for or against it and what it is under
// the name; its file and facts in one table whose values start at one place on every card; then
// what runs and its actions, starting at the card's edge. These rules lay the cards out; the cards'
// own look is the kit's.
globalStyle(catalog_group, { display: "grid", gap: ".8rem", minWidth: 0 });
// What the GPU reading says for this use, a readout of this session, in one block under the heading.
globalStyle(catalog_advice, { display: "grid", gap: ".2rem", minWidth: 0 });
globalStyle(catalog, { display: "grid", gap: "1.2rem", margin: 0, padding: 0, listStyle: "none", minWidth: 0 });
// A catalog's card and its parts.
const card = `${catalog} > [data-slot="card"]`;
const HEADER = '[data-slot="card-header"]', CONTENT = '[data-slot="card-content"]', FOOTER = '[data-slot="card-footer"]';
// The facts' terms take one width on every card, so their values start at one place down the list.
// 14rem holds the longest Japanese term with its hint mark; a longer English one wraps.
globalStyle(card, { vars: { "--catalog_term": "14rem" } });
// The grid layout of a catalog (catalogLayout.tsx): the cards side by side, as many as fit at
// 26rem or more, each read down in three parts: what the model is (its name, state and words), its
// details in a fold, then what runs and its actions; a model's card has its size and hardware
// between the first two. A card takes three (or four) rows of the list and shares
// them with the cards beside it (subgrid), so their names, their folds and their actions start on
// the same lines across a row. A card is not a container (containment would end the subgrid): its
// fold is (catalogLayout.css.ts), so the facts in it stack as in a narrow window.
const grid = `${catalog}[data-layout="grid"]`;
const gridCard = `${grid} > [data-slot="card"]`;
globalStyle(grid, { gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 26rem), 1fr))" });
globalStyle(`${gridCard}:has(> ${FOOTER})`, { gridRow: "span 3", gridTemplateRows: "subgrid", rowGap: "1.2rem" });
// A model's card has a fourth part, its size and hardware, between what it is and its fold.
globalStyle(`${gridCard}:has(> ${card_key})`, { gridRow: "span 4" });
// A part shorter than the row it shares keeps its lines at the top, not spread over the row.
globalStyle(`${gridCard} > ${HEADER}, ${gridCard} > ${card_key}, ${gridCard} > ${FOOTER}`, { alignContent: "start" });
// The size and the hardware on the card: each term over its value, in the card's width.
globalStyle(`${gridCard} > ${card_key}`, { gridTemplateColumns: "minmax(0, 1fr)", rowGap: ".1rem" });
globalStyle(`${gridCard} > ${card_key} dd`, { marginBottom: ".4rem" });
// The name's line is the name and the state, the state at the top right of every card: a long
// name wraps in its own column.
globalStyle(`${grid} ${card_head}`, { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start" });
// A card of a name alone (an entry the app ships) is one row; the cards of a row are as tall as each other.
globalStyle(`${gridCard}:not(:has(> ${FOOTER}))`, { alignContent: "start" });
// A catalog's heading and its layout buttons on one line; the buttons go under it where they do
// not fit beside it.
globalStyle(catalog_head, { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: ".8rem 1.6rem", minWidth: 0 });
// A section's label (the translation catalog's) keeps its rule up to the buttons, which stand on
// the label's line, above the space under it.
globalStyle(`${catalog_head}.${section_head}`, { alignItems: "flex-end" });
globalStyle(`${catalog_head}.${section_head} > [data-section-label]`, { flex: "1 1 auto" });
globalStyle(`${catalog_head}.${section_head} > :last-child`, { marginBottom: "1.2rem" });
// A wide card is read across, not down: what the model is and what can be done on the left, the
// file and its facts on the right. A narrow one (a narrow window, the translation review) keeps
// the one column.
const WIDE_CARD = "(min-width: 80rem)";
const wideCard = `${card}:has(> ${CONTENT})`;
globalStyle(wideCard, {
    "@container": {
        [WIDE_CARD]: {
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.25fr)",
            gridTemplateRows: "auto 1fr",
            gridTemplateAreas: '"intro spec" "foot spec"',
            columnGap: "3.2rem",
        },
    },
});
globalStyle(`${wideCard} > ${HEADER}`, { "@container": { [WIDE_CARD]: { gridArea: "intro" } } });
globalStyle(`${wideCard} > ${CONTENT}`, { "@container": { [WIDE_CARD]: { gridArea: "spec", alignContent: "start" } } });
globalStyle(`${wideCard} > ${FOOTER}`, { "@container": { [WIDE_CARD]: { gridArea: "foot", alignContent: "start" } } });
// A warning under what the model is, with the space of the next block above it.
globalStyle(`${HEADER} > ${hardware_warning}`, { marginTop: ".8rem" });
// The name's line: the name, then the badges, the state last.
globalStyle(card_head, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".6rem 1rem", minWidth: 0 });
// The state badge (CatalogState, catalogLayout.tsx) ends the name's line, so the states of all
// cards are read down one edge.
globalStyle(status, { marginInlineStart: "auto" });
// What speaks for or against a model (recommended, fits the memory, may be too heavy), under its name.
globalStyle(card_badges, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".6rem", minWidth: 0 });
// The "!" of the notes below, a model that may be too heavy for the user's PC and what a license
// restricts. The words beside it say the same. The badge's is the kit Badge's (mark="alert").
globalStyle(warning_mark, {
    display: "inline-flex",
    flex: "none",
    alignItems: "center",
    justifyContent: "center",
    width: "1.6rem",
    height: "1.6rem",
    borderRadius: "50%",
    background: "var(--vox_state_warning, #cb944f)",
    color: "var(--dark_950_color, #10141c)",
    fontSize: "1.2rem",
    fontWeight: 700,
    lineHeight: 1,
});
// Drawn here so the "!" is never part of the words that are read out or searched.
globalStyle(`${warning_mark}::before`, { content: '"!"' });
// A model that may be too heavy, and what a model's license restricts (#411, in the download
// review): the same amber edge and mark, with the words beside them.
globalStyle(`${hardware_warning}, ${restriction}`, {
    display: "flex",
    alignItems: "flex-start",
    gap: ".8rem",
    margin: 0,
    padding: ".6rem .8rem",
    borderLeft: ".3rem solid var(--vox_state_warning, #cb944f)",
    color: vars.dark_200_color,
    overflowWrap: "anywhere",
});
globalStyle(`${hardware_warning} > ${warning_mark}, ${restriction} > ${warning_mark}`, { marginTop: ".2rem" });
globalStyle(restriction_text, { display: "grid", gap: ".2rem", minWidth: 0 });
// What a user compares: a term and its value per row; the rows stack in a narrow card. In a card
// the terms take the card's one width (--catalog_term), so a value is found at the same place on
// every card. Stacked where the forms' rows stack (DESIGN.md, Field widths), so a value keeps its width.
const NARROW_FACTS = "(max-width: 42rem)";
globalStyle(facts, {
    display: "grid",
    gridTemplateColumns: "var(--catalog_term, max-content) minmax(0, 1fr)",
    gap: ".4rem 1.6rem",
    margin: 0,
    minWidth: 0,
    "@container": { [NARROW_FACTS]: { gridTemplateColumns: "minmax(0, 1fr)" } },
});
globalStyle(`${facts} > div`, { display: "contents" });
globalStyle(`${facts} dt`, { fontSize: "1.2rem", fontWeight: 400, color: vars.vox_description_text });
globalStyle(`${facts} dd`, {
    margin: 0,
    fontSize: "1.3rem",
    color: vars.dark_200_color,
    overflowWrap: "anywhere",
    minWidth: 0,
    "@container": { [NARROW_FACTS]: { marginBottom: ".4rem" } },
});
globalStyle(`${facts} code`, { overflowWrap: "anywhere" });
// The file a card shows, as the first row of its facts: the term in the terms' column, the file
// (or the choice of files) where the values start.
const variants = [variant, `${card} label.${variant_choice}`];
globalStyle(variants.join(", "), {
    display: "grid",
    gridTemplateColumns: "var(--catalog_term) minmax(0, max-content)",
    alignItems: "center",
    gap: ".4rem 1.6rem",
    margin: 0,
    padding: 0,
    fontSize: "1.2rem",
    fontWeight: 400,
    color: vars.vox_description_text,
    "@container": { [NARROW_FACTS]: { gridTemplateColumns: "minmax(0, 1fr)" } },
});
globalStyle(variants.map(selector => `${selector} > :last-child`).join(", "), { fontSize: "1.3rem", color: vars.dark_200_color });
// The choice of the file is the kit's Select: its wrapper, which the field fills, takes the
// column's width in place of the form's compact one.
globalStyle(variants.map(selector => `${selector} [data-slot="native-select-wrapper"]`).join(", "), { width: "auto", minWidth: 0, maxWidth: "100%", justifySelf: "auto" });
// An official site, opened like the buttons beside it.
globalStyle(link_button, { display: "inline-flex", alignItems: "center", minHeight: "4rem" });
// The shared GPU and memory group: space and a subheading, no frame.
globalStyle(hardware, { display: "grid", gap: ".8rem", minWidth: 0, containerType: "inline-size" });
// The select list's first frame (see the base-select rules for the form's select). The kit's
// select has its own (kit/Field.css.ts).
globalStyle(inForm("select:open::picker(select)"), {
    "@supports": { [BASE_SELECT]: { "@starting-style": { opacity: 0, transform: "translateY(-.6rem) scaleY(.94)" } } },
});

// A field for a short value of known length (a number) keeps its short width, at most 14rem, at
// the row's right end (DESIGN.md "Field widths", #1266 R-3).
export const short_field = style({});
globalStyle(`${container} ${short_field}`, { width: "min(14rem, 100%)", justifySelf: "end" });
