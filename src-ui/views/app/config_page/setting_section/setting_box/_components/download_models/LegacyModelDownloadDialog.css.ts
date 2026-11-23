import { globalStyle, style } from "@vanilla-extract/css";

// The app's dialog frame, shared by the dialogs that open over the app (the first-run setup, the
// consents, the virtual microphone's guide, the legacy download, the settings' reset).
export const host = style({ padding: 0, border: 0 });
export const dialog = style({});
export const facts = style({});
export const fact = style({});
export const path = style({});
export const alternative = style({});

// At shadcn/ui's DialogContent width (sm:max-w-lg). The forms' `dialog` rules
// (VoiceSettings.css.ts) give it its border, padding and the 1.6rem between its parts.
const frame = `${host} dialog${dialog}`;
globalStyle(frame, {
    boxSizing: "border-box",
    width: "min(51.2rem, calc(100vw - 2.4rem))",
    maxWidth: "calc(100vw - 2.4rem)",
    maxHeight: "calc(100dvh - 2.4rem)",
    overflowY: "auto",
    overflowWrap: "anywhere",
    lineHeight: 1.6,
});
globalStyle(`${frame} a`, { color: "var(--primary_200_color, #a9ccff)" });
globalStyle(`${frame} ${facts}`, { display: "grid", gap: "1.2rem", margin: "1.6rem 0", fontSize: "1.3rem" });
globalStyle(`${frame} ${fact}`, {
    display: "grid",
    gridTemplateColumns: "minmax(6rem, 10rem) minmax(0, 1fr)",
    columnGap: "1.2rem",
    rowGap: ".4rem",
    "@media": { "(max-width: 700px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
// Labels wrap only between words, never inside a Japanese label.
globalStyle(`${frame} dt`, { fontWeight: 500, color: "var(--vox_secondary_text, #adbed6)", overflowWrap: "normal", wordBreak: "keep-all" });
globalStyle(`${frame} dd`, { minWidth: 0, margin: 0, fontVariantNumeric: "tabular-nums" });
globalStyle(`${frame} dd p`, { marginTop: ".8rem" });
// A long folder path breaks anywhere instead of widening the dialog.
globalStyle(`${frame} ${path}`, { overflowWrap: "anywhere", wordBreak: "break-all", userSelect: "text" });
// A way forward that skips the download: a text link under the two actions,
// so Back and Start stay on one row.
globalStyle(`${frame} ${alternative}`, { marginTop: "1.2rem" });
globalStyle([
    `${frame} ${alternative} button`,
    `${frame} ${alternative} button:hover:enabled`,
    `${frame} ${alternative} button:active:enabled`,
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
globalStyle(`${frame} ${alternative} button:hover:enabled`, { color: "var(--dark_50_color, #fff)" });
// A part of the dialog itself is spaced by the dialog's gap alone, whatever its margins
// elsewhere (the usage data's contents keep theirs in the advanced settings).
globalStyle(`${frame} > *, ${frame} > ${facts}, ${frame} > ${alternative}`, { marginBlock: 0 });
