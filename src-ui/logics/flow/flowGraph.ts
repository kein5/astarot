// The flow panel's graph: which input reaches which output, as boxes and arrows.
// Built from the route map (/get/data/io_flow) and the recent traces; pure, so the panel,
// the VR window and the tests share it. The view places the boxes on a grid and draws the
// arrows between them; this decides only what exists, what is in use and what lights up.
import { latestTraces, outputArrivals } from "./ioFlow.ts";
import type { FlowInput, FlowLane, FlowOutputRow, FlowRecognition, FlowTranslation, IoFlow, OutputArrival, Trace } from "./ioFlow.ts";

// A row of the route map, or what stands in for one the lane does not have.
export type FlowRouteRow = Partial<FlowOutputRow>;

export type FlowArrivals = Partial<Record<OutputArrival["kind"], OutputArrival>>;

// The outputs on the right, top to bottom. "live_voice" is what VRChat hears as the user's mic.
export type GraphOutput = "chatbox" | "live_voice" | "desktop_caption" | "vr_log" | "clipboard" | "websocket";

// The boxes, one type for each kind. A box of a lane names it; the others leave lane out, and
// their type says so, so that every box can be asked for its lane.
export interface InputNode {
    id: "in_voice" | "in_chat";
    kind: "input";
    lane: FlowInput;
    on: boolean;
}

// The voice lane's recognition, with what the route map says of it (FlowRecognition) and the
// latest message's time: the recognition, or the wait when the message has no recognition time.
export interface RecognitionNode extends FlowRecognition {
    id: "recognition";
    kind: "stage";
    lane: "voice";
    on: boolean;
    ms: unknown;
    msKind: "recognition" | "wait";
}

export interface TranslateNode {
    id: "translate_voice" | "translate_chat";
    kind: "stage";
    lane: FlowInput;
    on: boolean;
    translation: FlowTranslation;
    ms: unknown;
}

export interface SpeechNode {
    id: "speech";
    kind: "speech";
    lane?: undefined;
    on: boolean;
    language: string | null;
}

// Only there while something goes through the voice conversion. ms: its round trip.
export interface ConversionNode {
    id: "conversion";
    kind: "conversion";
    lane?: undefined;
    on: boolean;
    engine: string | null;
    ms: unknown;
}

// An output: each lane's row of the route map, and when the latest message of each lane reached it.
interface OutputNodeBase {
    kind: "output";
    lane?: undefined;
    on: boolean;
    rows: { voice: FlowOutputRow | undefined; chat: FlowOutputRow | undefined };
    times: { voice: number | null; chat: number | null };
}

// The live voice also carries the voice lane's own row, or what stands in for it.
export interface LiveVoiceNode extends OutputNodeBase {
    id: "live_voice";
    live: FlowRouteRow;
}

export interface OutputNode extends OutputNodeBase {
    id: Exclude<GraphOutput, "live_voice">;
    live: null;
}

export type FlowNode = InputNode | RecognitionNode | TranslateNode | SpeechNode | ConversionNode | LiveVoiceNode | OutputNode;

export interface FlowEdge {
    id: string;
    from: string;
    to: string;
    lane: FlowInput | "speech";
    on: boolean;
    direct?: boolean;
    lit?: boolean;
}

export interface FlowGraph {
    nodes: FlowNode[];
    edges: FlowEdge[];
    pulse: string | null;
    latest: { voice: Trace | null; chat: Trace | null };
    newest: Trace | null;
}

export const GRAPH_OUTPUTS: readonly GraphOutput[] = ["chatbox", "live_voice", "desktop_caption", "vr_log", "clipboard", "websocket"];

const byId = (lane: FlowLane | null | undefined): Partial<Record<string, FlowOutputRow>> =>
    Object.fromEntries((lane?.outputs ?? []).map(row => [row.id, row]));

const arrivalsOf = (trace: Trace | null): FlowArrivals => Object.fromEntries(outputArrivals(trace).map(row => [row.kind, row]));

export const buildFlowGraph = (flow: IoFlow | null | undefined, traces: Trace[] | null | undefined): FlowGraph | null => {
    if (!flow?.voice || !flow?.chat) return null;
    const voice = byId(flow.voice), chat = byId(flow.chat);
    const latest = { voice: latestTraces(traces, 1, "voice")[0] ?? null, chat: latestTraces(traces, 1, "chat")[0] ?? null };
    const arrivals: Record<FlowInput, FlowArrivals> = { voice: arrivalsOf(latest.voice), chat: arrivalsOf(latest.chat) };
    const live: FlowRouteRow = voice.live_voice ?? { on: false, carried: "vrchat_mic" };
    const speech: Record<FlowInput, FlowRouteRow> = { voice: voice.speech ?? { on: false }, chat: chat.speech ?? { on: false } };
    const converted = live.carried === "converted"
        || speech.voice.path === "converted" || speech.chat.path === "converted";

    const nodes: FlowNode[] = [
        { id: "in_voice", kind: "input", lane: "voice", on: flow.voice.on === true },
        { id: "recognition", kind: "stage", lane: "voice", on: flow.voice.on === true, ...flow.voice.recognition,
            ms: latest.voice?.stages?.recognition ?? latest.voice?.stages?.wait ?? null,
            msKind: latest.voice?.stages?.recognition !== undefined ? "recognition" : "wait" },
        { id: "translate_voice", kind: "stage", lane: "voice", on: flow.voice.translation?.on === true,
            translation: flow.voice.translation, ms: latest.voice?.stages?.translate ?? null },
        { id: "in_chat", kind: "input", lane: "chat", on: true },
        { id: "translate_chat", kind: "stage", lane: "chat", on: flow.chat.translation?.on === true,
            translation: flow.chat.translation, ms: latest.chat?.stages?.translate ?? null },
        { id: "speech", kind: "speech", on: speech.voice.on === true || speech.chat.on === true,
            language: speech.voice.language ?? speech.chat.language ?? null },
    ];
    if (converted) nodes.push({ id: "conversion", kind: "conversion", on: true, engine: live.engine ?? null,
        ms: Number.isInteger(flow.conversion_round_trip_ms) ? flow.conversion_round_trip_ms : null });
    for (const id of GRAPH_OUTPUTS) {
        const rows = { voice: voice[id], chat: chat[id] };
        const on = id === "live_voice" ? live.on === true || speech.voice.on === true || speech.chat.on === true
            : rows.voice?.on === true || rows.chat?.on === true;
        // Reached by speech: the time it began; by text: the time it was sent.
        const time = (lane: FlowInput) => id === "live_voice" ? (arrivals[lane].speech?.end ?? null)
            : id === "chatbox" ? (arrivals[lane].chatbox?.at ?? null) : null;
        const times = { voice: time("voice"), chat: time("chat") };
        nodes.push(id === "live_voice" ? { id, kind: "output", on, rows, live, times }
            : { id, kind: "output", on, rows, live: null, times });
    }

    const edges: FlowEdge[] = [];
    const edge = (from: string, to: string, lane: FlowEdge["lane"], on: unknown, extra: { direct?: boolean } = {}) =>
        edges.push({ id: `${from}>${to}`, from, to, lane, on: on === true, ...extra });
    // Text: the recognized speech and the typed chat, through translation, to each output.
    edge("in_voice", "recognition", "voice", flow.voice.on);
    edge("recognition", "translate_voice", "voice", flow.voice.on);
    edge("in_chat", "translate_chat", "chat", true);
    for (const id of ["chatbox", "desktop_caption", "vr_log", "clipboard", "websocket"]) {
        if (voice[id]) edge("translate_voice", id, "voice", voice[id].on);
        if (chat[id]) edge("translate_chat", id, "chat", chat[id].on);
    }
    // Speech: either lane's text is spoken, through the conversion when it runs, to the mic VRChat hears.
    edge("translate_voice", "speech", "voice", speech.voice.on);
    edge("translate_chat", "speech", "chat", speech.chat.on);
    const speechOn = speech.voice.on === true || speech.chat.on === true;
    const speechConverted = speech.voice.path === "converted" || speech.chat.path === "converted";
    if (speechConverted) edge("speech", "conversion", "speech", speechOn);
    else edge("speech", "live_voice", "speech", speechOn && live.carried !== "muted");
    // The live voice: converted, passed through, or read by VRChat itself (not through the app).
    if (live.carried === "converted") {
        edge("in_voice", "conversion", "voice", true);
    } else {
        edge("in_voice", "live_voice", "voice", live.carried === "passthrough", { direct: live.carried === "vrchat_mic" });
    }
    if (converted) edge("conversion", "live_voice", "speech", live.carried !== "muted");

    // Light the path of the newest message: where it went, and nothing it did not reach.
    const newest = latestTraces(traces, 1)[0] ?? null;
    const lit = new Set<string>();
    if (newest) {
        const lane = newest.input, translate = `translate_${lane}`, reached = arrivals[lane];
        const path = lane === "voice" ? ["in_voice>recognition", "recognition>translate_voice"] : ["in_chat>translate_chat"];
        if (reached.chatbox) path.push(`${translate}>chatbox`);
        if (reached.speech) {
            path.push(`${translate}>speech`);
            path.push(speechConverted ? "speech>conversion" : "speech>live_voice");
            if (speechConverted) path.push("conversion>live_voice");
        }
        if (reached.chatbox || reached.speech) path.forEach(id => lit.add(id));
    }
    for (const row of edges) row.lit = row.on && lit.has(row.id);
    const pulse = newest ? `${newest.id}:${Object.keys(arrivals[newest.input]).sort().join(",")}` : null;
    return { nodes, edges, pulse, latest, newest };
};
