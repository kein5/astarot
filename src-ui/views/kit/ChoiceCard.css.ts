import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";
import { colourTransition, disabledLook, focusRing } from "./shared.css.ts";

// A choice drawn as a card (U-07 of docs/design/components/hand-built-inventory.md): what the card
// shows of the choice over its name, on the raised surface with a hairline frame. The look is the
// one the theme tiles of Settings → Appearance had (#965). The choice in use carries the accent
// frame and a check after its name, so it is told by shape as well as by colour. The card is as
// wide as its place; the screen sets the width.

// The native radio stays the control (D-16): it takes the focus, the arrow keys of its group and
// the screen reader's words, out of sight.
export const radio = style({
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
});

export const card = style({
    position: "relative",
    boxSizing: "border-box",
    display: "grid",
    gap: ".6rem",
    minWidth: 0,
    padding: ".6rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    color: vars.dark_basic_text_color,
    cursor: "pointer",
    transition: colourTransition,
    selectors: {
        // Under the pointer, a lighter frame; the accent frame of the choice in use stays (its rule
        // below is the more specific).
        "&:hover": { borderColor: vars.vox_field_border },
        // In use: the accent frame, as thick as the focus ring, inside the card so nothing moves.
        "&:has(> input:checked)": { borderColor: vars.primary_600_color, boxShadow: `inset 0 0 0 .1rem ${vars.primary_600_color}` },
        // Keyboard focus is on the hidden radio; the ring goes round the card it stands for.
        "&:has(> input:focus-visible)": focusRing,
        "&:has(> input:disabled)": disabledLook,
    },
});

export const title = style({
    display: "flex",
    alignItems: "center",
    gap: ".4rem",
    minWidth: 0,
    fontSize: "1.3rem",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
});

// After the name of the choice in use only.
export const check = style({
    display: "none",
    width: "1.4rem",
    height: "1.4rem",
    flexShrink: 0,
    fill: vars.vox_state_active,
    selectors: {
        [`${card}:has(> input:checked) &`]: { display: "block" },
    },
});
