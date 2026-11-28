import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The layout switch's icons (catalogLayout.tsx, in the kit's ToggleGroup): outlines, whatever the
// page's icons are filled with.
export const icon = style({
    width: "1.6rem",
    height: "1.6rem",
    flex: "none",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
});
globalStyle(`${icon} rect`, { fill: "none" });

// The facts' fold in a grid card: what it holds (the file's choice, the table, a note) a little apart
// from each other, as in a card of the list. It is the container of what it holds, so the table
// stacks in the card's width (the card itself shares the list's rows and cannot be one).
export const facts = style({});
globalStyle(`${facts} > div:last-child`, { gap: ".8rem", paddingTop: ".8rem", containerType: "inline-size" });

// What a catalog part's bar reads out beside its name: how many models and how many are on the
// PC, quieter than the name, as a setup fold's status is.
export const readout = style({
    fontSize: "1.3rem",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    color: fallbackVar(vars.vox_secondary_text, "#c3cde0"),
});

// A card pressed anywhere for its main action (#1228, #1254): using a model on the PC, or
// reviewing the download of one that is not. The card's one control for it is its visible button,
// whose hit area covers the card: the card itself is not a second control, so the keyboard and the
// screen reader meet one button, named with the model. The card in use has nothing to press.
export const pressable = style({ position: "relative" });
export const press = style({
    selectors: {
        "&::after": { content: '""', position: "absolute", inset: 0, borderRadius: "inherit", cursor: "pointer" },
        "&:disabled::after": { cursor: "default" },
    },
});
// The card's other controls (the file's choice, Cancel and Apply, the audition, Remove, the facts'
// fold, a link, a hint's mark) sit above that hit area and are pressed on their own.
globalStyle(`${pressable} :is(a, button, input, select, textarea, summary, label, [tabindex]:not([tabindex="-1"])):not(${press})`, {
    position: "relative",
    zIndex: 1,
});
