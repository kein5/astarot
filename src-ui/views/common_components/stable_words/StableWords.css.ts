import { style } from "@vanilla-extract/css";

// Every word in one grid cell, so the cell is as wide (and as high) as the longest of them.
export const stack = style({ display: "inline-grid" });

// The words not in use keep their space and are neither seen nor read. A shorter word sits in the
// middle of the longest one's space (#912).
export const word = style({
    gridArea: "1 / 1",
    justifySelf: "center",
    selectors: { '&[aria-hidden="true"]': { visibility: "hidden" } },
});
