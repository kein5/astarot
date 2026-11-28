import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";
import { MAIN_SECTION_CONTAINER, shorterThan } from "../../layout.ts";

// A short window (the 200px minimum leaves 166px under the title bar) keeps the
// log readable: thinner margins, a one-line composer.
const SHORT = shorterThan(MAIN_SECTION_CONTAINER);

// The log and the composer. They take the column's whole width, so they grow with the window
// (#1223; the 120rem measure of the layout audit's L-11 left wide empty sides in a wide window).
export const container = style({
    height: "0%",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    padding: "1.2rem 2rem 2rem",
    "@container": { [SHORT]: { padding: ".4rem 1.2rem .8rem" } },
});

export const log_box_resize_wrapper = style({
    flex: 1,
    // Two lines of the log stay in sight when a panel above takes room.
    minHeight: "4.8rem",
    overflow: "auto",
    position: "relative",
    "@container": { [SHORT]: { minHeight: "2.4rem" } },
});

export const separator = style({
    position: "relative",
    width: "100%",
    height: "0.8rem",
    cursor: "row-resize",
    flexShrink: 0,
    "@container": { [SHORT]: { height: ".6rem" } },
});
export const separator_line = style({
    position: "absolute",
    bottom: "0%",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    height: "50%",
    width: "4rem",
    borderRadius: ".4rem",
    backgroundColor: vars.dark_750_color,
    transition: "background-color .15s ease-out",
    selectors: {
        [`${separator}:hover &`]: { backgroundColor: vars.primary_300_color },
    },
});

// The share of the column the user dragged it to (MessageInputBoxRatio).
export const message_box_resize_wrapper = style({
    height: "10%",
    minHeight: "6.4rem",
    maxHeight: "90%",
    "@container": { [SHORT]: { minHeight: "4.4rem" } },
});
