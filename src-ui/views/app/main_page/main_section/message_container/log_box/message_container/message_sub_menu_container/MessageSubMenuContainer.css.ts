import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../../theme/vars.css.ts";

// *******************                           *******************
// ******************* Express in "em" not "rem" *******************
// *******************                           *******************
export const is_shown = style({});
// Always rendered so the keyboard can reach the button. Until the message is
// hovered or the button has focus it takes no width (the negative margin
// cancels the row gap), as when it was not rendered at all.
export const container = style({
    selectors: {
        [`&:not(.${is_shown}):not(:focus-within)`]: {
            width: 0,
            marginLeft: "-0.6rem",
            overflow: "hidden",
        },
    },
});
export const resend_button = style({
    backgroundColor: vars.dark_825_color,
    position: "relative",
    height: "100%",
    width: "3.8em",
});

export const send_message_svg = style({
    position: "absolute",
    top: "58%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "2.2em",
    color: vars.dark_400_color,
});
export const refresh_svg = style({
    position: "absolute",
    top: "36%",
    left: "42%",
    transform: "translate(-50%, -50%)",
    width: "1.8em",
    color: vars.sent_400_color,
    filter: `drop-shadow(0.2em 0.2em 0 ${vars.dark_825_color})`,
});

export const hold_progress_bar = style({
    position: "absolute",
    top: "10%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "0%",
    height: "0.4em",
    backgroundColor: vars.sent_400_color,
    transition: "none",
});
