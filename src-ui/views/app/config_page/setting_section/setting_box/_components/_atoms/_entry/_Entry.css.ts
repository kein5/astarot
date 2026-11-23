import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../../theme/vars.css.ts";

export const is_activated = style({});
export const is_disabled = style({});

export const entry_container = style({
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
});

// The same field as the kit's TextField and the forms' inputs (DESIGN.md "input", shadcn/ui's
// Input): the surface, the field border (3.5:1 against it), the control radius and 4rem of height.
export const entry_wrapper = style({
    display: "flex",
    minHeight: "4rem",
    backgroundColor: vars.vox_surface,
    border: `0.1rem solid ${vars.vox_field_border}`,
    borderRadius: vars.vox_radius,
    selectors: {
        [`&.${is_activated}`]: { borderColor: vars.primary_400_color },
    },
});

export const entry_input_area = style({
    // Stretched to the box's height, so a click anywhere in the box reaches the input.
    flex: "1 1 auto",
    width: "100%",
    minWidth: 0,
    padding: "0.6rem",
    fontSize: "1.4rem",
    resize: "none",
    fontFamily: "inherit",
    // The focus ring is drawn around the input; its corners follow the box's.
    borderRadius: `calc(${vars.vox_radius} - 0.1rem)`,
    selectors: {
        [`&.${is_disabled}`]: { color: vars.dark_500_color, pointerEvents: "none" },
    },
});
