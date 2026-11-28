import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../../../../../theme/vars.css.ts";

const fileDropBob = keyframes({ "50%": { transform: "translateY(-.25rem)" } });
const fileDropLine = keyframes({ from: { opacity: 0, transform: "translateY(.6rem)" } });
const fileDropCheck = keyframes({ from: { opacity: 0, transform: "scale(.4)" } });
const fileDropTick = keyframes({ from: { strokeDashoffset: "1" }, to: { strokeDashoffset: "0" } });

// A drop place in a settings form (DESIGN.md "Motion"). Quiet at rest like a field; while files
// are dragged over the window it wakes (blue rule, the arrow bobs), and under the pointer its
// fill lifts. A drop that fills a field turns the circle into a check.
export const zone = style({
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "center",
    gap: "1.2rem",
    padding: "1.2rem 1.4rem",
    border: `.1rem solid ${vars.vox_field_border}`,
    borderRadius: vars.vox_radius,
    background: vars.vox_surface,
    color: vars.dark_200_color,
    transition: `border-color ${vars.vox_motion_fast} ${vars.vox_ease}, background-color ${vars.vox_motion_fast} ${vars.vox_ease}`,
});

export const icon = style({
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "3.6rem",
    height: "3.6rem",
    borderRadius: "50%",
    background: vars.dark_850_color,
    color: vars.vox_secondary_text,
    transition: `transform ${vars.vox_motion} ${vars.vox_ease_settle}, background-color ${vars.vox_motion_fast} ${vars.vox_ease}, color ${vars.vox_motion_fast} ${vars.vox_ease}`,
});
globalStyle(`${icon} svg`, {
    position: "absolute",
    width: "2rem",
    height: "2rem",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
});

export const arrow = style({});
export const check = style({ opacity: 0 });
globalStyle(`${check} circle`, { fill: vars.vox_state_active, stroke: "none" });
globalStyle(`${check} path`, { stroke: vars.vox_canvas, strokeWidth: "2.4", strokeDasharray: "1", strokeDashoffset: "1" });

export const words = style({ display: "grid", gap: ".2rem", minWidth: 0, overflow: "hidden" });

export const title = style({
    fontSize: "1.4rem",
    fontWeight: 600,
    lineHeight: 1.5,
    overflowWrap: "anywhere",
    animation: `${fileDropLine} ${vars.vox_motion} ${vars.vox_ease}`,
});

export const hint = style({
    fontSize: "1.2rem",
    lineHeight: 1.6,
    color: vars.vox_description_text,
    overflowWrap: "anywhere",
});

// Read by screen readers only.
export const announce = style({
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
});

// The zone's states, after the zone so their rule's colour wins; their parts' rules in the
// SCSS order.
// Files are being dragged over the window.
export const awake = style({ borderColor: vars.vox_state_active });
globalStyle(`${awake} ${icon}`, { color: vars.vox_state_active });
globalStyle(`${awake} ${arrow}`, { animation: `${fileDropBob} 1s ${vars.vox_ease} infinite` });

// Over this zone with a file it takes.
export const over = style({
    borderColor: vars.vox_state_active,
    background: `color-mix(in srgb, ${vars.vox_highlight_tint}, ${vars.vox_surface})`,
});
globalStyle(`${over} ${icon}`, { transform: "scale(1.08)", background: vars.primary_600_color, color: vars.vox_on_primary });

// Over this zone, or dropped on it, with only files it does not take.
export const wrong = style({ borderColor: vars.vox_state_warning });
export const rejected = style({ borderColor: vars.vox_state_warning });
globalStyle(`${wrong} ${title}, ${rejected} ${title}`, { color: vars.vox_state_warning });
globalStyle(`${wrong} ${icon}, ${rejected} ${icon}`, { color: vars.vox_state_warning });

// The paths went into their fields.
export const done = style({ borderColor: vars.vox_state_active });
globalStyle(`${done} ${title}`, { color: vars.vox_state_active });
// The whole circle fills, with the check's own disc in the same blue.
globalStyle(`${done} ${icon}`, { background: vars.vox_state_active });
globalStyle(`${done} ${arrow}`, {
    opacity: 0,
    transform: "scale(.6)",
    transition: `opacity ${vars.vox_motion_fast} ${vars.vox_ease}, transform ${vars.vox_motion_fast} ${vars.vox_ease}`,
});
globalStyle(`${done} ${check}`, { opacity: 1, animation: `${fileDropCheck} ${vars.vox_motion} ${vars.vox_ease_settle} both` });
globalStyle(`${done} ${check} path`, { animation: `${fileDropTick} ${vars.vox_motion} ${vars.vox_ease} ${vars.vox_motion_fast} both` });

export const disabled = style({ opacity: .6 });
