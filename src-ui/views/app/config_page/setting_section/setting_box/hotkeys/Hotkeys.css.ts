import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

export const platform_readout = style({ margin: ".8rem 0" });
// The same secondary button as the other settings forms (VoiceSettings).
export const open_quick_chat = style({
    alignSelf: "flex-start",
    fontSize: "1.4rem",
    fontWeight: 500,
    minHeight: "4rem",
    padding: ".9rem 1.2rem",
    margin: ".4rem 0 1.6rem",
    color: vars.dark_200_color,
    background: vars.dark_850_color,
    border: ".1rem solid transparent",
    borderRadius: vars.vox_radius,
    cursor: "pointer",
    selectors: {
        "&:hover": { background: vars.dark_600_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: ".2rem" },
    },
});

// That the hotkeys are paused while settings are open is a state of this session: a readout
// (#614), not a footnote in faint text.
export const disabled_notice = style({
    marginBottom: "1.6rem",
});
// The notice opens the page, so the first heading needs no 40px above it.
globalStyle(`${disabled_notice} + * > [data-section-label]:first-child`, { paddingTop: 0 });
