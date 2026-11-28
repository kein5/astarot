import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../theme/vars.css.ts";
import { FLOW_FRAME } from "./FlowGraph.css.ts";

// The flow panel: the graph, the outputs not in use, and the latest times of each input.
export const view = style({ display: "flex", flexDirection: "column", gap: "1.2rem", fontSize: "1.3rem", color: vars.dark_200_color });
export const compact = style({ gap: ".8rem" });

// The quiet lines: waiting for the first answer, no message yet, where a time comes from, the live note.
const quiet = { color: vars.vox_description_text, fontSize: "1.2rem", margin: 0 };
export const waiting = style(quiet);
export const no_trace = style(quiet);
export const origin = style(quiet);
export const live = style({ ...quiet, fontVariantNumeric: "tabular-nums" });

// A narrow window scrolls the graph sideways instead of squeezing its boxes.
// The graph's frame: narrower than the graph's wide columns, the graph takes its narrow ones
// instead of running past the frame (#1314, M-7; FlowGraph.css.ts).
export const graph_scroll = style({ overflowX: "auto", containerType: "inline-size", containerName: FLOW_FRAME });

// The devices the running captions record (#1314, M-6): one short line each, above the graph.
export const devices = style({ display: "flex", flexWrap: "wrap", gap: ".2rem 1.6rem", margin: 0, padding: 0, listStyle: "none",
    fontSize: "1.2rem", color: vars.vox_description_text, overflowWrap: "anywhere" });

// Side by side when the panel is wide, so the list ends higher up and the panel opened at
// 1200 x 850 shows it to its last row (#475); one column in a narrow panel.
export const unused = style({
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(30rem, 1fr))", gap: ".3rem 1.2rem", margin: 0, padding: 0, listStyle: "none",
    fontSize: "1.2rem", color: vars.vox_description_text,
});
globalStyle(`${unused} li`, { display: "flex", gap: ".6rem", alignItems: "baseline", overflowWrap: "anywhere" });
export const lane_mark = style({ flexShrink: 0, padding: "0 .5rem", borderRadius: ".4rem", fontWeight: 600, color: "#0b0f18" });
export const mark_voice = style({ background: "#58b0ee" });
export const mark_chat = style({ background: "#a58cf0" });

export const latest_pair = style({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(30rem, 1fr))", gap: "1.2rem" });
export const latest = style({
    display: "flex", flexDirection: "column", gap: ".4rem", padding: ".8rem 1.2rem", margin: 0,
    borderLeft: `.3rem solid ${vars.vox_readout_rule}`, borderRadius: vars.vox_radius, background: vars.vox_surface,
});
export const latest_voice = style({ borderLeftColor: "#58b0ee" });
export const latest_chat = style({ borderLeftColor: "#a58cf0" });
export const latest_title = style({ fontSize: "1.4rem", fontWeight: 600, margin: 0 });
export const latest_head = style({ display: "flex", justifyContent: "space-between", gap: "1.2rem", margin: 0 });
export const latest_text = style({ minWidth: 0, overflowWrap: "anywhere" });
export const latest_total = style({ whiteSpace: "nowrap", fontWeight: 600, fontVariantNumeric: "tabular-nums" });

export const timeline = style({ display: "grid", gap: ".3rem" });
export const is_off = style({});
export const row = style({ display: "grid", gridTemplateColumns: "minmax(8rem, 12rem) 1fr auto", alignItems: "center", gap: ".8rem", fontSize: "1.2rem" });
export const row_label = style({ overflowWrap: "anywhere", color: vars.vox_secondary_text });
export const row_value = style({
    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: "right", minWidth: "6.4rem",
    selectors: {
        [`${row}.${is_off} &`]: { color: vars.vox_description_text },
    },
});
export const track = style({ position: "relative", height: "1rem", borderRadius: ".2rem", background: vars.vox_canvas });
export const no_track = style({ background: "transparent" });
export const bar = style({
    position: "absolute", top: 0, bottom: 0, borderRadius: ".2rem", background: vars.vox_state_active,
    "@media": { "(prefers-reduced-motion: no-preference)": { transition: "width 120ms, left 120ms" } },
});
// Stages blue, outputs in the colours of their boxes, the conversion as a dashed extension of speech.
export const bar_stage = style({ background: "#5b92ff" });
export const bar_chatbox = style({ background: "#4fb8a8" });
export const bar_speech = style({ background: "#e0a656" });
export const bar_synthesis = style({ background: "#b9772a" });
export const bar_conversion = style({ background: "repeating-linear-gradient(90deg, #f08cc2 0 .4rem, transparent .4rem .6rem)" });
export const axis = style({ display: "flex", justifyContent: "space-between", fontSize: "1.2rem", color: vars.vox_description_text, fontVariantNumeric: "tabular-nums" });
export const axis_row = style({});
globalStyle(`${axis_row} > span:last-child`, { minWidth: "6.4rem" });

export const history = style({ display: "flex", alignItems: "flex-end", gap: "1rem", marginTop: ".4rem" });
export const bars = style({ display: "flex", alignItems: "flex-end", gap: ".2rem", height: "2.6rem" });
export const is_last = style({});
export const spark = style({
    width: ".6rem", borderRadius: ".1rem", background: vars.vox_border,
    selectors: {
        [`&.${is_last}`]: { background: vars.vox_state_active },
    },
});
export const history_text = style({ fontSize: "1.2rem", color: vars.vox_secondary_text, fontVariantNumeric: "tabular-nums" });

// The GPU memory: one row per GPU, the app's parts in the colours of their boxes, the rest of
// the GPU's use in grey, on a track that stands for the GPU's whole memory.
export const gpu = style({
    display: "flex", flexDirection: "column", gap: ".6rem", padding: ".8rem 1.2rem", margin: 0,
    borderLeft: `.3rem solid ${vars.vox_readout_rule}`, borderRadius: vars.vox_radius, background: vars.vox_surface,
});
// The heading and its hint. The bubble opens above the heading at every width: the readout is
// the last part of the panel, which clips what goes below it.
export const gpu_title = style({ display: "flex", alignItems: "center", alignSelf: "flex-start" });
globalStyle(`${gpu_title} [data-slot="tooltip-content"]`, { top: "auto", bottom: "calc(100% + .6rem)" });
export const gpu_list = style({ display: "grid", gap: ".8rem", margin: 0, padding: 0, listStyle: "none" });
export const gpu_row = style({ display: "grid", gap: ".3rem" });
export const gpu_head = style({ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: ".2rem 1.2rem", margin: 0 });
export const gpu_name = style({ minWidth: 0, overflowWrap: "anywhere", fontWeight: 600 });
export const gpu_whole = style({ whiteSpace: "nowrap", color: vars.vox_secondary_text, fontVariantNumeric: "tabular-nums" });
export const gpu_track = style({ display: "flex", height: "1rem", overflow: "hidden", borderRadius: ".2rem", background: vars.vox_canvas });
export const gpu_segment = style({
    height: "100%",
    "@media": { "(prefers-reduced-motion: no-preference)": { transition: "width 200ms" } },
});
export const gpu_speech = style({ background: "#e0a656" });
export const gpu_conversion = style({ background: "#f08cc2" });
export const gpu_other = style({ background: "#5b92ff" });
export const gpu_rest = style({ background: vars.vox_border });
export const gpu_app = style({ margin: 0, fontSize: "1.2rem", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" });
// The legend of the bar: one item per part the app uses, its swatch in the bar's colour.
export const gpu_parts = style({
    display: "flex", flexWrap: "wrap", gap: ".2rem 1.2rem", margin: 0, padding: 0, listStyle: "none",
    fontSize: "1.2rem", color: vars.vox_secondary_text, fontVariantNumeric: "tabular-nums",
});
globalStyle(`${gpu_parts} li`, { display: "flex", alignItems: "center", gap: ".5rem" });
export const gpu_swatch = style({ flexShrink: 0, width: ".9rem", height: ".9rem", borderRadius: ".2rem" });
