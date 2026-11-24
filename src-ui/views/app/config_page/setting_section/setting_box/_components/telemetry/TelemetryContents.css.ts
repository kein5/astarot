import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

export const contents = style({
    marginTop: "1.2rem",
    fontSize: "1.3rem",
    lineHeight: 1.6,
    overflowWrap: "anywhere",
});
globalStyle(`${contents} p`, { margin: ".8rem 0" });

// Read, not seen: the words that the rows are being asked for (#912).
export const hidden = style({
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
});

export const rows = style({
    display: "grid",
    gap: ".6rem",
    margin: "1.2rem 0",
});

export const row = style({
    display: "grid",
    gridTemplateColumns: "minmax(8rem, 14rem) minmax(0, 1fr)",
    columnGap: "1.2rem",
    rowGap: ".2rem",
    "@media": { "(max-width: 700px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
// Labels wrap only between words, never inside a Japanese label.
globalStyle(`${row} dt`, { fontWeight: 500, color: "var(--vox_secondary_text, #adbed6)", overflowWrap: "normal", wordBreak: "keep-all" });
globalStyle(`${row} dd`, { minWidth: 0, margin: 0, fontVariantNumeric: "tabular-nums", userSelect: "text" });

export const raw = style({});
globalStyle(`${raw} pre`, {
    margin: ".4rem 0 .8rem",
    padding: "1rem 1.2rem",
    maxHeight: "24rem",
    overflow: "auto",
    borderRadius: vars.vox_radius,
    background: "var(--dark_900_color, #12161d)",
    fontFamily: "var(--vox_font_mono, monospace)",
    fontSize: "1.2rem",
    whiteSpace: "pre-wrap",
    userSelect: "text",
});
globalStyle(`${raw} pre:focus-visible`, { outline: ".2rem solid var(--primary_300_color, #7fb2ff)", outlineOffset: ".2rem" });

export const sent = style({ marginTop: "1.6rem" });
globalStyle(`${sent} h4`, { margin: "0 0 .4rem", fontSize: "1.3rem", fontWeight: 500 });
globalStyle(`${sent} ul`, { margin: 0, padding: 0, listStyle: "none" });
