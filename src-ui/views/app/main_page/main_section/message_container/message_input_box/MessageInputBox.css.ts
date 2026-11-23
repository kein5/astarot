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

export const message_box_wrapper = style({
    width: "100%",
    height: "100%",
    padding: "1.2rem 1.4rem",
    backgroundColor: vars.vox_surface,
    border: `0.1rem solid ${vars.dark_750_color}`,
    borderRadius: "1.2rem",
    selectors: {
        "&:focus-within": { borderColor: vars.primary_300_color },
    },
    "@container": { [SHORT]: { padding: ".6rem 1.2rem" } },
});

export const message_box_input_area = style({
    width: "100%",
    height: "100%",
    fontSize: "1.6rem",
    resize: "none",
    selectors: {
        // A short box at a large UI size: the hint stays on one line, and an empty box
        // shows no scrollbar for it.
        "&::placeholder": { color: vars.dark_450_color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        "&:placeholder-shown": { overflowY: "hidden" },
    },
    "@container": { [SHORT]: { fontSize: "1.5rem" } },
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
