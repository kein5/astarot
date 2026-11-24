import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

// The theme choice (#965): one tile for each theme, each a small picture of its colours (the rail,
// the canvas, a raised surface and the accent) over its name, side by side and wrapping in the
// row's group. The tile in use carries the accent frame and a check after its name, so it is told
// by shape as well as by colour.
export const radio = style({
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
});

export const tile = style({
    position: "relative",
    width: "10.4rem",
    display: "grid",
    gap: ".6rem",
    padding: ".6rem",
    border: `.1rem solid ${vars.vox_border}`,
    borderRadius: vars.vox_radius,
    backgroundColor: vars.vox_surface,
    color: vars.dark_basic_text_color,
    cursor: "pointer",
    transition: `border-color ${vars.vox_motion_fast} ${vars.vox_ease}`,
    selectors: {
        "&:hover": { borderColor: vars.vox_field_border },
    },
});

// In use: the accent frame, as thick as the focus ring, inside the tile so nothing moves.
export const tileSelected = style({
    borderColor: vars.primary_600_color,
    boxShadow: `inset 0 0 0 .1rem ${vars.primary_600_color}`,
    selectors: {
        "&:hover": { borderColor: vars.primary_600_color },
    },
});

// The picture: the rail on the left, the canvas with a raised surface and an accent button. Its
// colours are the theme's (the tile's custom properties), not the page's.
export const preview = style({
    display: "grid",
    gridTemplateColumns: "1fr 3fr",
    height: "4.4rem",
    borderRadius: ".4rem",
    overflow: "hidden",
    border: `.1rem solid ${vars.dark_1000_color_66}`,
    selectors: {
        [`${radio}:focus-visible + &`]: { outline: `.2rem solid ${vars.vox_focus}`, outlineOffset: ".2rem" },
    },
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

export const name = style({
    display: "flex",
    alignItems: "center",
    gap: ".4rem",
    minWidth: 0,
    fontSize: "1.3rem",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
});

export const check = style({ width: "1.4rem", height: "1.4rem", flexShrink: 0, fill: vars.vox_state_active });

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
