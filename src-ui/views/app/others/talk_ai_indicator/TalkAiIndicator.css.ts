import { fallbackVar, style } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

// A band across the window under the title bar, over both pages: it is there only while Talk AI
// sends, so its place and tint say "something leaves the PC" before its words are read. The pages
// under it give it its height for that time (App.css.ts: they shrink in the column).
export const bar = style({
    width: "100%",
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".6rem 1.2rem",
    padding: ".6rem 1.6rem",
    background: fallbackVar(vars.vox_highlight_tint, "rgba(201, 168, 255, .14)"),
    borderBottom: `.1rem solid ${fallbackVar(vars.vox_state_active, "#c9a8ff")}`,
    color: fallbackVar(vars.dark_basic_text_color, "#edf3ff"),
});

// A filled dot in the active colour, as a recording light: the words say the same.
export const mark = style({
    width: ".9rem",
    height: ".9rem",
    borderRadius: "50%",
    flexShrink: 0,
    background: fallbackVar(vars.vox_state_active, "#c9a8ff"),
});

export const words = style({
    flex: "1 1 20rem",
    minWidth: 0,
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: ".2rem 1rem",
    fontSize: "1.3rem",
    lineHeight: 1.5,
});

export const name = style({ fontWeight: 600 });

export const stop = style({ flexShrink: 0 });
