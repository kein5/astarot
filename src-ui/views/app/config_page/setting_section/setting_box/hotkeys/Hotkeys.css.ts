import { globalStyle, style } from "@vanilla-extract/css";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

export const platform_readout = style({ margin: ".8rem 0" });
// Opening Quick Chat is the kit's plain Button (Hotkeys.tsx), which draws it; this class places it.
export const open_quick_chat = style({
    alignSelf: "flex-start",
    margin: ".4rem 0 1.6rem",
});

// That the hotkeys are paused while settings are open is a state of this session: a readout
// (#614), not a footnote in faint text.
export const disabled_notice = style({
    marginBottom: "1.6rem",
});
// The notice opens the page, so the first heading needs no 40px above it.
globalStyle(`${disabled_notice} + * > [data-section-label]:first-child`, { paddingTop: 0 });
