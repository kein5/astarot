import { style } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// The gallery stands on the settings page's ground: the canvas, a 16px gutter at least, and a
// column no wider than the settings content.
// root.css fits the app to its window, so the gallery scrolls inside its own box.
export const page = style({
    height: "100dvh",
    overflowY: "auto",
    boxSizing: "border-box",
    paddingBlock: "2.4rem 6.4rem",
    paddingInline: "max(1.6rem, 4vw)",
    background: vars.vox_canvas,
    color: vars.dark_basic_text_color,
});

export const bar = style({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1.2rem" });
export const title = style({ margin: 0, fontSize: "2rem", fontWeight: 600 });
export const tools = style({ display: "flex", gap: ".8rem" });
export const section = style({
    margin: "3.2rem 0 1.6rem",
    fontSize: "1.2rem",
    fontWeight: 500,
    color: vars.vox_description_text,
});
// Room on the left for the changed rows' rule, which sits just outside the row.
export const column = style({ maxWidth: "72rem", paddingInlineStart: "1.2rem" });
export const buttons = style({ display: "flex", flexWrap: "wrap", gap: ".8rem", maxWidth: "72rem" });
// An icon inside a kit button: shadcn/ui's size-4, drawn in the button's text colour.
export const icon = style({ width: "1.6rem", height: "1.6rem", flexShrink: 0, fill: "currentColor" });
