import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

export const container = style({
    display: "flex", flexDirection: "column", gap: "1.2rem", padding: "1.6rem", height: "100%", boxSizing: "border-box", overflow: "auto",
    background: vars.vox_canvas, color: vars.dark_basic_text_color, fontSize: "1.4rem",
});
globalStyle(`${container} textarea`, {
    flex: 1, minHeight: "3rem", width: "100%", boxSizing: "border-box", resize: "none", padding: "1.2rem", font: "inherit", userSelect: "text",
    color: "inherit", background: vars.dark_925_color, border: `.1rem solid ${vars.vox_field_border}`, borderRadius: vars.vox_radius,
});
// The same hint as the main window's composer, in the settings' placeholder colour.
globalStyle(`${container} textarea::placeholder`, { color: vars.vox_description_text, opacity: 1 });
globalStyle(`${container} button`, {
    font: "inherit", fontWeight: 500, padding: ".6rem 1.4rem", minHeight: "3.6rem", borderRadius: vars.vox_radius,
    color: vars.vox_on_primary, background: vars.primary_600_color, cursor: "pointer",
});
globalStyle(`${container} button:disabled`, { opacity: .5, cursor: "default" });
globalStyle(`${container} :focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" });

export const actions = style({
    display: "flex", flexWrap: "wrap", flexShrink: 0, alignItems: "center", justifyContent: "space-between", gap: "1rem",
});
globalStyle(`${actions} span`, { minWidth: 0, overflowWrap: "anywhere" });
globalStyle(`${actions} button`, { flexShrink: 0 });

export const length_warning = style({
    display: "flex", flexWrap: "wrap", flexShrink: 0, alignItems: "baseline", gap: ".2rem 1rem", padding: ".6rem 1.2rem", fontSize: "1.3rem", lineHeight: 1.5,
    color: vars.vox_state_warning, background: vars.vox_warning_tint, borderRadius: vars.vox_radius,
});
export const length_count = style({ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });
