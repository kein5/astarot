import { style } from "@vanilla-extract/css";

// The three presets (PresetTabSelector.tsx), the kit's ToggleGroup, at the end of the heading's
// row: they keep their size and the heading takes what is left.
export const container = style({
    flex: "none",
});

// Each number keeps its width while numbers of other widths are drawn.
export const tab = style({
    fontVariantNumeric: "tabular-nums",
});
