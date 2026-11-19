import { style } from "@vanilla-extract/css";

// The bulk add's buttons on one row, wrapping in a narrow window (#446).
export const actions = style({
    display: "flex",
    flexWrap: "wrap",
    gap: ".8rem",
});

// The field's name and its hint mark on one line (#614).
export const name = style({
    display: "flex",
    alignItems: "center",
    minWidth: 0,
});
