import { style } from "@vanilla-extract/css";

// An unavailable button takes no pointer, as before the kit; the kit's Button draws it dimmed.
export const is_disabled = style({ pointerEvents: "none" });

export const add_remove_target_language_container = style({
    width: "100%",
    display: "flex",
    justifyContent: "end",
    alignItems: "center",
    gap: ".2rem",
    padding: "0 .2rem",
});

// The remove and add buttons are the kit's icon Button (AddRemoveTargetLanguageButtons.tsx), which
// draws them; the marks stay small inside them, in the button's words color.
export const icon = style({ width: "0.8rem" });
