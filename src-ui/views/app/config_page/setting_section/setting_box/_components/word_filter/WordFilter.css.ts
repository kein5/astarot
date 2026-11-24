import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// The entry and the list start on the row's left edge, under the item label (#437).
export const container = style({
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "stretch",
    flexDirection: "column",
    gap: "1.2rem",
    width: "100%",
});

export const list_section_wrapper = style({
    display: "flex",
    justifyContent: "flex-start",
    flexWrap: "wrap",
    width: "100%",
    gap: "0.6rem",
    overflowY: "auto",
    maxHeight: "20rem",
});

// The list with no word: a quiet line in the fold.
export const empty = style({
    margin: 0,
    fontSize: "1.4rem",
    color: vars.vox_description_text,
});

export const item_wrapper = style({
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "0.4rem",
    backgroundColor: vars.dark_800_color,
    padding: "0.2rem 0.2rem 0.2rem 1rem",
    borderRadius: "0.4rem",
});
export const item_text = style({
    fontSize: "1.4rem",
    fontWeight: 300,
});

// Each word's delete is the kit's danger icon Button (WordFilter.tsx); the mark takes its red.
export const delete_svg = style({ width: "2.4rem" });

export const entry_section_wrapper = style({
    display: "flex",
    flexWrap: "wrap",
    width: "100%",
    minWidth: 0,
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "0.8rem",
});
// Let the entry give space to Add, or put Add on the next line.
globalStyle(`${entry_section_wrapper} > :first-child`, { flex: "1 1 18rem", minWidth: 0, maxWidth: "30rem" });

// Add is the kit's primary Button (WordFilter.tsx), which draws it; beside the entry it keeps its
// width and goes to the next line when the row is narrow.
export const add_button = style({ flexShrink: 0 });
