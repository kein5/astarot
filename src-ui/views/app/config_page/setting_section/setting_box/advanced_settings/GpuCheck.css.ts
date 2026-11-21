import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The GPU check (#288): its text, its buttons on one row (wrapping in a narrow window), the
// result per device and the report as it is sent.
export const container = style({
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
    padding: "1.2rem 0",
    color: vars.dark_basic_text_color,
    fontSize: "1.4rem",
    lineHeight: 1.6,
});

export const description = style({
    color: vars.vox_description_text,
    margin: 0,
});

// The line that says what the check does now (or how it ended) keeps one line of the text while it
// says nothing, so the page under it does not move when the check starts (#912).
export const status = style({
    minHeight: "calc(1.4rem * 1.6)",
});

export const actions = style({
    display: "flex",
    flexWrap: "wrap",
    gap: ".8rem",
    alignItems: "center",
});

export const tableScroll = style({
    overflowX: "auto",
});

export const table = style({
    borderCollapse: "collapse",
    minWidth: "100%",
});

// A selector of a style() block may only target the class itself, so the cells are styled here.
globalStyle(`${table} th, ${table} td`, {
    textAlign: "left", padding: ".4rem .8rem", borderBottom: `1px solid ${vars.vox_border}`, verticalAlign: "top",
});

export const failed = style({
    color: vars.vox_state_failed,
});

export const report = style({
    maxHeight: "28rem",
    overflow: "auto",
    margin: 0,
    padding: ".8rem",
    background: vars.vox_surface,
    border: `1px solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    fontSize: "1.2rem",
    whiteSpace: "pre",
});
