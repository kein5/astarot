import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The theme choice (#965): one tile for each theme, each the kit's choice card (U-07) holding a
// small picture of its colours (the rail, the canvas, a raised surface and the accent) over its
// name, side by side and wrapping in the row's group. The card draws the frame, the accent frame
// and check of the tile in use, and the focus ring; the page gives the tile its width.
export const tile = style({ width: "10.4rem" });

// The picture: the rail on the left, the canvas with a raised surface and an accent button. Its
// colours are the theme's (the tile's custom properties), not the page's.
export const preview = style({
    display: "grid",
    gridTemplateColumns: "1fr 3fr",
    height: "4.4rem",
    borderRadius: ".4rem",
    overflow: "hidden",
    border: `.1rem solid ${vars.dark_1000_color_66}`,
});

export const previewRail = style({ backgroundColor: "var(--theme_tile_rail)" });

export const previewCanvas = style({
    display: "grid",
    alignContent: "center",
    gap: ".4rem",
    padding: "0 .6rem",
    backgroundColor: "var(--theme_tile_canvas)",
});

export const previewSurface = style({ height: ".8rem", borderRadius: ".2rem", backgroundColor: "var(--theme_tile_surface)" });

export const previewAccent = style({ width: "55%", height: ".8rem", borderRadius: ".2rem", backgroundColor: "var(--theme_tile_accent)" });

// The user's own colours, under the tiles while "Custom" is in use.
export const custom = style({ display: "grid", gap: ".4rem", marginTop: ".4rem" });

export const colorField = style({ display: "flex", width: "100%", justifyContent: "flex-end", minWidth: 0 });

// An accent close to the warning or failed colour: said in words, in the warning colour.
export const nearStates = style({
    margin: 0,
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_state_warning,
});
