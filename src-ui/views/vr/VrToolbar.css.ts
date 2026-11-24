import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

export const is_pending = style({});
export const is_disabled = style({});
export const icon = style({});

export const bar = style({ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", padding: "2px 12px", borderRadius: "24px", background: vars.dark_888_color, boxShadow: `inset 0 0 0 4px ${vars.dark_750_color}` });
export const group = style({ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 });
export const button = style({ position: "relative", height: "72px", flexDirection: "column", gap: "4px", padding: "2px",
    selectors: {
        "&:focus-visible": { outline: `3px solid ${vars.primary_100_color}`, outlineOffset: "-3px" },
        [`&.${is_pending}`]: { cursor: "wait", boxShadow: `inset 0 0 0 3px ${vars.primary_200_color}` },
        [`&.${is_disabled}`]: { background: vars.dark_900_color, color: vars.dark_450_color, cursor: "default" },
    },
});
export const anchor_button = style({ width: "62px" });
export const recall_button = style({ width: "72px" });
export const lock_button = style({ width: "64px" });
export const font_button = style({ width: "56px", fontSize: "26px", fontWeight: 700 });
export const opacity_button = style({ width: "80px" });
globalStyle(`${opacity_button} ${icon}`, { width: "26px", height: "26px" });
globalStyle(icon, { width: "36px", height: "36px", flexShrink: 0, fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" });
export const hand_side = style({ position: "absolute", right: "7px", bottom: "5px", fontSize: "16px", fontWeight: 700 });
export const value = style({ width: "32px", fontSize: "22px", fontWeight: 700, fontVariantNumeric: "tabular-nums", textAlign: "center", color: vars.dark_basic_text_color });
export const opacity_value = style({ fontSize: "22px", fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 });
