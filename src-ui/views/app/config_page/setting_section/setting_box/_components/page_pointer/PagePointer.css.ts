import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

// A plain button at rest (DESIGN.md "Components"): the raised surface and a hairline border, in
// the control column like the other row actions (#478). The destination page's icon leads its
// words (#537), in the quiet grey of the settings menu's icons.
export const open_page = style({});
// The element and [data-page-pointer] lift these rules over a form's own button rules (the TTS
// and RVC pages' VoiceSettings.module.scss fill every button), so the button looks the same on
// every page.
const button = `button${open_page}[data-page-pointer]`;
globalStyle(button, {
    display: "inline-flex",
    alignItems: "center",
    gap: ".8rem",
    width: "fit-content",
    maxWidth: "100%",
    minHeight: "4rem",
    padding: ".8rem 1.6rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    fontSize: "1.4rem",
    fontWeight: 500,
    color: vars.dark_200_color,
    background: vars.vox_surface,
    textAlign: "left",
    cursor: "pointer",
});
globalStyle(`${button}:hover:enabled`, { background: vars.dark_850_color });
globalStyle(`${button}:active:enabled`, { background: vars.dark_925_color });
globalStyle(`${button}:focus-visible`, { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" });

export const page_icon = style({
    display: "inline-flex",
    flexShrink: 0,
    width: "1.8rem",
    height: "1.8rem",
    alignItems: "center",
    justifyContent: "center",
});

export const page_icon_svg = style({
    width: "100%",
    height: "100%",
    fill: vars.dark_400_color,
    objectFit: "contain",
});
