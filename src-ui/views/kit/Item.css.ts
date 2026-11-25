import { keyframes, style } from "@vanilla-extract/css";
import { recipe, type RecipeVariants } from "@vanilla-extract/recipes";
import { vars } from "../theme/vars.css.ts";

// shadcn/ui's Item: a list of rows, each a mark, a name over its words, and what can be done with
// it. The looks are the app's (DESIGN.md "Components"): the first-run setup's 「いまの状態」 (#557)
// and the term dictionary's rows (#792), moved here as they were (docs/design/components/
// hand-built-inventory.md, U-08 and U-11). Their layout tells what needs the user before any word
// is read (#759, #614): a row that needs the user is a card of its own, in the warning's amber; the
// others are quiet rows in one frame.

// ItemGroup. "default" sets its rows apart by space; "outline" holds them in one quiet frame with a
// hairline between two rows (ItemGroup with its separators): the rows are one unit, so the list
// keeps one frame (DESIGN.md "Roles"). The group is the container its compact rows measure. The
// classes are declared in this order so that the frame's rows touch whatever the size.
const groupBase = style({
    display: "grid",
    gap: ".8rem",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
    containerType: "inline-size",
});
const compactGroup = style({ gap: ".4rem" });
const outlineGroup = style({
    gap: 0,
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
});

export const group = recipe({
    base: groupBase,
    variants: {
        size: { default: {}, compact: compactGroup },
        variant: { default: {}, outline: outlineGroup },
    },
    defaultVariants: { variant: "default", size: "default" },
});

// Item: the mark, the name over its words, and the row's actions under those words, where they
// start (DESIGN.md: a button never follows the words on their line). The words are a sentence or
// two of Japanese, so they take the row's width and the actions of every row start at one place;
// shadcn/ui puts the actions at the row's end instead. A row without a mark starts with its words.
const root = style({
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gridTemplateAreas: '"media content" ". actions"',
    columnGap: "1.2rem",
    rowGap: ".8rem",
    alignContent: "center",
    minWidth: 0,
    selectors: {
        "&:not(:has(> [data-slot='item-media']))": { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateAreas: '"content" "actions"' },
        [`${outlineGroup} > & + &`]: { borderTop: `.1rem solid ${vars.vox_border}` },
    },
});

// The sizes. "default" for a list read one row at a time; "compact" for a long list of short rows
// (the dictionary's fifty terms): one line each, the name in a column of its own and its words
// beside it, so the words of every row start at one place, and the actions at the row's end.
const defaultSize = style({
    minHeight: "4.8rem",
    padding: ".8rem 1.6rem",
});
const compactSize = style({
    display: "flex",
    alignItems: "center",
    columnGap: "1.2rem",
    padding: ".2rem .8rem",
    borderRadius: vars.vox_radius,
});

// The variants, declared after the sizes so that a variant's room wins over its size's.
// - attention: the user has something to do here. A card of its own with the warning's amber rule
//   on its left and its tint, a larger mark and the name at full strength. Its 1.3rem of room on
//   the left and the rule's .3rem keep its words where the other rows' start.
// - muted: a row that stands apart on a tinted ground, as a term whose readings the user changed.
// - removed: a row taken out that keeps its place, so it can be put back: quiet, its name struck
//   through.
const attention = style({
    minHeight: "6.4rem",
    padding: "1.4rem 1.6rem 1.4rem 1.3rem",
    borderLeft: `.3rem solid ${vars.vox_state_warning}`,
    borderRadius: vars.vox_radius,
    background: vars.vox_warning_tint,
});
const muted = style({ background: vars.vox_surface });
const removed = style({ color: vars.dark_500_color });

export const item = recipe({
    base: root,
    variants: {
        size: { default: defaultSize, compact: compactSize },
        variant: { default: {}, attention, muted, removed },
    },
    defaultVariants: { variant: "default", size: "default" },
});

// ItemMedia: a mark on the name's line, as tall as that line. The words beside it always say what
// the mark says.
export const media = style({
    gridArea: "media",
    alignSelf: "start",
    flex: "none",
    display: "block",
    width: "1.8rem",
    height: "1.8rem",
    // On the name's line (1.3rem at 1.5).
    marginTop: ".05rem",
    color: vars.vox_description_text,
    selectors: {
        // On the name's line (1.5rem at 1.4).
        [`${attention} > &`]: { width: "2.4rem", height: "2.4rem", marginTop: "-.1rem" },
    },
});
export const mediaSvg = style({ display: "block", width: "100%", height: "100%", overflow: "visible" });

// The state at a glance (DESIGN.md "Components"): ready (a lilac disc with a check, as a readout's
// finished work), needs the user (an amber disc with "!"), being checked (the readout's spinning
// arc), or neither (a quiet ring).
const spin = keyframes({ to: { transform: "rotate(360deg)" } });
export const markShape = {
    ready: style({ fill: vars.vox_state_active }),
    attention: style({ fill: vars.vox_state_warning }),
    ring: style({ fill: "none", stroke: "currentColor", strokeWidth: 1.6 }),
    arc: style({
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        // About two thirds of the circle, as the readout's.
        strokeDasharray: "25 13",
        transformBox: "fill-box",
        transformOrigin: "center",
        animation: `${spin} 0.9s linear infinite`,
        "@media": { "(prefers-reduced-motion: reduce)": { animation: "none" } },
    }),
    // The check or the "!" on a disc: the canvas colour, as on the readout's disc.
    glyph: style({ fill: "none", stroke: vars.vox_canvas, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }),
};

// ItemContent: the name over its words. In a compact row, the name and its words side by side, the
// name's column 8 to 14rem; in a narrow list (52rem or less) the words go under the name, and the
// actions stay at the row's end, beside both.
export const content = style({
    gridArea: "content",
    display: "grid",
    gap: ".2rem",
    minWidth: 0,
    selectors: {
        [`${compactSize} > &`]: {
            flex: "1 1 auto",
            gridTemplateColumns: "minmax(8rem, 14rem) minmax(0, 1fr)",
            alignItems: "center",
            gap: ".4rem 1.2rem",
            "@container": { "(max-width: 52rem)": { gridTemplateColumns: "minmax(0, 1fr)", rowGap: 0 } },
        },
    },
});

// ItemTitle: the item's name, smaller and in the secondary colour in a quiet row, at full strength
// in a card that needs the user, and bold in a compact row, where it starts the line.
export const title = style({
    minWidth: 0,
    selectors: {
        [`${defaultSize} &`]: { fontSize: "1.3rem", fontWeight: 500, lineHeight: 1.5, color: vars.vox_secondary_text },
        [`${attention} &`]: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.4, color: vars.dark_basic_text_color },
        [`${compactSize} &`]: { fontSize: "1.4rem", fontWeight: 600, lineHeight: 1.5, color: vars.dark_200_color, overflowWrap: "anywhere" },
        [`${removed} &`]: { fontWeight: 400, color: vars.dark_500_color, textDecoration: "line-through" },
    },
});

// ItemDescription: what was found, a sentence or two, or a few lines of their own (shadcn/ui draws a
// <p>; a <div> here holds the lines, and the settings forms' rules for every <p> stay off it). In a
// compact row, the item's value at full strength, its pieces on one line while they fit.
export const description = style({
    minWidth: 0,
    overflowWrap: "anywhere",
    selectors: {
        [`${defaultSize} &`]: {
            display: "grid",
            gap: ".2rem",
            fontSize: "1.2rem",
            lineHeight: 1.6,
            color: vars.vox_description_text,
            wordBreak: "auto-phrase",
        },
        [`${attention} &`]: { fontSize: "1.3rem", color: vars.dark_200_color },
        [`${compactSize} &`]: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: ".4rem .8rem",
            fontSize: "1.4rem",
            lineHeight: 1.5,
            color: vars.dark_200_color,
        },
        [`${removed} &`]: { color: vars.dark_500_color },
    },
});

// ItemActions: under the words, where they start; at the row's end in a compact row.
export const actions = style({
    gridArea: "actions",
    justifySelf: "start",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: ".8rem",
    selectors: {
        [`${compactSize} > &`]: { flex: "none", justifyContent: "flex-end", gap: ".6rem" },
    },
});

export type ItemGroupVariants = NonNullable<RecipeVariants<typeof group>>;
export type ItemVariants = NonNullable<RecipeVariants<typeof item>>;
