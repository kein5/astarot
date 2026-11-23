import { style } from "@vanilla-extract/css";
import { vars } from "../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "0 1rem 1rem",
});

export const header = style({
    width: "100%",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: ".4rem .8rem",
    padding: ".6rem .2rem .4rem",
    borderTop: `.1rem solid ${vars.dark_850_color}`,
});

// 1.2rem leaves 「Language Settings」 room beside the presets in the 24rem rail.
export const title = style({
    fontSize: "1.2rem",
    fontWeight: 500,
    color: vars.vox_secondary_text,
});

export const preset_container = style({
    width: "100%",
    backgroundColor: vars.vox_rail,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: ".2rem",
});

export const target_language_containers = style({
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.2rem",
});
