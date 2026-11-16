import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

// The foot of the rail, under its scrolling part (a flex child, not laid over it).
export const container = style({
    flexShrink: 0,
    width: "100%",
    padding: ".8rem 1rem",
    borderTop: `.1rem solid ${vars.dark_850_color}`,
    backgroundColor: vars.vox_rail,
});

export const openConfigPageButton = style({
    width: "100%",
    minHeight: "4rem",
    padding: "0.8rem 0",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: "0.6rem",
    cursor: "pointer",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_875_color },
        "&:focus-visible": { outline: `.2rem solid ${vars.primary_200_color}`, outlineOffset: "-.2rem" },
    },
});

export const configurationSvg = style({ width: "2rem", color: vars.dark_400_color });
