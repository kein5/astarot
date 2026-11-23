import { style } from "@vanilla-extract/css";

export const list = style({
    flexShrink: 0,
    minWidth: 0,
});

export const row = style({
    display: "grid",
    columnGap: "8px",
    // Padding is included in virtua's row measurement; external margins are not.
    paddingBottom: "8px",
});
