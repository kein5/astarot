import { style } from "@vanilla-extract/css";

export const container = style({
    display: "flex",
    width: "100%",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "1rem",
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
});
