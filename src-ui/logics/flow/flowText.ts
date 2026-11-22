// Words for the flow panel and its overlays. The main window words everything; the desktop
// overlay window only draws the strings it is handed. Durations are always whole ms.
import { formatMs, latestTraces, outputArrivals, stageSegments, timelineScale, traceTotal } from "./ioFlow.ts";
import type { FlowInput, FlowOutputRow, IoFlow, Stage, Trace } from "./ioFlow.ts";
import { isInteger } from "../common/numberGuards.ts";

// i18next's t, as far as it is used here.
export type Translate = (key: string, options?: Record<string, unknown>) => string;

// Names the panel shows for values of the route map.
export interface FlowNames {
    language: (language: string) => string;
}

export interface OffGroup {
    reason: string | null | undefined;
    outputs: string;
    text: string;
}

export interface TimelineRow {
    kind: string;
    stage?: Stage;
    label: string;
    value: string;
    start: number;
    end: number;
    off: boolean;
}

export interface StripRow {
    kind: string;
    label: string;
    value: string;
    start: number;
    end: number;
    off: boolean;
}

export interface StripItem {
    id: string;
    input: FlowInput;
    label: string;
    text: string;
    scale: number;
    rows: StripRow[];
}

const ENGINE_NAMES: Partial<Record<string, string>> = { rvc: "RVC", "seed-vc": "Seed-VC" };

// What an output of the route map does now, or why it is not used. The graph's live voice may
// pass what stands in for a row the voice lane does not have (FlowRouteRow), so any field may be missing.
export const outputDetail = (row: Partial<FlowOutputRow>, t: Translate, names: FlowNames): string => {
    if (!row.on) return t(`io_flow.reason.${row.reason}`);
    if (row.id === "chatbox") return t(`io_flow.content.${row.content}`);
    if (row.id === "speech") {
        return [
            row.content ? t(`io_flow.chat_speech.${row.content}`) : null,
            row.language ? t("io_flow.speech_language", { language: names.language(row.language) }) : null,
            t(`io_flow.speech_path.${row.path}`),
        ].filter(Boolean).join(" · ");
    }
    if (row.id === "live_voice") {
        const carried = row.carried === "converted"
            ? (ENGINE_NAMES[row.engine as string] ? t("io_flow.live.converted", { engine: ENGINE_NAMES[row.engine as string] }) : t("io_flow.live.converted_unknown"))
            : t(`io_flow.live.${row.carried}`);
        return row.during_speech ? `${carried} · ${t(`io_flow.during_speech.${row.during_speech}`)}` : carried;
    }
    return t("io_flow.used");
};

// The outputs not in use, one group per reason: "VR log, Clipboard" and why.
export const offGroups = (outputs: readonly FlowOutputRow[] | null | undefined, t: Translate): OffGroup[] => {
    const groups = new Map<string | null | undefined, string[]>();
    for (const row of outputs ?? []) {
        if (row.on) continue;
        let names = groups.get(row.reason);
        if (!names) {
            names = [];
            groups.set(row.reason, names);
        }
        names.push(t(`io_flow.output.${row.id}`));
    }
    return [...groups].map(([reason, names]) => ({ reason, outputs: names.join(t("io_flow.list_separator")),
        text: t(`io_flow.reason.${reason}`) }));
};

// The latest trace's time for an output of the route map, worded; null when it has none.
export const outputTime = (row: FlowOutputRow, trace: Trace | null | undefined, t: Translate): string | null => {
    if (!trace) return null;
    const state = trace.outputs?.[row.id === "speech" ? "speech" : row.id]?.state;
    const arrival = outputArrivals(trace).find(entry => entry.kind === row.id);
    if (arrival) return formatMs(arrival.end ?? arrival.at);
    if ((["queued", "not_spoken", "off", "superseded", "failed"] as readonly (string | undefined)[]).includes(state)) return t(`io_flow.state.${state}`);
    return null;
};

// The rows of a timeline: the stages one after another, then each output's arrival.
export const timelineRows = (trace: Trace | null | undefined, t: Translate): TimelineRow[] => {
    const rows: TimelineRow[] = stageSegments(trace).map(segment => ({
        kind: "stage", stage: segment.kind, label: t(`io_flow.stage.${segment.kind}`), value: formatMs(segment.ms),
        start: segment.start, end: segment.start + segment.ms, off: false,
    }));
    for (const arrival of outputArrivals(trace)) {
        // The synthesis is the last part of the way to the first sound, drawn on its own row.
        if (arrival.kind === "speech" && arrival.synthesis !== null) {
            rows.push({ kind: "synthesis", label: t("io_flow.synthesis"), value: formatMs(arrival.synthesis),
                start: arrival.at - arrival.synthesis, end: arrival.at, off: false });
        }
        rows.push({ kind: arrival.kind, label: t(`io_flow.output_short.${arrival.kind}`), value: formatMs(arrival.at),
            start: 0, end: arrival.at, off: false });
        if (arrival.conversion !== null && arrival.conversion !== undefined) {
            rows.push({ kind: "conversion", label: t("io_flow.conversion_guide"), value: formatMs(arrival.conversion),
                start: arrival.at, end: arrival.end, off: false });
        }
    }
    // Outputs the message did not reach say so, without a bar.
    for (const name of ["chatbox", "speech"]) {
        const state = trace?.outputs?.[name]?.state;
        if ((["off", "superseded", "failed", "not_spoken", "queued"] as readonly (string | undefined)[]).includes(state)) {
            rows.push({ kind: name, label: t(`io_flow.output_short.${name}`), value: t(`io_flow.state.${state}`), start: 0, end: 0, off: true });
        }
    }
    return rows;
};

// One line of at most `limit` characters, counted as the native side counts them (code points),
// so an emoji at the limit is never cut in half. The native side refuses control characters in
// the strip, and a line break from speech or a pasted message would take the whole snapshot with
// it, so each run of them becomes one space. A lone surrogate is dropped: it cannot be sent.
export const oneLine = (text: string, limit: number): string => [...String(text ?? "").replace(/\p{Cc}+/gu, " ").trim()]
    .filter(char => char.length > 1 || char < "\uD800" || char > "\uDFFF")
    .slice(0, limit).join("");

// The desktop strip: the newest `count` inputs, worded and ready to draw.
export const stripItems = (traces: Trace[] | null | undefined, count: number, t: Translate): StripItem[] => latestTraces(traces, count).map((trace): StripItem => {
    const total = traceTotal(trace);
    return {
        id: trace.id, input: trace.input,
        label: oneLine(t(`io_flow.${trace.input}`), 120),
        text: oneLine(trace.translation ? `${trace.text} → ${trace.translation}` : trace.text, 200),
        scale: Math.min(timelineScale(total ?? 0), 600000),
        // The strip window draws stages, outputs and the conversion (caption_overlay.rs), not the synthesis.
        rows: timelineRows(trace, t).filter(row => row.kind !== "synthesis")
            .filter(row => row.kind !== "stage" || (["recognition", "translate"] as readonly (string | undefined)[]).includes(row.stage))
            .slice(0, 8).map(({ kind, label, value, start, end, off }) => ({
            kind, label: oneLine(label, 120), value: oneLine(value, 120),
            start: Math.min(start, 600000), end: Math.min(end, 600000), off })),
    };
}).map(item => ({ ...item, rows: item.rows.map(row => ({ ...row, end: Math.min(row.end, item.scale), start: Math.min(row.start, item.scale) })) }));

// The live reading under the strip: the conversion's recent round trip, while it runs.
export const flowNote = (flow: IoFlow | null | undefined, t: Translate): string => {
    const ms = flow?.conversion_round_trip_ms;
    return isInteger(ms) ? oneLine(t("io_flow.conversion_live", { ms }), 120) : "";
};
