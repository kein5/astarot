// The flow panel's data, shared by the main window, the desktop overlay and the VR window.
// - The route map comes from /get/data/io_flow: two lanes (the user's voice, typed chat),
//   each output on or off, and why when off.
// - Each of the user's own messages arrives as a trace from /run/io_trace: the ms from a
//   named origin to each stage and output. Speech that starts later sends the same id again.
// Every duration here is in ms.

export type FlowInput = "voice" | "chat";
export type Stage = "recognition" | "wait" | "translate" | "deliver";

// One output of a lane in the route map.
export interface FlowOutputRow {
    id: string;
    on: boolean;
    reason?: string | null;
    content?: string | null;
    path?: string | null;
    language?: string | null;
    carried?: string;
    engine?: string | null;
    during_speech?: string | null;
}

export interface FlowRecognition {
    realtime?: boolean;
    engine?: string | null;
}

// The core sends each lane's translation with its targets, empty while it is off
// (translation() in native/core/src/controller/voice/flow.rs).
export interface FlowTranslation {
    on: boolean;
    source?: string | null;
    targets: string[];
}

export interface FlowLane {
    on: boolean;
    recognition?: FlowRecognition;
    translation: FlowTranslation;
    outputs?: FlowOutputRow[];
}

// The route map from /get/data/io_flow.
export interface IoFlow {
    voice?: FlowLane | null;
    chat?: FlowLane | null;
    conversion_round_trip_ms?: unknown;
}

// One output's state in a trace (chatbox: "sent"; speech: "playing", "queued", ...).
export interface TraceOutput {
    state?: string;
    at_ms?: unknown;
    converted?: unknown;
    conversion_ms?: unknown;
    // Speech only: from asking the engine for this message to its first sound, without the
    // wait in the speech queue.
    synthesis_ms?: unknown;
}

// A trace from /run/io_trace, as isTrace accepts it.
export interface Trace {
    id: string;
    input: FlowInput;
    text: string;
    translation?: string | null;
    origin?: string;
    stages: Partial<Record<Stage, unknown>>;
    outputs: { chatbox?: TraceOutput; speech?: TraceOutput; [name: string]: TraceOutput | undefined };
}

// Anything that may be a trace, before isTrace has looked at it.
export interface TraceCandidate {
    id?: unknown;
    input?: unknown;
    stages?: unknown;
    outputs?: unknown;
}

export interface StageSegment {
    kind: Stage;
    start: number;
    ms: number;
}

export type OutputArrival =
    | { kind: "chatbox"; at: number; conversion?: undefined; end?: undefined }
    | { kind: "speech"; at: number; conversion: number | null; synthesis: number | null; end: number };

export interface OverlaySettings {
    count?: unknown;
}

export const TRACE_KEEP = 20;
export const INPUTS: readonly FlowInput[] = ["voice", "chat"];
// Stages before any output, in the order they happen.
export const STAGES: readonly Stage[] = ["recognition", "wait", "translate", "deliver"];

const isMs = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export const isTrace = (trace: TraceCandidate | null | undefined): trace is Trace => !!trace && typeof trace.id === "string"
    && (INPUTS as readonly unknown[]).includes(trace.input)
    && typeof trace.stages === "object" && trace.stages !== null
    && typeof trace.outputs === "object" && trace.outputs !== null;

// Newest last. A trace that comes again (speech started) replaces its earlier copy in place.
export const mergeTrace = (traces: Trace[] | null | undefined, trace: TraceCandidate | null | undefined): Trace[] | null | undefined => {
    if (!isTrace(trace)) return traces;
    const list = Array.isArray(traces) ? traces : [];
    const index = list.findIndex(row => row.id === trace.id);
    const next = index < 0 ? [...list, trace] : list.map((row, at) => at === index ? trace : row);
    return next.slice(-TRACE_KEEP);
};

// The most recent `count` traces, newest first; of one input when given.
export const latestTraces = (traces: Trace[] | null | undefined, count: number, input: FlowInput | null = null): Trace[] =>
    (Array.isArray(traces) ? traces : [])
        .filter(trace => input === null || trace.input === input).slice(-count).reverse();

// The stages before the outputs, as consecutive segments from the origin.
export const stageSegments = (trace: Trace | null | undefined): StageSegment[] => {
    const segments: StageSegment[] = [];
    let at = 0;
    for (const kind of STAGES) {
        const ms = trace?.stages?.[kind];
        if (!isMs(ms)) continue;
        segments.push({ kind, start: at, ms });
        at += ms;
    }
    return segments;
};

// When each output was reached, from the origin. The conversion's round trip is added to
// speech that went through it, as a guide (it is the recent median, not this message's own).
// Speech also tells how much of its time was the synthesis, which ends at its first sound.
export const outputArrivals = (trace: Trace | null | undefined): OutputArrival[] => {
    const rows: OutputArrival[] = [];
    const chatbox = trace?.outputs?.chatbox;
    if (chatbox?.state === "sent" && isMs(chatbox.at_ms)) rows.push({ kind: "chatbox", at: chatbox.at_ms });
    const speech = trace?.outputs?.speech;
    if (speech?.state === "playing" && isMs(speech.at_ms)) {
        const conversion = speech.converted === true && isMs(speech.conversion_ms) ? speech.conversion_ms : null;
        const synthesis = isMs(speech.synthesis_ms) ? Math.min(speech.synthesis_ms, speech.at_ms) : null;
        rows.push({ kind: "speech", at: speech.at_ms, conversion, synthesis, end: speech.at_ms + (conversion ?? 0) });
    }
    return rows;
};

// The time until the last output was reached, or the stages' end when nothing went out.
export const traceTotal = (trace: Trace | null | undefined): number | null => {
    const ends = outputArrivals(trace).map(row => row.end ?? row.at);
    const stages = stageSegments(trace);
    const last = stages.at(-1);
    if (last) ends.push(last.start + last.ms);
    return ends.length ? Math.max(...ends) : null;
};

export const median = (values: readonly unknown[]): number | null => {
    const sorted = values.filter(isMs).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

// The axis of a timeline: the total rounded up to a readable step, so bars of different
// messages can be compared at a glance.
export const timelineScale = (total: unknown): number => {
    if (!isMs(total) || total === 0) return 100;
    for (const step of [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 60000]) if (total <= step) return step;
    return Math.ceil(total / 60000) * 60000;
};

// How a duration is written everywhere in the flow: whole ms.
export const formatMs = (ms: unknown): string => isMs(ms) ? `${ms} ms` : "—";

// Settings for the overlays: the desktop strip, and how many inputs each overlay lists.
export const overlayCount = (settings: OverlaySettings | null | undefined): number => {
    const count = settings?.count;
    return Number.isInteger(count) && (count as number) >= 1 && (count as number) <= 3 ? count as number : 1;
};
