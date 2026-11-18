import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";
import { colourTransition, disabledLook, focusRing } from "./shared.css.ts";

// On and off for a setting that applies as soon as it is saved (#436 "オンとオフの部品が2種類").
// The state is told three ways: the thumb's side, the track's fill, and the row's label, which
// names what is on; colour is never the only sign.
export const root = style({
    all: "unset",
    boxSizing: "border-box",
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    width: "4.4rem",
    height: "2.4rem",
    borderRadius: "999rem",
    // Off: a dark track whose border reaches 3:1 on the canvas and the surface.
    background: vars.dark_850_color,
    border: `.1rem solid ${vars.dark_650_color}`,
    cursor: "pointer",
    transition: colourTransition,
    selectors: {
        "&:hover:not([data-disabled])": { borderColor: vars.dark_550_color },
        "&[data-state='checked']": { background: vars.primary_600_color, borderColor: vars.primary_600_color },
        "&[data-state='checked']:hover:not([data-disabled])": { background: vars.primary_550_color, borderColor: vars.primary_550_color },
        "&:focus-visible": focusRing,
        "&[data-disabled]": disabledLook,
    },
});

export const thumb = style({
    display: "block",
    width: "1.8rem",
    height: "1.8rem",
    borderRadius: "50%",
    background: vars.dark_300_color,
    transform: "translateX(.2rem)",
    transition: `transform ${vars.vox_motion_fast} ${vars.vox_ease}, background-color ${vars.vox_motion_fast} ${vars.vox_ease}`,
    selectors: {
        // On the Lilac track the thumb is Dark Plum, like text on a Lilac fill.
        "&[data-state='checked']": { transform: "translateX(2.2rem)", background: vars.vox_on_primary },
    },
});
