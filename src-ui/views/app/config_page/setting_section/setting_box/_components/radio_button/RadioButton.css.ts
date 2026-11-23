import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { loader as spinner } from "../../../../../../common_css/mixins.ts";

// Many of this component's rules are of the same weight and set the same things on one element
// (a selected or disabled option's description, its warning line). The classes are declared
// first and the rules follow in the SCSS order, so the later one still wins.
export const container = style({});
export const column = style({});
export const has_desc = style({});
export const grouped = style({});
export const group = style({});
export const group_label = style({});
export const group_options = style({});
export const radio_button_container = style({});
export const radio_button_wrapper = style({});
export const is_selected = style({});
export const disabled = style({});
export const radio_button_input = style({});
export const radio_button_header = style({});
export const label_heading_wrapper = style({});
export const radio_button_label = style({});
export const radio_button_desc = style({});
export const desc_warning = style({});
export const capacity_label = style({});
export const default_badge = style({});

globalStyle(container, {
    display: "flex",
    gap: "0.4rem",
    position: "relative",
    flexShrink: 0,
    flexWrap: "wrap",
    maxWidth: "70%",
});
globalStyle(`${container}.${column}`, { flexDirection: "column", alignItems: "stretch", width: "100%", minWidth: 0, maxWidth: "100%" });
globalStyle(`${container}.${column} ${radio_button_container}`, { minWidth: 0, flexWrap: "wrap" });
// 24rem of model information + 9rem action + 1.2rem gap.
// Flex wrapping measures this row, including any ancestor padding.
globalStyle(`${container}.${column} ${radio_button_container} ${radio_button_wrapper}`, { flex: "1 1 24rem", minWidth: 0, maxWidth: "100%" });
globalStyle(`${container}.${column} ${radio_button_header}, ${container}.${column} ${label_heading_wrapper}`, { minWidth: 0 });
globalStyle(`${container}.${column} ${label_heading_wrapper}`, { flexWrap: "wrap" });
globalStyle(`${container}.${column} ${radio_button_label}`, { minWidth: 0, flexShrink: 1, overflowWrap: "anywhere" });
globalStyle(`${container}.${column} ${radio_button_desc}`, { overflowWrap: "anywhere" });

globalStyle(`${container}.${has_desc}:not(.${column})`, { maxWidth: "100%", flex: 1, gap: "0.8rem" });
globalStyle(`${container}.${has_desc}:not(.${column}) ${radio_button_container}`, { flex: "1 1 0", minWidth: "13rem" });
globalStyle(`${container}.${has_desc}:not(.${column}) ${radio_button_wrapper}`, { flex: "1 1 0", minWidth: 0, width: "100%", height: "100%" });

// Options under group names (#414): each name over its options, the groups one under
// another. The options of a group wrap, and a long name wraps inside its option.
globalStyle(`${container}.${grouped}`, {
    flexDirection: "column",
    alignItems: "stretch",
    flexWrap: "nowrap",
    gap: "1.2rem",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
});
globalStyle(`${container}.${grouped} ${radio_button_wrapper}`, { flexShrink: 1, minWidth: 0, maxWidth: "100%" });
globalStyle(`${container}.${grouped} ${radio_button_header}, ${container}.${grouped} ${label_heading_wrapper}`, { minWidth: 0 });
globalStyle(`${container}.${grouped} ${radio_button_label}`, { minWidth: 0, flexShrink: 1, overflowWrap: "anywhere" });

globalStyle(group, { display: "grid", gap: ".4rem", minWidth: 0 });
// The group's name: the row's small heading for the options under it, in the secondary text.
globalStyle(group_label, { fontSize: "1.2rem", fontWeight: 600, lineHeight: 1.6, color: vars.vox_secondary_text, overflowWrap: "anywhere" });
globalStyle(group_options, { display: "flex", flexWrap: "wrap", gap: ".4rem", minWidth: 0 });

globalStyle(radio_button_container, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "1.2rem",
    position: "relative",
});

globalStyle(radio_button_wrapper, {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    cursor: "pointer",
    gap: "1rem",
    padding: "0.6rem 0.8rem",
    borderRadius: "0.4rem",
});
globalStyle(`${radio_button_wrapper}:hover`, { backgroundColor: vars.dark_850_color });
globalStyle(`${radio_button_wrapper}:active`, { backgroundColor: vars.dark_925_color });
globalStyle(`${radio_button_wrapper}.${has_desc}`, { flexDirection: "column", alignItems: "stretch", gap: "0.6rem" });
globalStyle(`${radio_button_wrapper}.${is_selected}`, { pointerEvents: "none" });
globalStyle(`${radio_button_wrapper}.${is_selected} ${capacity_label}`, { color: vars.dark_350_color });
globalStyle(`${radio_button_wrapper}.${is_selected} ${radio_button_desc}`, { color: vars.dark_400_color });
globalStyle(`${radio_button_wrapper}.${is_selected} ${default_badge}`, { outlineColor: vars.primary_300_color });
globalStyle(`${radio_button_wrapper}.${disabled}`, { pointerEvents: "none", color: vars.dark_600_color });
// Why the option cannot be chosen is its hint (#614): its mark still takes the pointer,
// and hovering it opens the bubble (the option's label is :hover through it).
globalStyle(`${radio_button_wrapper}.${disabled} [data-hint]`, { pointerEvents: "auto" });
globalStyle(`${radio_button_wrapper}.${disabled} ${capacity_label}`, { color: vars.dark_600_color });
// License text must stay readable before a download: the control looks disabled, the text does not fade below 4.5:1.
globalStyle(`${radio_button_wrapper}.${disabled} ${radio_button_desc}`, { color: vars.vox_description_text });
globalStyle(`${radio_button_wrapper}.${disabled} ${default_badge}`, { color: vars.dark_600_color, outlineColor: vars.dark_850_color });

globalStyle(radio_button_input, {
    appearance: "none",
    margin: 0,
    width: "2rem",
    height: "2rem",
    border: `0.3rem solid ${vars.dark_600_color}`,
    borderRadius: "50%",
    transition: "border-color .1s ease, border-width .1s ease",
    flexShrink: 0,
    cursor: "inherit",
});
globalStyle(`${radio_button_input}:checked`, { borderColor: vars.primary_400_color, borderWidth: "0.6rem" });
// aria-disabled: the radios of a choice that waits on the engine (RadioButton.tsx).
globalStyle(`${radio_button_input}:disabled, ${radio_button_input}[aria-disabled="true"]`, { borderColor: vars.dark_825_color });

globalStyle(radio_button_header, { display: "flex", alignItems: "center", gap: "1rem", width: "100%" });
globalStyle(label_heading_wrapper, { display: "flex", alignItems: "center", gap: "0.8rem", flexGrow: 1 });
globalStyle(radio_button_label, { fontSize: "1.4rem", fontWeight: 400, flexShrink: 0 });
globalStyle(radio_button_desc, {
    fontSize: "1.2rem",
    color: vars.vox_secondary_text,
    lineHeight: 1.4,
    overflowWrap: "break-word",
    width: "100%",
});

// e.g. the non-commercial license line of an NLLB translation weight. Placed
// after the state rules above so it stays visible when selected or disabled.
globalStyle([
    `${radio_button_wrapper} ${radio_button_desc}.${desc_warning}`,
    `${radio_button_wrapper}.${is_selected} ${radio_button_desc}.${desc_warning}`,
    `${radio_button_wrapper}.${disabled} ${radio_button_desc}.${desc_warning}`,
].join(", "), { color: vars.warning_color, fontWeight: 600 });

globalStyle(capacity_label, {
    marginLeft: "auto",
    fontSize: "1.2rem",
    color: vars.dark_500_color,
    textAlign: "right",
    fontWeight: 400,
    userSelect: "none",
    whiteSpace: "nowrap",
    letterSpacing: "0.02em",
    flexShrink: 0,
});

globalStyle(default_badge, {
    fontSize: "1.2rem",
    lineHeight: 1,
    padding: "0.2rem 0.5rem",
    borderRadius: "0.2rem",
    backgroundColor: vars.dark_875_color,
    outline: `0.1rem solid ${vars.dark_800_color}`,
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "nowrap",
    flexShrink: 0,
});

export const loader = style(spinner({ size: "2rem", lineWidth: "0.2rem", position: "left", positionAmount: "-1.6rem" }));
