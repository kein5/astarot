import { vars } from "../theme/vars.css.ts";

// Pieces every control of the kit shares (#452). They are plain objects, not classes, so each
// recipe puts them where it needs them.

// Keyboard focus: a light lilac ring outside the control, visible on the canvas, the rail and
// the surface (brandPalette.test.js checks 3:1 on all three).
export const focusRing = {
    outline: `.2rem solid ${vars.vox_focus}`,
    outlineOffset: ".2rem",
} as const;

// Colour changes follow DESIGN.md "Motion"; root.css shortens every transition for reduced motion.
export const colourTransition = [
    `background-color ${vars.vox_motion_fast} ${vars.vox_ease}`,
    `border-color ${vars.vox_motion_fast} ${vars.vox_ease}`,
    `color ${vars.vox_motion_fast} ${vars.vox_ease}`,
].join(", ");

// A control that cannot be used keeps its place and its words, only dimmer.
export const disabledLook = {
    cursor: "not-allowed",
    opacity: .55,
} as const;
