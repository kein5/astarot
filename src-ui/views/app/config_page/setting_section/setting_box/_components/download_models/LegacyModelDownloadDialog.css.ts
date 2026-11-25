import { globalStyle, style } from "@vanilla-extract/css";

// What the dialogs that open over the app share (the first-run setup, the consents, the virtual
// microphone's guide, the legacy download, the connection key's confirmation): the form section they
// sit in (host), which takes no room of its own, and the parts of their contents below. They are the
// kit's Dialog, which draws its own frame; the first-run setup still has the frame written here.
export const host = style({ padding: 0, border: 0 });
export const dialog = style({});
export const facts = style({});
export const fact = style({});
export const path = style({});
export const alternative = style({});
// A secondary way out on a line of its own under a dialog's buttons, the kit's quiet Button (decided
// on 2026-11-25): at the line's start, not stretched across the dialog's grid.
export const ownLine = style({ justifySelf: "start" });

// At shadcn/ui's DialogContent width (sm:max-w-lg). The forms' `dialog` rules
// (VoiceSettings.css.ts) give it its border, padding and the 1.6rem between its parts.
const frame = `${host} dialog${dialog}`;
// The contents of any of these dialogs, the kit's or the frame's.
const inDialog = `${host} dialog`;
globalStyle(frame, {
    boxSizing: "border-box",
    width: "min(51.2rem, calc(100vw - 2.4rem))",
    maxWidth: "calc(100vw - 2.4rem)",
    maxHeight: "calc(100dvh - 2.4rem)",
    overflowY: "auto",
    overflowWrap: "anywhere",
    lineHeight: 1.6,
});
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
// A way forward that skips the download: a text link under the two actions,
// so Back and Start stay on one row.
globalStyle(`${inDialog} ${alternative}`, { marginTop: "1.2rem" });
globalStyle([
    `${inDialog} ${alternative} button`,
    `${inDialog} ${alternative} button:hover:enabled`,
    `${inDialog} ${alternative} button:active:enabled`,
].join(", "), {
    minHeight: "3.2rem",
    margin: 0,
    padding: ".4rem 0",
    border: 0,
    background: "none",
    fontWeight: 400,
    color: "var(--primary_200_color, #a9ccff)",
    textDecoration: "underline",
    textUnderlineOffset: ".3rem",
});
globalStyle(`${inDialog} ${alternative} button:hover:enabled`, { color: "var(--dark_50_color, #fff)" });
// A part of the dialog itself is spaced by the dialog's gap alone, whatever its margins
// elsewhere (the usage data's contents keep theirs in the advanced settings).
globalStyle(`${inDialog} > *, ${inDialog} > ${facts}, ${inDialog} > ${alternative}`, { marginBlock: 0 });
