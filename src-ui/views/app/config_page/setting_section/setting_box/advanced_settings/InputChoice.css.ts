import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The menu of a recognition model's "Use this model" (InputChoice.tsx): its two items one under the
// other, as wide as the longer of them, on the Popover's tight inset, as the quick settings panel's
// rows are. A long Japanese label wraps inside its item, and the menu stays in the window.
export const menu = style({
    display: "grid",
    gap: ".4rem",
    width: "max-content",
    minWidth: "min(20rem, calc(100vw - 4rem))",
    maxWidth: "min(32rem, calc(100vw - 4rem))",
});

// Each item fills the menu's width, its words at the start, as a menu's rows read.
export const item = style({
    justifyContent: "flex-start",
    width: "100%",
    textAlign: "start",
});

// Why the items wait, above them: the description's size and colour, with the items' room at its sides.
export const waiting = style({
    margin: ".4rem .8rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
});
