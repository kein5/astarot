import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// 16rem label + 18rem control + 1.6rem gap at the current UI scale; and a narrow window.
const STACKED = "(max-width: 35.6rem)";
const NARROW_WINDOW = "(max-width: 700px)";
const stackedRow = { gridTemplateColumns: "minmax(0, 1fr)", gap: ".8rem" } as const;

// Same columns as the label rows on the voice pages, so both read as one grammar.
export const row = style({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
    gap: "1.6rem",
    alignItems: "start",
    padding: ".4rem 0",
    minWidth: 0,
    overflowWrap: "anywhere",
    "@container": { [STACKED]: stackedRow },
    "@media": { [NARROW_WINDOW]: stackedRow },
});

export const text = style({
    display: "grid",
    gap: ".4rem",
    minWidth: 0,
    paddingTop: ".9rem",
    "@container": { [STACKED]: { paddingTop: 0 } },
    "@media": { [NARROW_WINDOW]: { paddingTop: 0 } },
});

// Item label role; page styles for plain <label> rows must not apply here.
export const label = style({
    selectors: {
        [`${row} &`]: {
            display: "block",
            padding: 0,
            fontSize: "1.4rem",
            fontWeight: 500,
            lineHeight: 1.5,
            color: vars.dark_200_color,
            textWrap: "pretty",
        },
    },
});

// The label and its hint mark on one line (#614).
export const label_line = style({ display: "flex", alignItems: "center", minWidth: 0 });

// General description role.
export const description = style({
    selectors: {
        [`${row} &`]: { fontSize: "1.2rem", lineHeight: 1.6, color: vars.vox_description_text, margin: 0 },
    },
});

export const control = style({ display: "grid", gap: ".8rem", justifyItems: "end", minWidth: 0 });
globalStyle(`${control} > input:not([type="checkbox"]), ${control} > textarea`, { width: "100%" });
// Dropdowns stay compact to fit their content at the row's right end rather than stretching full width (#1096).
// The kit's Select is its wrapper, which the field fills: the wrapper takes the width.
globalStyle(`${control} > select, ${control} > [data-slot="native-select-wrapper"]`, { width: "fit-content", minWidth: "min(20rem, 100%)", maxWidth: "min(32rem, 100%)" });

export const group = style({ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: ".8rem" });
