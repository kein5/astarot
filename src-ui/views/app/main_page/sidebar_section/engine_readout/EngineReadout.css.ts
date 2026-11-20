import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

// The readout at the head of the rail, in line with the switches under it (their container's
// side padding) and a little apart from the first of them.
export const readout = style({ margin: ".6rem 1rem 0" });

// The icon rail: the mark alone, centred where a switch's icon is.
export const compact = style({ display: "flex", justifyContent: "center", paddingTop: ".8rem" });

export const mark = style({
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "3.2rem",
    height: "3.2rem",
    borderRadius: vars.vox_radius,
    color: vars.vox_state_warning,
    selectors: {
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
    },
});

export const markSvg = style({ width: "2rem", height: "2rem", fill: "currentColor" });
