import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// The confirmed settings module supplies row, button, typography and selection styles.
// Only language-specific layout and state feedback live here. The classes are declared first and
// the rules follow in the order the SCSS module had them (#957), as rules of one weight compete.
export const language_window = style({});
export const main = style({});
export const picker = style({});
export const presets = style({});
export const preset_label = style({});
export const preset = style({});
export const status = style({});
export const error = style({});
export const source = style({});
export const selected_value = style({});
export const swap = style({});
export const swap_arrow = style({});
export const swap_arrow_up = style({});
export const targets = style({});
export const target_heading = style({});
export const count = style({});
export const selected_rows = style({});
export const target_row = style({});
export const target_change = style({});
export const order = style({});
export const remove = style({});
export const add = style({});
export const limit = style({});
export const engine_note = style({});
export const context = style({});
export const feedback = style({});
export const retry = style({});
export const picker_scroll = style({});
export const helper = style({});
export const choice_grid = style({});
export const choice = style({});
export const check = style({});
export const all_languages = style({});
export const warning = style({});
export const unavailable = style({});
export const waiting = style({});
export const sr_only = style({});
export const language_text = style({});
export const filter = style({});
export const list_tools = style({});
export const jump_groups = style({});
export const jump_button = style({});

const enabled = ':not(:disabled):not([aria-disabled="true"])';
globalStyle(language_window, { flex: 1, minWidth: 0, minHeight: 0 });
globalStyle(`${language_window} button`, { cursor: "pointer", touchAction: "manipulation" });
globalStyle([
    `${language_window} button:hover${enabled}`,
    `${language_window} button[data-vr-hover]${enabled}`,
    `${language_window} summary:hover:not([aria-disabled="true"])`, `${language_window} summary[data-vr-hover]:not([aria-disabled="true"])`,
].join(", "), {
    boxShadow: `inset 0 0 0 3px ${vars.primary_300_color}`,
});
globalStyle(`${language_window} button:disabled, ${language_window} button[aria-disabled="true"]`, { cursor: "default" });
globalStyle(`${language_window} button:active${enabled}, ${language_window} summary:active${enabled}`, {
    backgroundColor: vars.primary_600_color,
    color: vars.vox_on_primary,
    transition: "none",
});
globalStyle(`${language_window} summary:focus-visible`, { outline: `3px solid ${vars.primary_100_color}`, outlineOffset: "-3px" });
globalStyle(`${language_window} fieldset`, { border: 0, margin: 0, minWidth: 0 });
globalStyle(`${main}, ${picker}`, { flex: 1, minHeight: 0, padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "8px" });
globalStyle(main, { overflowY: "auto", overscrollBehavior: "contain" });
globalStyle(presets, { display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 });
globalStyle(preset_label, { flex: "0 0 auto" });
globalStyle(preset, { width: "64px", fontSize: "22px" });
globalStyle(status, { marginLeft: "auto", fontSize: "16px", lineHeight: 1.4, color: vars.primary_200_color, minWidth: 0, overflowWrap: "anywhere", textAlign: "right" });
globalStyle(`${status}.${error}`, { maxWidth: "220px" });
globalStyle(source, { minWidth: 0 });
globalStyle(selected_value, { textAlign: "right", fontWeight: 500 });
// The swap stands on the recipients' heading line, between your language above and recipient 1
// below: the two it exchanges. A laser target of its own, 56px tall like the other buttons.
globalStyle(swap, { minWidth: "152px", gap: "10px", padding: "0 18px", fontSize: "19px" });
globalStyle(swap_arrow, { width: "20px", height: "20px", flexShrink: 0, fill: "currentColor" });
globalStyle(swap_arrow_up, { transform: "rotate(180deg)" });
globalStyle(targets, { display: "flex", flexDirection: "column", gap: "8px", flex: "1 0 auto" });
// The heading, the swap in the middle of the window and the count at the right end.
globalStyle(target_heading, { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: "12px", flexShrink: 0 });
globalStyle(`${target_heading} h2`, { marginTop: 0, lineHeight: 1.3 });
globalStyle(`${target_heading} ${count}`, { justifySelf: "end" });
globalStyle(count, { fontSize: "16px", fontVariantNumeric: "tabular-nums", flexShrink: 0, color: vars.dark_350_color });
globalStyle(selected_rows, { display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 });
// The rows of the list are 64px, each button in them still 56px tall: with the swap on the heading
// line, three recipients, the line under them and the translator stay in the window without scrolling.
globalStyle(target_row, { alignItems: "stretch", gap: "8px", minHeight: "64px", paddingBlock: "4px" });
globalStyle(target_change, { flex: 1, display: "flex", alignItems: "center", gap: "10px", minWidth: 0, minHeight: "56px", borderRadius: "12px", textAlign: "left", background: "transparent", color: "inherit" });
globalStyle(order, { flexShrink: 0, width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "19px", fontWeight: 600, color: vars.dark_basic_text_color, background: vars.dark_750_color });
globalStyle(remove, { width: "64px", fontSize: "16px" });
globalStyle(`${remove} svg`, { width: "20px", height: "20px", fill: "currentColor" });
globalStyle(`${remove}:disabled`, { color: vars.dark_350_color, background: vars.dark_900_color });
globalStyle(add, { width: "100%", gap: "10px", fontSize: "19px" });
globalStyle(limit, { minHeight: "32px", display: "flex", alignItems: "center", padding: "0 14px", fontSize: "16px", lineHeight: 1.4, color: vars.dark_350_color });
globalStyle(engine_note, { marginTop: "5px", fontSize: "16px", fontWeight: 400, lineHeight: 1.4, color: vars.primary_200_color, display: "flex", alignItems: "center", gap: "6px" });
globalStyle(`${engine_note} svg`, { width: "20px", height: "20px", flexShrink: 0, fill: "currentColor" });
globalStyle(context, { flex: 1 });
globalStyle(`${context} > span`, { display: "block", fontSize: "16px", color: vars.dark_350_color, lineHeight: 1.3 });
globalStyle(`${context} h2`, { fontSize: "16px", fontWeight: 400, lineHeight: 1.3, overflowWrap: "anywhere" });
globalStyle(feedback, { flexShrink: 0, color: vars.primary_200_color, fontSize: "16px", lineHeight: 1.4, padding: "10px 14px", borderRadius: "12px", background: vars.dark_950_color });
globalStyle(retry, { margin: "14px 16px 0", flexShrink: 0 });
globalStyle(error, { color: vars.warning_color });
globalStyle(picker_scroll, { flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", paddingRight: "8px", display: "flex", flexDirection: "column", gap: "8px", scrollPaddingBlock: "8px" });
globalStyle(`${main}::-webkit-scrollbar, ${picker_scroll}::-webkit-scrollbar`, { width: "14px" });
globalStyle(`${main}::-webkit-scrollbar-thumb, ${picker_scroll}::-webkit-scrollbar-thumb`, { borderRadius: "7px", background: vars.dark_600_color });
globalStyle(helper, { fontSize: "16px", lineHeight: 1.4, color: vars.dark_350_color });
globalStyle(choice_grid, { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "8px", flexShrink: 0 });
globalStyle(choice, { scrollMarginTop: "8px" });
globalStyle(`${choice}:disabled:not([aria-pressed="true"])`, { color: vars.dark_500_color, background: vars.dark_900_color });
globalStyle(check, { flexShrink: 0, fontSize: "22px", color: vars.primary_100_color });
globalStyle(all_languages, { flexShrink: 0, fontSize: "19px", fontWeight: 600 });
globalStyle(`${all_languages} > span:last-child`, { marginLeft: "auto" });
globalStyle(warning, { display: "flex", alignItems: "flex-start", flexShrink: 0, gap: "10px", padding: "10px 14px", borderRadius: "12px", background: vars.dark_950_color, color: vars.warning_color, fontSize: "16px", lineHeight: 1.4 });
globalStyle(`${warning} svg`, { flexShrink: 0, width: "22px", height: "22px", fill: "currentColor" });
globalStyle(unavailable, { marginTop: "8px", flexShrink: 0 });
globalStyle(`${unavailable} summary`, { cursor: "pointer" });
globalStyle(`${unavailable} summary::-webkit-details-marker`, { display: "none" });
globalStyle(`${unavailable} ${helper}`, { margin: "8px 0", paddingLeft: "11px", borderLeft: `3px solid ${vars.primary_700_color}` });
globalStyle(waiting, { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "19px", padding: "24px" });
globalStyle(sr_only, { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" });

// Long localized names wrap inside their grid cell instead of widening the window.
globalStyle(language_text, { overflow: "hidden" });
globalStyle(`${language_text} > span`, { minWidth: 0, overflowWrap: "anywhere", whiteSpace: "normal" });
globalStyle(filter, {
    width: "100%", minWidth: 0, flexShrink: 0, padding: "10px 14px", font: "inherit", fontSize: "19px",
    color: vars.dark_basic_text_color, background: vars.dark_850_color, border: `1px solid ${vars.dark_600_color}`, borderRadius: "8px",
});
globalStyle(`${filter}:focus-visible, ${filter}[data-vr-hover]:not(:disabled)`, { outline: `3px solid ${vars.primary_100_color}`, outlineOffset: "-3px" });

// Keep jumps reachable while the two-column list scrolls. At the fixed 720px
// popup width, ten columns give each laser target at least 56 x 56px.
globalStyle(list_tools, { flexShrink: 0, display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 });
globalStyle(jump_groups, { display: "grid", gridTemplateColumns: "repeat(10, minmax(0, 1fr))", gap: "8px" });
globalStyle(jump_button, { minWidth: 0, minHeight: "56px", height: "auto", padding: "6px 2px", fontSize: "19px", lineHeight: 1.2, overflowWrap: "anywhere", whiteSpace: "normal" });
