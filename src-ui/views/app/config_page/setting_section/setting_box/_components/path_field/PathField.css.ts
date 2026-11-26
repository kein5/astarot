import { globalStyle, style } from "@vanilla-extract/css";

// A path field fills the field column beside its own button (DESIGN.md "Field widths", #1231),
// and its problem goes under both.
export const path_field = style({ justifySelf: "stretch" });

// The field takes the line; the button keeps its width at the line's right end, which is the
// row's right edge. A column too narrow for both puts the button under the field, at the same edge.
export const line = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: ".8rem",
    minWidth: 0,
});
globalStyle(`${line} > [data-slot="input"]`, { flex: "1 1 18rem", width: "auto", minWidth: 0 });
// The file's and the folder's buttons take one width, so the fields of rows one above the other end
// on one line too (the voice changer's runtime folder over its model file).
globalStyle(`${line} > [data-slot="button"]`, { flex: "0 0 auto", minWidth: "15rem" });
