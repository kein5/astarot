import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";
import { loader as spinner } from "../../../../../../common_css/mixins.ts";

// *******************                           *******************
// ******************* Express in "em" not "rem" *******************
// *******************                           *******************

// The kinds of row and the states a row's parts carry: set on several of the parts at once.
export const sent_message = style({});
export const received_message = style({});
export const is_shown_resend_button = style({});
export const ocr_category = style({});
export const failed = style({});
export const not_sent = style({});
export const vrchat_off = style({});
// The same voices as the row above (#447): drawn close under it, as one run.
export const continues = style({});
export const system_message = style({
    justifyContent: "center",
    textAlign: "center",
});

export const container = style({
    width: "100%",
    display: "flex",
    userSelect: "text",
    gap: "0.6rem",
    selectors: {
        [`&.${sent_message}.${is_shown_resend_button}:hover`]: { backgroundColor: vars.dark_950_color },
    },
});

export const message_wrapper = style({
    display: "flex",
    width: "100%",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "end",
    userSelect: "text",
    padding: "0.6em 0",
    selectors: {
        [`&.${sent_message}`]: { alignItems: "end" },
        [`&.${received_message}`]: { alignItems: "start" },
        [`&.${system_message}`]: { flexDirection: "row", alignItems: "center", gap: "0.6rem" },
        [`&.${continues}`]: { paddingTop: 0 },
    },
});

export const info_box = style({
    position: "relative",
    display: "flex",
    maxWidth: "100%",
    gap: "0.8em",
    justifyContent: "center",
    selectors: {
        [`&.${sent_message}`]: { alignItems: "end" },
        [`&.${received_message}`]: { flexFlow: "row-reverse", alignItems: "start" },
    },
});

export const loader = style(spinner({ size: "0.8em", lineWidth: "0.1em", position: "left", positionAmount: "-1em" }));

export const time = style({
    flexShrink: 0,
    fontSize: "1em",
    color: vars.dark_600_color,
});

export const category = style({
    fontSize: "1em",
    selectors: {
        [`&.${sent_message}`]: { color: vars.sent_400_color },
        [`&.${received_message}`]: { alignItems: "start", color: vars.received_300_color },
        [`&.${ocr_category}`]: { color: vars.received_300_color },
        [`&.${failed}`]: { color: vars.vox_state_failed },
        [`&.${not_sent}`]: { color: vars.vox_state_warning },
        // The user's own setting, not a fault: quieter than a sent row, no warning colour.
        [`&.${vrchat_off}`]: { color: vars.vox_description_text },
        // Last, as in the SCSS: a system row's category outranks the kinds above.
        [`${system_message} &`]: { color: vars.primary_300_color },
    },
});

export const message_box = style({
    display: "flex",
    flexDirection: "column",
    selectors: {
        // Sent lines sit on the right; a wrapped message still reads from a
        // straight left edge.
        [`&.${sent_message}`]: { width: "100%", alignItems: "end", textAlign: "start" },
        [`&.${received_message}`]: { width: "100%", alignItems: "start" },
        // Last, as in the SCSS: a system row's box is centred whatever its kind.
        [`${system_message} &`]: { alignItems: "center" },
    },
});

export const message_main = style({
    userSelect: "text",
    fontSize: "1.4em",
    overflowWrap: "break-word",
    maxWidth: "100%",
});
// Makes all children selectable under main, but not ruby
globalStyle(`${message_main} *`, { userSelect: "text" });
globalStyle(`${message_main} rt`, { userSelect: "none" });

export const message_second = style({
    color: vars.dark_450_color,
    userSelect: "text",
    fontSize: "1em",
});

export const message_main_system = style({
    selectors: {
        [`${system_message} &`]: { fontSize: "1.2rem", color: vars.dark_500_color },
    },
});

// For ruby
export const with_hepburn = style({
    selectors: {
        "&:hover": { color: vars.dark_500_color },
    },
});
