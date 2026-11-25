import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

// Non-commercial license confirmation (NLLB weights): the kit's Dialog, as the model downloads'
// consent dialogs. Its words are one part (the dialog's header), its links in the forms' link color.
export const license_text = style({});
globalStyle(`${license_text} p`, { margin: 0, fontSize: "1.3rem", lineHeight: 1.6, overflowWrap: "anywhere" });
globalStyle(`${license_text} a`, { color: vars.primary_300_color });

export const license_check = style({
    display: "flex",
    alignItems: "flex-start",
    gap: "1.2rem",
    fontSize: "1.3rem",
    lineHeight: 1.5,
    cursor: "pointer",
});
globalStyle(`${license_check} input`, {
    appearance: "auto",
    WebkitAppearance: "checkbox",
    accentColor: vars.primary_400_color,
    width: "2rem",
    height: "2rem",
    marginTop: ".1rem",
    flexShrink: 0,
});
globalStyle(`${license_check} input:focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".3rem" });

// The answers stay at the dialog's right, as before the kit (D-24).
export const license_actions = style({ justifyContent: "flex-end" });
