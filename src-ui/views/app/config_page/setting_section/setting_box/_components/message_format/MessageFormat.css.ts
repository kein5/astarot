import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const is_break_point = style({});

export const container = style({
    display: "flex",
    justifyContent: "center",
    width: "100%",
    gap: "2.6rem",
    paddingBottom: "2rem",
    margin: "1rem 0",
    selectors: {
        [`&.${is_break_point}`]: { flexDirection: "column", gap: "2.2rem", alignItems: "center" },
    },
});

export const border = style({
    height: "auto",
    width: "0.1rem",
    backgroundColor: vars.dark_800_color,
    margin: "3.2rem 0",
    flexShrink: 0,
    selectors: {
        [`${container}.${is_break_point} &`]: { height: "0.1rem", width: "60%", margin: 0, flexShrink: 0 },
    },
});

export const section_title = style({
    fontSize: "1.4rem",
    textAlign: "center",
    width: "100%",
});

export const example_container = style({
    display: "flex",
    flexDirection: "column",
    gap: "2rem",
    minWidth: "14rem",
    maxWidth: "34rem",
    width: "100%",
    selectors: {
        [`${container}.${is_break_point} &`]: { gap: 0 },
    },
});

export const example_view_container = style({
    display: "flex",
    flexDirection: "column",
    gap: "1.2rem",
});

export const example_wrapper = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.4rem",
});
export const example_label = style({
    fontSize: "1.4rem",
    textAlign: "start",
    width: "100%",
    color: vars.dark_basic_text_color,
});
export const example_chatbox = style({
    padding: "0.6rem",
    backgroundColor: vars.vox_chatbox_preview,
    borderRadius: "1rem",
    width: "100%",
    textAlign: "center",
});

export const example_text = style({
    fontSize: "1.2rem",
});

export const message_format_settings_container = style({
    flexDirection: "column",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: "2rem",
    selectors: {
        [`${container}.${is_break_point} &`]: { gap: 0 },
    },
});

export const message_format_settings_wrapper = style({
    display: "flex",
    flexDirection: "column",
    gap: "3.8rem",
    width: "34rem",
    flexShrink: 0,
});

export const swap_button_container = style({
    width: "100%",
    display: "flex",
    justifyContent: "end",
});

// Swapping the original and the translation is the kit's plain Button (MessageFormat.tsx), which
// draws it; this class names it. The mark between the two words takes the button's word color.
export const swap_button = style({});

export const swap_img = style({
    width: "1.8rem",
    height: "1.8rem",
});

export const input_wrapper = style({
    width: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: "1.8rem",
});

export const input_contents = style({
    width: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "1rem",
    color: vars.dark_basic_text_color,
});
// The format is typed with \n for a line break. Japanese UI fonts (Yu Gothic, Meiryo)
// draw a backslash as a yen sign, so the fields use a font that draws it as written (#437).
// Each of these is installed with its OS; nothing is fetched.
globalStyle(`${input_contents} input`, { fontFamily: "var(--vox_font_mono, monospace)" });

export const preset_text = style({
    fontSize: "1.6rem",
    textAlign: "center",
    flexShrink: 0,
    color: vars.dark_basic_text_color,
});

export const multi_translation_input_wrapper = style({
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    justifyContent: "center",
    color: vars.dark_basic_text_color,
});

export const multi_translation_title = style({
    fontSize: "1.2rem",
});

export const reset_button_wrapper = style({
    width: "100%",
    display: "flex",
    justifyContent: "end",
    alignItems: "center",
});
