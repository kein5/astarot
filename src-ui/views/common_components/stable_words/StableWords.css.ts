import { style, styleVariants } from "@vanilla-extract/css";

// Every word in one grid cell, so the cell is as wide (and as high) as the longest of them.
export const stack = style({ display: "inline-grid" });

// The words not in use keep their space and are neither seen nor read. A shorter word sits in the
// middle of the longest one's space, or at its start (#912).
const word = style({
    gridArea: "1 / 1",
    selectors: { '&[aria-hidden="true"]': { visibility: "hidden" } },
});
export const wordAt = styleVariants({ center: [word, { justifySelf: "center" }], start: [word, { justifySelf: "start" }] });
