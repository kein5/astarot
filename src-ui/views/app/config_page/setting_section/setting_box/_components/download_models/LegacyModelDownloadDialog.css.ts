import { globalStyle, style } from "@vanilla-extract/css";

// What the dialogs that open over the app share (the first-run setup, the consents, the virtual
// microphone's guide, the legacy download, the connection key's confirmation): the form section they
// sit in (host), which takes no room of its own, and the parts of their contents below. They are the
// kit's Dialog, which draws their frame.
export const host = style({ padding: 0, border: 0 });
export const facts = style({});
export const fact = style({});
export const path = style({});
// A secondary way out on a line of its own under a dialog's buttons, the kit's quiet Button (decided
// on 2026-11-25): at the line's start, not stretched across the dialog's grid.
export const ownLine = style({ justifySelf: "start" });

// The contents of any of these dialogs.
const inDialog = `${host} dialog`;
globalStyle(`${inDialog} a`, { color: "var(--primary_200_color, #a9ccff)" });
globalStyle(`${inDialog} ${facts}`, { display: "grid", gap: "1.2rem", margin: "1.6rem 0", fontSize: "1.3rem" });
globalStyle(`${inDialog} ${fact}`, {
    display: "grid",
    gridTemplateColumns: "minmax(6rem, 10rem) minmax(0, 1fr)",
    columnGap: "1.2rem",
    rowGap: ".4rem",
    "@media": { "(max-width: 700px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
// Labels wrap only between words, never inside a Japanese label.
globalStyle(`${inDialog} dt`, { fontWeight: 500, color: "var(--vox_secondary_text, #adbed6)", overflowWrap: "normal", wordBreak: "keep-all" });
globalStyle(`${inDialog} dd`, { minWidth: 0, margin: 0, fontVariantNumeric: "tabular-nums" });
globalStyle(`${inDialog} dd p`, { marginTop: ".8rem" });
// A long folder path breaks anywhere instead of widening the dialog.
globalStyle(`${inDialog} ${path}`, { overflowWrap: "anywhere", wordBreak: "break-all", userSelect: "text" });
// A part of the dialog itself is spaced by the dialog's gap alone, whatever its margins
// elsewhere (the usage data's contents keep theirs in the advanced settings).
globalStyle(`${inDialog} > *, ${inDialog} > ${facts}`, { marginBlock: 0 });
