import { fallbackVar, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({ display: "flex", flexDirection: "column" });

// The same quiet lead as the Hotkeys page's notice.
export const notice = style({
    fontSize: "1.2rem", fontWeight: 300, lineHeight: 1.5, marginBottom: "1.6rem",
    color: fallbackVar(vars.dark_500_color, "#9daec6"),
});

export const empty = style({
    fontSize: "1.4rem", lineHeight: 1.5, padding: "1.6rem",
    color: fallbackVar(vars.dark_basic_text_color, "#edf3ff"),
    border: `.1rem dashed ${fallbackVar(vars.dark_700_color, "#657a96")}`,
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
});
