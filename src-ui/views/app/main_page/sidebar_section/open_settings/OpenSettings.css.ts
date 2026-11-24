import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

// The foot of the rail, under its scrolling part (a flex child, not laid over it). The button,
// the kit's icon Button (OpenSettings.tsx), stands in its middle.
export const container = style({
    flexShrink: 0,
    width: "100%",
    display: "flex",
    justifyContent: "center",
    padding: ".8rem 1rem",
    borderTop: `.1rem solid ${vars.dark_850_color}`,
    backgroundColor: vars.vox_rail,
});

export const configurationSvg = style({ width: "2rem" });
