import { style } from "@vanilla-extract/css";

// The cards' layout, chosen at the top of a group of the catalog, at its end (#1266 ★17): the
// catalog has no heading line of its own any more.
export const layout_line = style({ display: "flex", justifyContent: "flex-end" });
