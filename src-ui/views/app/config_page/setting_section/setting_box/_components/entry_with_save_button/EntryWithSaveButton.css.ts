import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    width: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "1rem",
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
});

// A field that saves by itself (#1111): the field, and under it what is wrong with its value.
export const field = style({
    display: "grid",
    gap: ".8rem",
    width: "100%",
    minWidth: 0,
});

// The field's edge says it too, beside the words (the log destination's look, #1115).
globalStyle(`${field}[data-invalid="true"] :has(> [data-slot="input"])`, {
    borderColor: vars.vox_state_failed,
});

export const error = style({
    margin: 0,
    padding: ".8rem 1.2rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.dark_200_color,
    backgroundColor: vars.vox_surface,
    border: `.1rem solid ${vars.vox_state_failed}`,
    borderRadius: vars.vox_radius,
    overflowWrap: "anywhere",
});
