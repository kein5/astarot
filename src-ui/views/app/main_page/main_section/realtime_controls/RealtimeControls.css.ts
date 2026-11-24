import { globalStyle, style } from "@vanilla-extract/css";

export const container = style({
    display: "flex",
    flexWrap: "wrap",
    flexShrink: 0,
    gap: ".8rem",
    padding: ".8rem 1.6rem",
});
globalStyle(`${container} p`, { margin: 0 });
// Each source's stop is the kit's plain Button (RealtimeControls.tsx), which draws it.

export const source = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem",
});
