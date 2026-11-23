import { style } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    flexDirection: "column",
});

export const obs_url_description = style({
    margin: ".4rem 0 1.2rem",
    color: vars.vox_description_text,
    fontSize: "1.2rem",
    lineHeight: 1.6,
    overflowWrap: "anywhere",
});

// What a usage event holds: aligned with the setting's own text, not the page edge.
export const telemetry_contents = style({
    margin: "0 0 1.2rem",
    padding: 0,
});
