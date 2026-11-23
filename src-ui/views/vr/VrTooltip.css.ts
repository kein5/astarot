import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

export const sr_only = style({ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" });
export const marker = style({ position: "absolute", left: 0, top: 0, width: "320px", height: "8px", display: "flex", pointerEvents: "none" });
globalStyle(`${marker} span`, { width: "4px", height: "8px", flexShrink: 0 });
export const body = style({
    position: "absolute", top: "8px", left: 0, width: "360px", padding: "10px 14px",
    borderRadius: "12px", background: vars.dark_850_color, color: vars.dark_basic_text_color,
    boxShadow: `inset 0 0 0 2px ${vars.dark_600_color}`, pointerEvents: "none", overflowWrap: "anywhere",
    selectors: {
        "&::after": { content: '""', position: "absolute", left: "calc(var(--tip-arrow) - 6px)", bottom: "-6px", width: "12px", height: "6px", clipPath: "polygon(0 0, 100% 0, 50% 100%)", background: vars.dark_850_color },
    },
});
globalStyle(`${body} p`, { margin: "5px 0 0", fontSize: "16px", lineHeight: "20px", color: vars.dark_350_color });
export const title = style({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", lineHeight: "22px" });
globalStyle(`${title} strong`, { fontSize: "16px", fontWeight: 600 });
globalStyle(`${title} span`, { fontSize: "16px", color: vars.primary_100_color, textAlign: "right" });
