import { globalStyle, style } from "@vanilla-extract/css";

export const container = style({
    display: "flex",
    flexWrap: "wrap",
    flexShrink: 0,
    gap: ".8rem",
    padding: ".8rem 1.6rem",
});
globalStyle(`${container} p`, { margin: 0 });
globalStyle(`${container} button`, {
    font: "inherit",
    fontWeight: 500,
    color: "inherit",
    background: "transparent",
    border: "1px solid currentColor",
    borderRadius: ".4rem",
    padding: ".6rem",
    cursor: "pointer",
});
globalStyle(`${container} button:focus-visible`, { outline: "2px solid currentColor", outlineOffset: "3px" });

export const source = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem",
});
