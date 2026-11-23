import { fallbackVar, globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The pair of layout buttons on a catalog's heading line (catalogLayout.tsx): one hairline round
// both, the one in use raised as the bars of the app's fold are, the other quiet.
const hairline = `.1rem solid ${fallbackVar(vars.dark_800_color, "#344662")}`;
const radius = fallbackVar(vars.vox_radius, ".8rem");

export const layoutSwitch = style({
    display: "inline-flex",
    flex: "none",
    gap: ".2rem",
    padding: ".2rem",
    border: hairline,
    borderRadius: radius,
});

export const option = style({});
// The settings page draws every button raised (VoiceSettings.css.ts): here the one in use is
// raised and the other is quiet, so these rules name the switch and the button together.
const own = `${layoutSwitch} > ${option}`;
globalStyle(own, {
    display: "inline-flex",
    alignItems: "center",
    gap: ".6rem",
    minHeight: "3.2rem",
    padding: ".4rem 1rem",
    border: 0,
    borderRadius: `calc(${radius} - .2rem)`,
    background: "transparent",
    fontSize: "1.3rem",
    fontWeight: 500,
    color: fallbackVar(vars.vox_secondary_text, "#c3cde0"),
});
globalStyle(`${own}:hover:enabled, ${own}:active:enabled`, { background: fallbackVar(vars.vox_secondary_hover, "#3a2a4a") });
globalStyle(`${own}[aria-pressed="true"], ${own}[aria-pressed="true"]:hover:enabled, ${own}[aria-pressed="true"]:active:enabled`, {
    background: fallbackVar(vars.dark_850_color, "#25364f"),
    color: fallbackVar(vars.dark_200_color, "#e0e8f6"),
    fontWeight: 600,
});
globalStyle(`${own}:focus-visible`, { outline: `.2rem solid ${fallbackVar(vars.primary_200_color, "#d5c2fb")}`, outlineOffset: ".1rem" });
globalStyle(`${own}:focus:not(:focus-visible)`, { outline: "none" });

// Outlines, whatever the page's icons are filled with.
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
