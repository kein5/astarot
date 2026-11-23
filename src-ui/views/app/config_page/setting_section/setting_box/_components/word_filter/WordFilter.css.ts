import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// `delete` is a word of the language, so the style is delete_; its class keeps the name delete.
export const delete_ = style({}, "delete");
export const redo = style({});

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

export const action_button = style({
    borderRadius: "0.4rem",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_750_color },
        "&:active": { backgroundColor: vars.dark_850_color },
        [`&.${delete_}`]: { padding: "0.2rem" },
        [`&.${delete_}:hover`]: { backgroundColor: vars.dark_825_color },
        [`&.${delete_}:active`]: { backgroundColor: vars.dark_850_color },
        [`&.${redo}`]: { padding: "0.6rem" },
    },
});

export const delete_svg = style({
    width: "2.4rem",
    color: vars.vox_state_failed,
});

export const redo_svg = style({
    width: "1.6rem",
    color: vars.dark_500_color,
});

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

export const add_button = style({
    minHeight: "4rem",
    padding: "0.8rem 1.2rem",
    backgroundColor: vars.primary_600_color,
    color: vars.vox_on_primary,
    fontSize: "1.4rem",
    fontWeight: 500,
    borderRadius: "var(--vox_radius, 0.8rem)",
    textAlign: "center",
    flexShrink: 0,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    selectors: {
        "&:hover": { backgroundColor: vars.primary_650_color },
        "&:active": { backgroundColor: vars.primary_700_color },
    },
});
