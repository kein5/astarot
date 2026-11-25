import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

export const container = style({
    display: "flex", flexDirection: "column", gap: "1.2rem", padding: "1.6rem", height: "100%", boxSizing: "border-box", overflow: "auto",
    background: vars.vox_canvas, color: vars.dark_basic_text_color, fontSize: "1.4rem",
});
// The message field is the kit's Textarea, filling the window above the actions (fill): the
// window's height sets its height, and the window grows for the length warning so that the field
// never gets smaller.
export const field = style({ flex: 1 });
// The kit's parts (data-slot) draw their own focus ring.
globalStyle(`${container} :focus-visible:not([data-slot])`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" });

export const actions = style({
    display: "flex", flexWrap: "wrap", flexShrink: 0, alignItems: "center", justifyContent: "space-between", gap: "1rem",
});
globalStyle(`${actions} span`, { minWidth: 0, overflowWrap: "anywhere" });
// Send is the kit's primary Button; the row keeps it whole beside the hint, which wraps instead.
export const send = style({ flexShrink: 0 });

export const length_warning = style({
    display: "flex", flexWrap: "wrap", flexShrink: 0, alignItems: "baseline", gap: ".2rem 1rem", padding: ".6rem 1.2rem", fontSize: "1.3rem", lineHeight: 1.5,
    color: vars.vox_state_warning, background: vars.vox_warning_tint, borderRadius: vars.vox_radius,
});
export const length_count = style({ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });
