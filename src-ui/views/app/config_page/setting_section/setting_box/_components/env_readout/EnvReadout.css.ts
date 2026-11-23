import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

const envReadoutSpin = keyframes({ to: { transform: "rotate(360deg)" } });
const envReadoutDisc = keyframes({ from: { transform: "scale(0.4)", opacity: 0 } });
const envReadoutTick = keyframes({ from: { strokeDashoffset: "1" }, to: { strokeDashoffset: "0" } });

// A readout that keeps the mark's place: the words wrap beside the mark, which stays on their first line (#912).
export const reserved = style({});
// The work finished while the page was open: the disc settles in, then the check draws.
export const arrived = style({});

export const readout = style({
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.8rem 1.6rem",
    padding: "0.8rem 1.2rem",
    background: vars.vox_surface,
    borderLeft: `0.3rem solid ${vars.vox_readout_rule}`,
    borderRadius: vars.vox_radius,
    fontSize: "1.3rem",
    fontWeight: 500,
    lineHeight: 1.5,
    fontVariantNumeric: "tabular-nums",
    color: vars.dark_200_color,
    minWidth: 0,
    selectors: {
        [`&.${reserved}`]: { flexWrap: "nowrap", alignItems: "start" },
    },
});

// The tones: the rule on the left, and the words and the mark in the same colour. After the
// readout, as in the SCSS, so their rule's colour wins on the same element.
export const active = style({ borderLeftColor: vars.vox_state_active });
export const warning = style({ borderLeftColor: vars.vox_state_warning });
export const failed = style({ borderLeftColor: vars.vox_state_failed });

export const text = style({
    display: "grid",
    gap: "0.4rem",
    minWidth: 0,
    overflowWrap: "anywhere",
    selectors: {
        [`${active} &`]: { color: vars.vox_state_active },
        [`${warning} &`]: { color: vars.vox_state_warning },
        [`${failed} &`]: { color: vars.vox_state_failed },
    },
});

// Page styles also set paragraphs; the readout's own role wins inside it.
globalStyle(`${readout} ${text} p`, { margin: 0, font: "inherit", color: "inherit", lineHeight: "inherit" });

export const actions = style({
    display: "flex",
    flexWrap: "wrap",
    gap: "0.8rem",
});

// Work that ends in success: a spinning arc while it runs, then a filled disc with a check.
// It sits close to the words (the readout's own gap is wider).
export const mark = style({
    flex: "none",
    width: "1.8rem",
    height: "1.8rem",
    marginRight: "-0.8rem",
    color: vars.dark_400_color,
    selectors: {
        [`${active} &`]: { color: vars.vox_state_active },
        [`${warning} &`]: { color: vars.vox_state_warning },
    },
});
globalStyle(`${mark} svg`, { display: "block", width: "100%", height: "100%", overflow: "visible" });

export const ring = style({
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    // About two thirds of the circle (6px radius: 37.7px round).
    strokeDasharray: "25 13",
    transformBox: "fill-box",
    transformOrigin: "center",
    animation: `${envReadoutSpin} 0.9s linear infinite`,
});

export const disc = style({
    fill: vars.vox_state_active,
    selectors: {
        [`${arrived} &`]: {
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: `${envReadoutDisc} ${vars.vox_motion} ${vars.vox_ease_settle} both`,
        },
    },
});

export const tick = style({
    fill: "none",
    stroke: vars.vox_canvas,
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    selectors: {
        [`${arrived} &`]: {
            strokeDasharray: "1",
            animation: `${envReadoutTick} ${vars.vox_motion} ${vars.vox_ease} ${vars.vox_motion_fast} both`,
        },
    },
});
