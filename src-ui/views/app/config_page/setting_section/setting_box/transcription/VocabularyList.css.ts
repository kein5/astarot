import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The dictionary's terms (#792): a bar of the app's one fold (_components/fold/Fold.css.ts) under
// the switch of the built-in terms. The bar says how many terms are in use.

// A new term: its written form, its readings and the button, on one line while they fit.
export const add = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: ".8rem 1.2rem",
});

export const addField = style({
    display: "grid",
    gap: ".4rem",
    flex: "1 1 16rem",
    minWidth: 0,
});

// Each field's name above it, not beside it as the settings page lays out its other labels: the
// two fields and the button make one line of their own.
globalStyle(`${add} ${addField}`, {
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: ".4rem",
});

// The rows are the kit's compact Item list (views/kit/Item.tsx), which draws them: the written
// form, its readings and the row's buttons, and the state of each by its look.

// The readings being changed, in their place in the row: the field and its two buttons, the
// reason under them. The row's buttons are put away meanwhile, so the field takes their room too.
export const edit = style({
    display: "grid",
    gap: ".4rem",
    minWidth: 0,
});

export const editLine = style({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".6rem",
});

// A term without a reading: said in words, quieter than the readings of the others.
export const none = style({
    color: fallbackVar(vars.vox_description_text, "#9daec6"),
});

export const problem = style({
    color: fallbackVar(vars.vox_state_warning, "#cb944f"),
});
