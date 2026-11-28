import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// The windows the launcher's "More windows" button opens (#1314, V-4): one row each, its mark and
// its name. Inside a VR window nothing opens a tooltip, so the name is on the row (DESIGN.md).
export const body = style({ display: "flex", flexDirection: "column", gap: "16px", padding: "24px", boxSizing: "border-box", width: "100%", height: "100%" });
export const row = style({});
globalStyle(row, {
    display: "flex", alignItems: "center", gap: "24px", width: "100%", minHeight: "120px", padding: "0 28px",
    borderRadius: "16px", background: vars.dark_850_color, color: vars.dark_basic_text_color, fontSize: "22px", fontWeight: 600,
    textAlign: "left",
});
globalStyle(`${row}:focus-visible`, { outline: `3px solid ${vars.primary_100_color}`, outlineOffset: "-3px" });
globalStyle(`${row}[data-vr-hover]`, { background: vars.dark_800_color });
export const icon = style({ width: "56px", height: "56px", flexShrink: 0, color: "currentColor", fill: "currentColor" });
