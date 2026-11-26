import { globalStyle, style } from "@vanilla-extract/css";

export const container = style({
    display: "flex",
    width: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "1rem",
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
});

// The field's own button keeps its width beside the field (#1231).
globalStyle(`${container} > [data-slot="button"]`, { flex: "0 0 auto" });
