import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import type { CSSProperties } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The forms' look. Most of it styles plain elements inside a form section (.container) and relies
// on the order of rules of the same weight, as a stylesheet does: the classes are declared first
// and the rules follow in the order the SCSS module had them (#957).
export const container = style({});
export const fields = style({});
export const group = style({});
export const quiet = style({});
export const more = style({});
export const problem_slot = style({});
export const checkLabel = style({});
export const fieldCheck = style({});
export const dialog_text = style({});
export const actions = style({});
export const stop = style({});
export const is_stopping = style({});
export const is_stopped = style({});
export const is_idle = style({});
export const count = style({});
export const hinted = style({});
export const control_column = style({});
export const error_code = style({});
export const download_entry = style({});
export const catalog_group = style({});
export const catalog_advice = style({});
export const catalog = style({});
export const card = style({});
export const card_intro = style({});
export const card_key = style({});
export const card_spec = style({});
export const card_foot = style({});
export const card_head = style({});
export const catalog_head = style({});
export const section_head = style({});
export const status = style({});
export const card_badges = style({});
export const badge = style({});
export const warning_mark = style({});
export const hardware_warning = style({});
export const restriction = style({});
export const restriction_text = style({});
export const facts = style({});
export const variant = style({});
export const variant_choice = style({});
export const link_button = style({});
export const progress = style({});
export const hardware = style({});

// A rule inside a form section: each selector of the list under .container.
const inForm = (...selectors: string[]) => selectors.map(selector => `${container} ${selector}`).join(", ");
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
});
globalStyle(`${container}:has(> [data-section-label]:first-child)`, { paddingTop: 0 });
globalStyle(container, {
    color: "var(--dark_200_color, #e5e7eb)",
    borderBottom: ".1rem solid var(--dark_800_color, #34363b)",
});
globalStyle(inForm("form", "fieldset"), { display: "grid", gap: "1.2rem", minWidth: 0, containerType: "inline-size" });
globalStyle(inForm("fieldset"), { border: ".1rem solid var(--dark_800_color, #344662)", borderRadius: "var(--vox_radius, .8rem)", padding: "1.6rem" });
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
globalStyle(inForm("input", "select", "textarea", "button"), {
    boxSizing: "border-box",
    font: "inherit",
    fontWeight: 400,
    minHeight: "4rem",
    padding: ".9rem 1.2rem",
    color: "inherit",
    borderRadius: "var(--vox_radius, .8rem)",
});
globalStyle(inForm("input", "select", "textarea"), {
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
globalStyle(inForm("input::placeholder", "textarea::placeholder"), { color: vars.vox_description_text, opacity: 1 });
globalStyle(inForm("textarea"), { resize: "vertical", minHeight: "8rem" });
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
// shadcn/ui's DialogContent: at most 51.2rem wide (sm:max-w-lg), 1.6rem between its parts (gap-4).
globalStyle(inForm("dialog"), {
    maxWidth: "min(51.2rem, calc(100vw - 3.2rem))",
    maxHeight: "calc(100dvh - 3.2rem)",
    overflowY: "auto",
    padding: "2.4rem",
    border: ".1rem solid var(--dark_600_color, #555d69)",
    borderRadius: "1.2rem",
    background: "var(--dark_875_color, #282a2e)",
    color: "inherit",
});
// shadcn/ui's bg-black/50. Written as a colour, not a token: a ::backdrop takes custom properties
// from its dialog only in newer engines (Safari 17.4, Chrome 122), and an older WebKitGTK would not dim.
globalStyle(inForm("dialog::backdrop"), { background: "#00000080" });
globalStyle(inForm("dialog button"), { margin: ".8rem .8rem 0 0" });
// A consent dialog reads as a document: its title and facts are one part (dialog_text), a
// fact a paragraph with air between them; the consent and the actions are parts of their own.
globalStyle(inForm("dialog[open]"), { display: "grid", gap: "1.6rem", alignContent: "start" });
globalStyle(inForm(`.${dialog_text}`), { display: "grid", gap: ".8rem", minWidth: 0 });
globalStyle(inForm("dialog > h3", `.${dialog_text} > h3`), { margin: 0, fontSize: "1.8rem", lineHeight: 1.4, color: vars.dark_200_color });
globalStyle(inForm(`.${dialog_text} > h3`), { marginBottom: ".4rem" });
globalStyle(inForm("dialog > ul", `.${dialog_text} > ul`), {
    margin: 0,
    paddingLeft: "2rem",
    listStyle: "disc",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});
// The consent breaks between phrases where the engine can, not inside a word.
globalStyle(inForm(`dialog > label.${checkLabel}`), { padding: 0, fontSize: "1.4rem", lineHeight: 1.5, wordBreak: "auto-phrase" });
// The two answers of a form's own leave confirmation (useSettingsDraft.tsx) are one row, as the
// save bar's confirmation lays them out (Topbar.css.ts).
globalStyle(inForm("dialog > [data-leave-actions]"), { display: "flex", flexWrap: "wrap", gap: ".8rem" });
// A button in a row of actions keeps the row's gap only.
globalStyle(inForm("dialog > [data-leave-actions] button", `dialog > .${actions} button`), { margin: 0 });
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
// The TTS page's stop, drawn as the top bar's (#937): pressed, it sinks while the core answers and
// flashes lilac once it has; with nothing to stop it is half-transparent.
const stopAnswered = keyframes({ from: { background: vars.vox_highlight_tint } });
globalStyle(`${stop}.${is_stopping}`, { background: vars.dark_925_color, cursor: "progress" });
globalStyle(`${stop}.${is_stopped}`, {
    color: vars.primary_200_color,
    borderColor: vars.primary_600_color,
    animation: `${stopAnswered} .8s ease-out`,
    "@media": { "(prefers-reduced-motion: reduce)": { animation: "none" } },
});
globalStyle(`${stop}.${is_idle}, ${stop}.${is_idle}:hover, ${stop}.${is_idle}:active`, { opacity: .5, cursor: "not-allowed" });
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
globalStyle(error_code, { fontSize: "1.2rem", color: vars.dark_400_color, overflowWrap: "anywhere" });
// One downloadable model: name, readout, a full-width progress bar, then its actions.
globalStyle(download_entry, { display: "grid", gap: ".8rem", minWidth: 0 });
// The model catalog: one group per use (a subheading and space, no frame), one card per model.
// A card is a real unit (one model or engine), so it keeps a quiet frame (DESIGN.md, Roles).
// What a card is, what state it is in and what it offers are read from where its parts sit
// (#614): its name with its state at the end of that line, in the same place on every card; what
// speaks for or against it and what it is under the name; its file and facts in one table whose
// values start at one place on every card; then what runs and its actions, starting at the card's
// edge. The card in use carries the active color on its frame and the lilac tint, as a switch that is on.
globalStyle(catalog_group, { display: "grid", gap: ".8rem", minWidth: 0 });
// What the GPU reading says for this use, a readout of this session, in one block under the heading.
globalStyle(catalog_advice, { display: "grid", gap: ".2rem", minWidth: 0 });
globalStyle(catalog, { display: "grid", gap: "1.2rem", margin: 0, padding: 0, listStyle: "none", minWidth: 0 });
// The grid layout of a catalog (catalogLayout.tsx): the cards side by side, as many as fit at
// 26rem or more, each read down in three parts: what the model is (its name, state and words), its
// details in a fold, then what runs and its actions; a model's card has its size and hardware
// between the first two. A card takes three (or four) rows of the list and shares
// them with the cards beside it (subgrid), so their names, their folds and their actions start on
// the same lines across a row. A card is not a container (containment would end the subgrid): its
// fold is (catalogLayout.css.ts), so the facts in it stack as in a narrow window.
const grid = `${catalog}[data-layout="grid"]`;
globalStyle(grid, { gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 26rem), 1fr))" });
globalStyle(`${grid} > ${card}:has(> ${card_foot})`, { gridRow: "span 3", gridTemplateRows: "subgrid", rowGap: "1.2rem" });
// A model's card has a fourth part, its size and hardware, between what it is and its fold.
globalStyle(`${grid} > ${card}:has(> ${card_key})`, { gridRow: "span 4" });
// A part shorter than the row it shares keeps its lines at the top, not spread over the row.
globalStyle(`${grid} > ${card} > ${card_intro}, ${grid} > ${card} > ${card_key}, ${grid} > ${card} > ${card_foot}`, { alignContent: "start" });
// The size and the hardware on the card: each term over its value, in the card's width.
globalStyle(`${grid} > ${card} > ${card_key}`, { gridTemplateColumns: "minmax(0, 1fr)", rowGap: ".1rem" });
globalStyle(`${grid} > ${card} > ${card_key} dd`, { marginBottom: ".4rem" });
// The name's line is the name and the state, the state at the top right of every card: a long
// name wraps in its own column.
globalStyle(`${grid} ${card_head}`, { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start" });
// A card of a name alone (an entry the app ships) is one row; the cards of a row are as tall as each other.
globalStyle(`${grid} > ${card}:not(:has(> ${card_foot}))`, { alignContent: "start" });
// A catalog's heading and its layout buttons on one line; the buttons go under it where they do
// not fit beside it.
globalStyle(catalog_head, { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: ".8rem 1.6rem", minWidth: 0 });
// A section's label (the translation catalog's) keeps its rule up to the buttons, which stand on
// the label's line, above the space under it.
globalStyle(`${catalog_head}.${section_head}`, { alignItems: "flex-end" });
globalStyle(`${catalog_head}.${section_head} > [data-section-label]`, { flex: "1 1 auto" });
globalStyle(`${catalog_head}.${section_head} > :last-child`, { marginBottom: "1.2rem" });
globalStyle(card, {
    display: "grid",
    gap: "1.2rem",
    minWidth: 0,
    padding: "1.6rem",
    // The facts' terms take one width on every card, so their values start at one place down the list.
    // 14rem holds the longest Japanese term with its hint mark; a longer English one wraps.
    vars: { "--catalog_term": "14rem" },
    border: ".1rem solid var(--dark_800_color, #344662)",
    borderRadius: "var(--vox_radius, .8rem)",
});
globalStyle(`${card}:focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".3rem" });
globalStyle(`${card} > strong, ${card} ${card_head} > strong`, { fontSize: "1.5rem", fontWeight: 600, color: vars.dark_200_color });
globalStyle(`${card}[data-status="in_use"]`, { borderColor: "var(--vox_state_active, #b797f8)", background: vars.vox_highlight_tint });
// The name's line and what the model is, read as one; the file and its facts; the actions and
// what they started. Each block is tight inside and apart from the next.
globalStyle(card_intro, { display: "grid", gap: ".4rem", minWidth: 0 });
globalStyle(`${card_spec}, ${card_foot}`, { display: "grid", gap: ".8rem", minWidth: 0 });
// A wide card is read across, not down: what the model is and what can be done on the left, the
// file and its facts on the right. A narrow one (a narrow window, the translation review) keeps
// the one column.
const WIDE_CARD = "(min-width: 80rem)";
const wideCard = `${card}:has(> ${card_spec})`;
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
globalStyle(`${wideCard} > ${card_intro}`, { "@container": { [WIDE_CARD]: { gridArea: "intro" } } });
globalStyle(`${wideCard} > ${card_spec}`, { "@container": { [WIDE_CARD]: { gridArea: "spec", alignContent: "start" } } });
globalStyle(`${wideCard} > ${card_foot}`, { "@container": { [WIDE_CARD]: { gridArea: "foot", alignContent: "start" } } });
// A warning under what the model is, with the space of the next block above it.
globalStyle(`${card_intro} > ${hardware_warning}`, { marginTop: ".8rem" });
globalStyle(card_head, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".6rem 1rem", minWidth: 0 });
// The state badge ends the name's line, so the states of all cards are read down one edge.
globalStyle(status, { marginInlineStart: "auto" });
// What speaks for or against a model (recommended, fits the memory, may be too heavy), under its name.
globalStyle(card_badges, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".6rem", minWidth: 0 });
// A word on a card's head. Its words say the state; the color only repeats them.
globalStyle(badge, {
    display: "inline-block",
    padding: ".1rem .8rem",
    border: ".1rem solid var(--dark_700_color, #4a5d7c)",
    borderRadius: ".4rem",
    fontSize: "1.2rem",
    fontWeight: 500,
    lineHeight: 1.6,
    color: vars.vox_secondary_text,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
});
const tone = (...names: string[]) => names.map(name => `${badge}[data-tone="${name}"]`).join(", ");
globalStyle(tone("recommended"), { borderColor: vars.primary_500_color, color: vars.primary_200_color });
globalStyle(tone("in_use", "connected", "ready"), { borderColor: "var(--vox_state_active, #80acff)", color: "var(--vox_state_active, #80acff)" });
globalStyle(tone("downloaded"), { color: vars.dark_200_color });
globalStyle(tone("working", "checking", "not_connected", "changed"), { borderColor: "var(--vox_state_warning, #cb944f)", color: "var(--vox_state_warning, #cb944f)" });
globalStyle(tone("url_invalid", "missing"), { borderColor: "var(--vox_state_failed, #f08a85)", color: "var(--vox_state_failed, #f08a85)" });
// A model the user registered (#403): set apart from the reviewed catalog by a dashed edge.
globalStyle(tone("own"), { borderStyle: "dashed", color: vars.dark_200_color });
globalStyle(tone("hardware_warning"), {
    display: "inline-flex",
    alignItems: "center",
    gap: ".5rem",
    borderColor: "var(--vox_state_warning, #cb944f)",
    color: "var(--vox_state_warning, #cb944f)",
});
// A card's state at the end of its name's line: whether the model is on the PC is told by the
// badge's shape and mark as well as its words, in both layouts and every catalog. On the PC
// (downloaded, in use, checked and ready, an entry that can be used): a filled badge with a check.
// The words of a filled badge are dark on its light fill.
// Not yet (not downloaded, an API without its key): an outline with an empty ring, its words
// quieter. The marks are drawn here, so they are never part of the words read out or searched.
const state = (...names: string[]) => names.map(name => `${badge}.${status}[data-tone="${name}"]`);
const marked = state("not_downloaded", "not_set", "downloaded", "in_use", "ready");
globalStyle(marked.join(", "), { display: "inline-flex", alignItems: "center", gap: ".5rem" });
globalStyle(marked.map(selector => `${selector}::before`).join(", "), {
    content: '""',
    flex: "none",
    width: "1.2rem",
    height: "1.2rem",
    backgroundColor: "currentColor",
    WebkitMask: "var(--status_mark) center / contain no-repeat",
    mask: "var(--status_mark) center / contain no-repeat",
});
globalStyle(state("not_downloaded", "not_set").join(", "), {
    vars: { "--status_mark": `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='5.6' fill='none' stroke='black' stroke-width='1.6'/%3E%3C/svg%3E")` },
    background: "transparent",
    borderColor: "var(--dark_700_color, #4a5d7c)",
    color: "var(--vox_description_text, #a3adc0)",
});
globalStyle(state("downloaded", "in_use", "ready").join(", "), {
    vars: { "--status_mark": `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.4 5.3-4.1 4.2a.8.8 0 0 1-1.1 0L4.6 8.9a.8.8 0 1 1 1.1-1.1l1 1 3.6-3.6a.8.8 0 0 1 1.1 1.1z'/%3E%3C/svg%3E")` },
});
// On the PC: a solid light badge; in use: solid in the active color the card's frame has;
// checked and ready to apply, or an entry that can be used: the active outline, tinted.
globalStyle(state("downloaded").join(", "), { background: "var(--dark_300_color, #e0dbe6)", borderColor: "var(--dark_300_color, #e0dbe6)", color: "var(--dark_950_color, #1c0f27)" });
globalStyle(state("in_use").join(", "), { background: "var(--vox_state_active, #b797f8)", borderColor: "var(--vox_state_active, #b797f8)", color: "var(--dark_950_color, #1c0f27)" });
globalStyle(state("ready").join(", "), { background: vars.vox_highlight_tint });
// The "!" of a model that may be too heavy for the user's PC. The words beside it say the same.
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
globalStyle(variants.map(selector => `${selector} select`).join(", "), { width: "auto", minWidth: 0, maxWidth: "100%", justifySelf: "auto" });
// An official site, opened like the buttons beside it.
globalStyle(link_button, { display: "inline-flex", alignItems: "center", minHeight: "4rem" });
globalStyle(progress, {
    width: "100%",
    height: ".6rem",
    appearance: "none",
    WebkitAppearance: "none",
    border: 0,
    borderRadius: ".3rem",
    overflow: "hidden",
    background: vars.dark_825_color,
});
globalStyle(`${progress}::-webkit-progress-bar`, { background: vars.dark_825_color, borderRadius: ".3rem" });
globalStyle(`${progress}::-webkit-progress-value`, { background: vars.primary_500_color, borderRadius: ".3rem" });
globalStyle(`${progress}::-moz-progress-bar`, { background: vars.primary_500_color, borderRadius: ".3rem" });
// The shared GPU and memory group: space and a subheading, no frame.
globalStyle(hardware, { display: "grid", gap: ".8rem", minWidth: 0, containerType: "inline-size" });
// The select list's first frame (see the base-select rules for the form's select).
globalStyle(`${container} select:open::picker(select)`, {
    "@supports": { [BASE_SELECT]: { "@starting-style": { opacity: 0, transform: "translateY(-.6rem) scaleY(.94)" } } },
});
