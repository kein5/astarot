import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";
import { disabledLook } from "./shared.css.ts";

// The searchable choice (Combobox.tsx): the button is the kit's select field (Field.css.ts), and
// the panel the kit's popover with shadcn/ui's Command inside it: a search row over the list, rows
// of .8rem by 1.2rem as the select's own list, headings in the description's size and colour.

// A <button> in the field's clothes: its words start at its left and are cut at its edge, the
// chevron keeps its room. Waiting or not usable, the button and its chevron are dimmed together.
export const trigger = style({
    position: "relative",
    display: "flex",
    alignItems: "center",
    textAlign: "start",
    selectors: {
        "&:is(:disabled, [aria-disabled='true'])": disabledLook,
        "&[aria-disabled='true']:hover": { borderColor: vars.vox_field_border },
    },
});

// Every choice's words in one cell, so the cell is as wide as the longest (StableWords' way); in a
// narrower field the words shown are cut at its edge.
export const value = style({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    flex: "1 1 auto",
    minWidth: 0,
});

const inCell = { gridArea: "1 / 1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

export const sizer = style({ ...inCell, visibility: "hidden" });

export const shown = style(inCell);

// Nothing chosen: the words a placeholder has.
export const placeholder = style({ color: vars.vox_description_text });

// At least as wide as the button and wide enough for the longest choice on one line, within the
// window; no taller than the room the window leaves, the list scrolling inside.
export const content = style({
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    width: "max-content",
    minWidth: "var(--radix-popover-trigger-width)",
    maxWidth: "min(36rem, calc(100vw - 2.4rem))",
    maxHeight: "min(40rem, var(--radix-popover-content-available-height))",
});

export const command = style({
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    flex: "1 1 auto",
});

// The search row, divided from the list by a hairline (shadcn/ui's CommandInput). The keys are in
// its field whenever the panel is open, so the hairline becomes the focus colour, twice as thick,
// in place of a ring round a field that has no frame; drawn as a shadow, it moves nothing.
export const searchRow = style({
    display: "flex",
    alignItems: "center",
    gap: ".8rem",
    padding: "0 .8rem",
    marginBottom: ".4rem",
    boxShadow: `inset 0 -.1rem 0 ${vars.vox_border}`,
    selectors: { "&:focus-within": { boxShadow: `inset 0 -.2rem 0 ${vars.vox_focus}` } },
});

export const searchIcon = style({
    flex: "none",
    width: "1.6rem",
    height: "1.6rem",
    color: vars.vox_secondary_text,
});

// The field has no frame of its own inside the panel; the row shows where the keys are.
export const search = style({
    flex: "1 1 auto",
    minWidth: 0,
    height: "4rem",
    padding: 0,
    border: 0,
    background: "transparent",
    color: vars.dark_basic_text_color,
    font: "inherit",
    fontSize: "1.4rem",
    selectors: {
        "&::placeholder": { color: vars.vox_description_text, opacity: 1 },
        "&:focus-visible": { outline: "none" },
    },
});

// The rows scroll here, not the page; the rows' places are measured from it (keepInSight).
export const list = style({
    position: "relative",
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
});

export const group = style({
    selectors: { "& + &": { marginTop: ".4rem" } },
});

export const heading = style({
    padding: ".6rem 1.2rem .4rem",
    fontSize: "1.2rem",
    fontWeight: 500,
    color: vars.vox_description_text,
});

// One choice. The active one (the keys' or the pointer's) has the select list's hover ground; the
// chosen one is lilac and bold with a check, as a select's chosen row; one that cannot be chosen is
// half as strong and takes no press.
export const item = style({
    display: "flex",
    alignItems: "center",
    gap: ".8rem",
    padding: ".8rem 1.2rem",
    borderRadius: ".4rem",
    color: vars.dark_200_color,
    fontSize: "1.4rem",
    lineHeight: 1.5,
    cursor: "pointer",
    userSelect: "none",
    selectors: {
        "&[aria-selected='true']": { background: vars.dark_800_color },
        "&[data-checked]": { color: vars.primary_200_color, fontWeight: 600 },
        "&[aria-disabled='true']": disabledLook,
    },
});

export const itemLabel = style({ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" });

export const check = style({
    flex: "none",
    width: "1.6rem",
    height: "1.6rem",
    visibility: "hidden",
    selectors: { [`${item}[data-checked] &`]: { visibility: "visible" } },
});

// No choice is kept: said where the rows were (shadcn/ui's CommandEmpty), and nothing otherwise.
export const empty = style({
    fontSize: "1.4rem",
    color: vars.vox_description_text,
    textAlign: "center",
    selectors: { "&:not(:empty)": { padding: "2.4rem 1.2rem" } },
});
