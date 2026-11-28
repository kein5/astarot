import { style } from "@vanilla-extract/css";

// As compact as the row's select fields (#1096, DropdownMenu.css.ts): as wide as its longest
// choice within these bounds, at the row's right end.
export const container = style({
    width: "fit-content",
    minWidth: "min(20rem, 100%)",
    maxWidth: "min(32rem, 100%)",
});
