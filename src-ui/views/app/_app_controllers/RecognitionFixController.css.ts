import { style } from "@vanilla-extract/css";

// The language's own action sits under its field, before the model offer, so it is in sight
// without scrolling past the catalog's card (#1225).
export const languageAction = style({
    display: "flex",
    justifyContent: "flex-end",
    marginTop: ".8rem",
});
