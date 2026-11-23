import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const control_end = style({});
export const control_start = style({});
export const flex_column = style({});
export const remove_border_bottom = style({});
export const is_break_point = style({});

// 16rem label + 24rem field + 1.6rem gap: below that the field goes under its label; and a narrow window.
const stacked = { gridTemplateColumns: "minmax(0, 1fr)", alignItems: "stretch" } as const;

// One setting row: the label column and the field column, the same 1fr / 1.6fr split and
// 1.6rem gap as the form rows (FormRow), so a field starts at the same place on every page
// (#567). The field fills its column unless it holds a short value (DESIGN.md, "Field widths").
// No side padding: the label starts on the section heading's edge and the control ends on the
// content's edge.
export const container = style({
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
    width: "100%",
    alignItems: "center",
    padding: "2rem 0",
    columnGap: "1.6rem",
    rowGap: ".8rem",
    minWidth: 0,
    selectors: {
        [`&.${flex_column}`]: { gridTemplateColumns: "minmax(0, 1fr)" },
        [`&:not(.${remove_border_bottom})`]: { borderBottom: `solid 0.1rem ${vars.dark_800_color}` },
        [`&.${is_break_point}`]: { gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" },
    },
    "@container": { "(max-width: 41.6rem)": stacked },
    "@media": { "(max-width: 700px)": stacked },
});
globalStyle(`${container} > *`, { minWidth: 0, maxWidth: "100%" });
globalStyle(`${container} > :nth-child(2)`, { justifySelf: "stretch" });
// A row without a label (the word list, the message format's fields) spans both columns.
globalStyle(`${container} > :only-child`, { gridColumn: "1 / -1" });
globalStyle(`${container}.${control_end} > :nth-child(2)`, { justifySelf: "end" });
globalStyle(`${container}.${control_start} > :nth-child(2)`, { justifySelf: "start" });
