import { style, styleVariants } from "@vanilla-extract/css";
import { vars } from "../theme/vars.css.ts";

// The catalog's own layout around the kit's parts. The parts keep their own styles (src-ui/views/kit/);
// only the frame and the spacing between the examples are here, in the app's tokens.

// The frame of every story: the ground chosen in the toolbar, the app's text colour, a 16px gutter at
// least, and its own scrolling, because root.css fits the page to its window (overflow: hidden) as it
// does in the app's windows.
const frame = style({
    boxSizing: "border-box",
    height: "100dvh",
    overflowY: "auto",
    paddingBlock: "2.4rem 6.4rem",
    paddingInline: "max(1.6rem, 4vw)",
    color: vars.dark_basic_text_color,
});

// The three grounds the kit stands on: the main window and the settings page (canvas), the panels and
// the dialogs' fields (surface), and the settings menu (rail). The focus ring is checked on all three
// (views/theme/brandPalette.test.ts).
export const ground = styleVariants({
    canvas: [frame, { background: vars.vox_canvas }],
    surface: [frame, { background: vars.vox_surface }],
    rail: [frame, { background: vars.vox_rail }],
});

// Examples one under the other, each with its caption.
export const stack = style({ display: "grid", gap: "2.4rem", justifyItems: "start" });

// Examples one under the other, each as wide as the frame (for the fields, which take their column's width).
export const wideStack = style({ display: "grid", gap: "2.4rem" });

// Examples side by side, wrapping in a narrow window; their captions on one line.
export const row = style({ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "1.2rem" });

// One example: what it shows, in the description colour, above the part.
export const example = style({ display: "grid", gap: ".8rem", justifyItems: "start", minWidth: 0 });
export const caption = style({
    margin: 0,
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    fontFamily: "var(--vox_font_mono)",
});

// A field takes the width of its column, as in a settings row; alone, it gets the control column's
// width of a settings page.
export const fieldBox = style({ width: "min(32rem, 100%)" });

// Two fields of one state side by side: the text field and the select share one look (Field.css.ts).
export const fieldPair = style({
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 32rem))",
    gap: "1.6rem",
    width: "100%",
    "@media": { "(max-width: 700px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});

// A settings column no wider than the settings content, with room on the left for the rule of a
// changed row, which sits just outside the row.
export const column = style({ width: "100%", maxWidth: "72rem", paddingInlineStart: "1.2rem", boxSizing: "border-box" });

// Inside the column above, one narrower than 35.6rem, where a settings group stacks its field rows
// (Setting.css.ts).
export const narrowColumn = style({ width: "100%", maxWidth: "32rem" });

// A narrow box for long words: a button's label wraps inside it instead of widening the row.
export const narrowBox = style({ width: "min(20rem, 100%)" });

// An icon inside a kit button: shadcn/ui's size-4, drawn in the button's text colour.
export const icon = style({ width: "1.6rem", height: "1.6rem", flexShrink: 0, fill: "currentColor" });

// A card as wide as a catalog's card in a narrow window, and the name's line the catalogs give it:
// the name, then the state at the line's end (the catalogs' own layout, VoiceSettings.css.ts).
export const cardBox = style({ width: "min(48rem, 100%)" });
export const nameLine = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".6rem 1rem", minWidth: 0 });
export const lineEnd = style({ marginInlineStart: "auto" });

// A box of a fixed height, as Quick Chat's window is: a Textarea with fill takes the room left in
// it (flex: 1 is the screen's layout, not the kit's).
export const fillBox = style({ display: "flex", flexDirection: "column", width: "min(48rem, 100%)", height: "12rem" });
export const fillField = style({ flex: 1 });
