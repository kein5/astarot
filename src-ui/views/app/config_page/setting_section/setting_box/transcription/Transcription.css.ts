import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

// One of the engines' two systems (#414): its subheading and what it is, then its parts, with a
// hairline after it as after the page's other sections. The server section inside it ends
// the group, so it draws no second line.
export const engine_group = style({
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    paddingBottom: "1.2rem",
    borderBottom: `.1rem solid var(--settings_rule, ${vars.vox_border})`,
});
globalStyle(`${engine_group} > section:last-child`, { paddingBottom: ".8rem", borderBottom: 0 });
