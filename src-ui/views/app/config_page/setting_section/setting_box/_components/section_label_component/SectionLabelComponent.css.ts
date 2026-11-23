import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// Category heading role (DESIGN.md): 2rem / 600, 40px above, 16px below, hairline.
export const container = style({ padding: "4rem 0 1.6rem" });
export const heading_row = style({ display: "flex", alignItems: "center", gap: "2rem" });
export const section_label = style({ color: vars.dark_200_color, fontSize: "2rem", fontWeight: 600, lineHeight: 1.4, textWrap: "balance" });
export const section_line = style({ flex: 1, minWidth: "2rem", height: ".1rem", background: vars.vox_border });
// General description role, under the heading.
export const section_desc = style({
    marginTop: ".8rem",
    maxWidth: "64rem",
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "break-word",
    textWrap: "pretty",
});
// Subheading role (DESIGN.md): 1.5rem / 600, secondary text, 24px above and 8px below, no frame.
// The fold's body already leaves 16px between its parts, so 8px more makes the 24px above.
export const sub_container = style({ padding: ".8rem 0 .8rem" });
export const sub_label = style({ color: vars.vox_secondary_text, fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.4, textWrap: "balance" });
// A subheading and its hint mark on one line (#614).
export const label_line = style({ display: "flex", alignItems: "center" });
