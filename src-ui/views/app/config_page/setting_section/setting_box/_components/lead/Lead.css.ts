import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// The sentence that stays on screen: the general description role (1.2rem / 400 in the
// description color), with its hint's mark after the last word.
export const lead = style({
    margin: 0,
    fontSize: "1.2rem",
    fontWeight: 400,
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
    wordBreak: "auto-phrase",
    textWrap: "pretty",
});
// Drawn by itself, between the parts of a page, it keeps a row's distance from them.
export const alone = style({ padding: ".8rem 0" });
