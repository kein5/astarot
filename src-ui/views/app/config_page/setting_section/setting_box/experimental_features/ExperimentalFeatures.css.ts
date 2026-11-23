import { fallbackVar, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({ display: "flex", flexDirection: "column" });

export const empty = style({
    fontSize: "1.4rem", lineHeight: 1.5, padding: "1.6rem",
    color: fallbackVar(vars.dark_basic_text_color, "#edf3ff"),
    border: `.1rem dashed ${fallbackVar(vars.dark_700_color, "#657a96")}`,
    borderRadius: fallbackVar(vars.vox_radius, ".8rem"),
});
