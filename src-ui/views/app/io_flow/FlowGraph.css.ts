import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";

// Inputs on the left, steps in the middle, outputs on the right. Your voice is blue and chat
// purple, the colours of the message log; speech and its conversion share amber and rose.
// Unused arrows are dashed and grey; colour never carries the meaning alone.
const LANE_VOICE = "var(--lane_voice)", LANE_CHAT = "var(--lane_chat)", LANE_SPEECH = "var(--lane_speech)";
const UNUSED = "var(--unused)";

// The lane of a box, an arrow or a pulse; and the states of a box or an arrow.
export const lane_voice = style({});
export const lane_chat = style({});
export const lane_speech = style({});
export const off = style({});
export const direct = style({});
export const lit = style({});

// The container the graph is drawn in (IoFlowView.css.ts graph_scroll).
export const FLOW_FRAME = "io_flow_frame";
// The narrow columns, which the graph takes in a frame narrower than its wide ones (#1314, M-7: the
// default window's panel is 56.4rem, the wide columns 65.8rem) and in VR, which cannot scroll.
const NARROW_COLUMNS = "minmax(6rem, .8fr) minmax(7rem, 1fr) minmax(7rem, 1fr) minmax(12.5rem, 1.3fr) minmax(12rem, 1.6fr)";

export const graph = style({
    vars: {
        "--lane_voice": "#58b0ee", "--lane_chat": "#a58cf0", "--lane_speech": "#e0a656", "--conversion": "#f08cc2",
        "--output": "#4fb8a8", "--unused": "#4a5a75",
    },
    position: "relative", display: "grid", minWidth: "60rem",
    gridTemplateColumns: "minmax(8rem, 1fr) minmax(9rem, 1.1fr) minmax(10rem, 1.2fr) minmax(10rem, 1.2fr) minmax(16rem, 1.8fr)",
    gridTemplateRows: "repeat(6, auto)", gap: ".6rem 3.2rem", padding: ".4rem 0",
    "@container": { [`${FLOW_FRAME} (max-width: 65.8rem)`]: { minWidth: 0, gap: ".6rem 1.6rem", gridTemplateColumns: NARROW_COLUMNS } },
});

// VR cannot scroll: narrower columns, and the boxes keep their names and times only.
export const compact = style({
    minWidth: 0, gap: ".4rem 1.6rem",
    gridTemplateColumns: NARROW_COLUMNS,
});

export const edges = style({ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", zIndex: 0 });

export const node = style({
    position: "relative", zIndex: 1, alignSelf: "center", display: "flex", flexDirection: "column", gap: ".1rem",
    padding: ".5rem .9rem", border: `.1rem solid ${vars.vox_border}`, borderRadius: vars.vox_radius,
    background: vars.vox_surface, fontSize: "1.3rem", minWidth: 0,
    selectors: {
        [`${compact} &`]: { padding: ".3rem .7rem" },
    },
});

// Japanese names stay whole (keep-all) and break only where they must not overflow.
export const name = style({
    fontWeight: 600, color: vars.dark_200_color, wordBreak: "keep-all", overflowWrap: "anywhere",
    selectors: {
        [`${node}.${off} &`]: { color: vars.vox_description_text },
    },
});

export const abbr = style({ display: "block" });

export const detail = style({
    fontSize: "1.2rem", color: vars.vox_description_text, overflowWrap: "anywhere",
    selectors: {
        [`${compact} &`]: { display: "none" },
    },
});

export const time = style({ fontSize: "1.2rem", color: vars.vox_state_active, fontVariantNumeric: "tabular-nums" });

export const kind_input = style({
    borderWidth: ".2rem", padding: ".9rem 1.2rem",
    selectors: {
        // After the compact box's padding, which it overrides for an input.
        [`${compact} &`]: { padding: ".6rem .9rem" },
        [`&.${lane_voice}`]: { borderColor: LANE_VOICE },
        [`&.${lane_chat}`]: { borderColor: LANE_CHAT },
    },
});
export const kind_speech = style({ borderColor: LANE_SPEECH });
export const kind_conversion = style({ borderColor: "var(--conversion)" });
export const kind_output = style({ borderColor: "var(--output)", borderWidth: ".2rem", padding: ".4rem .9rem" });

// Not in use: dashed and quiet; its words say why. After the lanes' borders, which it overrides.
globalStyle(`${node}.${off}`, { borderStyle: "dashed", borderColor: UNUSED, borderWidth: ".1rem", background: "transparent" });

export const edge = style({
    fill: "none", strokeWidth: "2.2", opacity: .55,
    selectors: {
        [`&.${lane_voice}`]: { stroke: LANE_VOICE },
        [`&.${lane_chat}`]: { stroke: LANE_CHAT },
        [`&.${lane_speech}`]: { stroke: LANE_SPEECH },
        [`&.${off}`]: { stroke: UNUSED, strokeDasharray: "5 5", opacity: 1, strokeWidth: "1.6" },
        // VRChat reads the microphone itself: drawn dotted, not as an unused route.
        [`&.${direct}`]: { stroke: UNUSED, strokeDasharray: "1 5", strokeLinecap: "round", opacity: 1 },
        [`&.${lit}`]: { opacity: 1, strokeWidth: "3", filter: "drop-shadow(0 0 3px currentColor)" },
        [`&.${lit}.${lane_voice}`]: { color: LANE_VOICE },
        [`&.${lit}.${lane_chat}`]: { color: LANE_CHAT },
        [`&.${lit}.${lane_speech}`]: { color: LANE_SPEECH },
    },
});
export const head_on = style({ fill: vars.vox_secondary_text });
export const head_off = style({ fill: UNUSED });
export const head_lit = style({ fill: vars.dark_200_color });

// A new message: a light runs once along its path.
const flowPulse = keyframes({
    "0%": { strokeDashoffset: "18", opacity: 1 },
    "100%": { strokeDashoffset: "-600", opacity: 0 },
});
export const pulse = style({
    fill: "none", strokeWidth: "3.4", strokeLinecap: "round", strokeDasharray: "18 1200", strokeDashoffset: "18", opacity: 0,
    selectors: {
        [`&.${lane_voice}`]: { stroke: "#c7e6ff" },
        [`&.${lane_chat}`]: { stroke: "#e2d6ff" },
        [`&.${lane_speech}`]: { stroke: "#ffe1b0" },
    },
    "@media": { "(prefers-reduced-motion: no-preference)": { animation: `${flowPulse} 900ms ease-out 1` } },
});
