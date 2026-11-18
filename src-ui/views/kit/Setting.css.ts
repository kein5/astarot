import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";

// Where one setting ends and the next begins (#452, the maintainer's note of 2026-11-17).
// Three steps of separation, from strongest to weakest:
// 1. groups: a subheading and 3.2rem of space before the next group (DESIGN.md: groups inside
//    a section are separated by space and a subheading, not by nested borders);
// 2. rows: a hairline in the border colour between two rows of the same group;
// 3. inside a row: the label and its description sit together, the control beside them.
// The group is the container its rows measure, so a narrow settings column stacks them.

export const group = style({
    containerType: "inline-size",
    minWidth: 0,
    selectors: { "& + &": { marginTop: "3.2rem" } },
});

export const groupHead = style({
    display: "grid",
    gap: ".4rem",
    paddingBottom: ".8rem",
});

export const groupTitle = style({
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 600,
    lineHeight: 1.4,
    color: vars.dark_basic_text_color,
    textWrap: "balance",
});

export const groupDescription = style({
    margin: 0,
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
});

export const rows = style({ display: "grid", minWidth: 0 });

export const row = recipe({
    base: {
        position: "relative",
        display: "grid",
        gap: "1.6rem",
        minWidth: 0,
        padding: "1.2rem 0",
        overflowWrap: "anywhere",
        selectors: {
            [`${rows} > & + &`]: { borderTop: `.1rem solid ${vars.vox_border}` },
            // A changed, unsaved row: the short lilac rule of the save bar (DESIGN.md), just
            // outside the row so the label does not move.
            "&[data-changed='true']::before": {
                content: "",
                position: "absolute",
                insetInlineStart: "-1.2rem",
                top: "1.2rem",
                bottom: "1.2rem",
                width: ".3rem",
                borderRadius: ".2rem",
                background: vars.vox_readout_rule,
            },
        },
    },
    variants: {
        layout: {
            // A field that wants room: the label column and a wider control column. In a narrow
            // column the field goes under its label (DESIGN.md: field labels stack below 700px).
            field: {
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)",
                alignItems: "start",
                "@container": {
                    // 16rem of label, 18rem of control and the gap, as in FormRow.
                    "(max-width: 35.6rem)": { gridTemplateColumns: "minmax(0, 1fr)", gap: ".8rem" },
                },
                "@media": {
                    "(max-width: 700px)": { gridTemplateColumns: "minmax(0, 1fr)", gap: ".8rem" },
                },
            },
            // A switch or a single button: the control keeps its size at the row's end, also
            // in a narrow column, so the switch stays beside the words it turns on.
            inline: { gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" },
        },
    },
    defaultVariants: { layout: "field" },
});

export const rowText = style({ display: "grid", gap: ".4rem", minWidth: 0 });

export const rowLabel = style({
    fontSize: "1.4rem",
    fontWeight: 500,
    lineHeight: 1.5,
    color: vars.dark_200_color,
    textWrap: "pretty",
    cursor: "default",
});

export const rowDescription = style({
    margin: 0,
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    whiteSpace: "pre-line",
});

export const rowControl = style({ display: "grid", gap: ".8rem", justifyItems: "start", minWidth: 0 });
