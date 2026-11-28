import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";
import { colourTransition, focusRing } from "../../../../kit/shared.css.ts";

export const container = style({
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 25,
    backgroundColor: vars.dark_875_color,
    // The top bar, then the list taking what is left: the list's scrollbar ends
    // at the frame's foot.
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
});

export const language_list_scroll_wrapper = style({
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: "1rem 1rem 2.4rem 1.6rem",
});

export const language_list = style({
    columnCount: "auto",
    columnWidth: "16rem",
});

// A language: a row of the grid, with no fill or frame until the pointer is on it (U-01 stays
// hand-built, D-36). Its fill under the pointer is the kit's (shadcn/ui's accent), and so are its
// corners and its focus ring.
export const language_button = style({
    breakInside: "avoid-column",
    overflowWrap: "anywhere",
    display: "block",
    width: "100%",
    textAlign: "left",
    border: 0,
    borderRadius: vars.vox_radius,
    background: "none",
    color: "inherit",
    font: "inherit",
    padding: "0.8rem 0.6rem",
    cursor: "pointer",
    transition: colourTransition,
    selectors: {
        "&:hover": { backgroundColor: vars.vox_secondary_hover },
        "&:active": { backgroundColor: vars.dark_925_color },
        "&:focus-visible": focusRing,
    },
});

export const language_label = style({
    fontSize: "1.4rem",
});

// Stays above the list while it scrolls (offsets the wrapper's top padding).
export const filter_row = style({
    position: "sticky",
    top: "-1rem",
    zIndex: 1,
    padding: "1rem 0 1.2rem",
    marginTop: "-1rem",
    backgroundColor: vars.dark_875_color,
});

// The filter is the kit's TextField; the row gives it only its width.
export const filter = style({ maxWidth: "32rem" });

// What the language is for (#569): one line under the search field, in the description colour.
export const hint = style({
    marginTop: ".6rem",
    maxWidth: "64rem",
    fontSize: "1.2rem",
    lineHeight: 1.5,
    color: vars.vox_description_text,
});
