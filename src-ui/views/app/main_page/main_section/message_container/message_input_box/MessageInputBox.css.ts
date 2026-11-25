import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, shorterThan } from "../../../layout.ts";

// A short column keeps a one-line composer (MessageContainer): less padding, so the line fits.
const SHORT = shorterThan(MAIN_SECTION_CONTAINER);

export const container = style({
    height: "100%",
    display: "flex",
    gap: "1rem",
});

// The composer's frame (DESIGN.md: the composer's larger radius). The field inside is the kit's
// Textarea without a frame of its own (inFrame), so the frame also sets the size of its words.
export const message_box_wrapper = style({
    width: "100%",
    height: "100%",
    padding: "1.2rem 1.4rem",
    backgroundColor: vars.vox_surface,
    border: `0.1rem solid ${vars.dark_750_color}`,
    borderRadius: "1.2rem",
    fontSize: "1.6rem",
    selectors: {
        "&:focus-within": { borderColor: vars.primary_300_color },
    },
    "@container": { [SHORT]: { padding: ".6rem 1.2rem", fontSize: "1.5rem" } },
});

// The field fills the frame, whose height is the share of the column the user dragged it to.
export const message_box_input_area = style({
    height: "100%",
    selectors: {
        // A short box at a large UI size: the hint stays on one line, and an empty box
        // shows no scrollbar for it.
        "&::placeholder": { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        "&:placeholder-shown": { overflowY: "hidden" },
    },
});

// Square, at most 10rem, at the foot of a tall composer (where typing ends)
// instead of stretching to the composer's height.
export const message_send_button = style({
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "flex-end",
    maxWidth: "10rem",
    height: "min(100%, 10rem)",
    fontSize: "1.2rem",
    backgroundColor: vars.primary_600_color,
    borderRadius: "1.2rem",
    aspectRatio: "1 / 1",
    selectors: {
        "&:hover": { backgroundColor: vars.primary_550_color },
        "&:active": { backgroundColor: vars.primary_700_color },
    },
});

export const message_send_icon = style({
    width: "2rem",
    color: vars.vox_on_primary,
});
