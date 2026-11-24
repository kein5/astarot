import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, draw, find, findIn, hooks, loadModule, setRef, stubGlobals, treeNode, unchecked } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
import * as ioFlow from "../../../logics/flow/ioFlow.ts";
import * as flowText from "../../../logics/flow/flowText.ts";
import * as featureLabel from "../../../logics/common/featureLabel.ts";
import { buildFlowGraph } from "../../../logics/flow/flowGraph.ts";
import type { FlowGraph as FlowGraphModel } from "../../../logics/flow/flowGraph.ts";
import type { Translate } from "../../../logics/flow/flowText.ts";
import type { FlowLane, FlowOutputRow, IoFlow, Trace } from "../../../logics/flow/ioFlow.ts";
import type { LanguageNames } from "../../../logics/common/languageNames.ts";

// The I/O flow graph: boxes on a grid and arrows measured from them. The graph itself is built by
// the real buildFlowGraph from the route map and traces the backend's tests share
// (tests/voice/fixtures/io_flow_sample.json); the page the boxes are measured on is a stand-in.

interface FlowSample {
    flow: IoFlow & { voice: FlowLane & { outputs: FlowOutputRow[] }; chat: FlowLane & { outputs: FlowOutputRow[] } };
    traces: Trace[];
}
// Test data: the sample the backend's tests share, read as far as these tests read it.
const sample = unchecked<FlowSample>(JSON.parse(readFileSync(new URL("../../../../tests/voice/fixtures/io_flow_sample.json", import.meta.url), "utf8")));

const t: Translate = (key, options) => options ? `${key}:${JSON.stringify(options)}` : key;
// Test data: the graph reads only language() of the names the panel builds.
const names = unchecked<LanguageNames>({ language: (name: string | null | undefined) => `lang(${name})` });

const graphOf = (flow: IoFlow, traces: Trace[] = sample.traces): FlowGraphModel => {
    const graph = buildFlowGraph(flow, traces);
    assert.ok(graph);
    return graph;
};
// The sample as it is: speech and the live voice go through the voice changer (RVC), and the
// newest message is a chat that reached the chatbox.
const converted = () => graphOf(sample.flow);
// The same settings without the voice changer: speech goes to the mic as it is, and VRChat reads
// the microphone itself.
const withoutConversion = () => graphOf({ ...sample.flow, conversion_round_trip_ms: null, voice: { ...sample.flow.voice,
    outputs: sample.flow.voice.outputs.map(row => row.id === "live_voice" ? { ...row, carried: "vrchat_mic", engine: null, during_speech: null }
        : row.id === "speech" ? { ...row, path: "device" } : row) } });

// The stand-in page lays each box out in the grid cell it asks for (style.gridColumn and
// style.gridRow): columns `column` px wide with 40 px between them, rows 60 px high with 20 px
// between boxes. The graph's corner is at (100, 50) on the screen, and the window's zoom enlarges
// everything on the screen, as the VR window's CSS zoom does.
interface Layout {
    zoom?: number;
    column?: number;
    // Not laid out (display: none): no size anywhere.
    hidden?: boolean;
    // Boxes moved from their cell, in the graph's own pixels.
    shift?: Partial<Record<string, { x?: number; y?: number }>>;
    // Boxes that are not on the page.
    missing?: string[];
}
const GAP = 40, ROW = 60, ROW_GAP = 20, ORIGIN = { left: 100, top: 50 };

// A ResizeObserver that keeps its callback, what it watches and whether it was disconnected.
class Observer {
    callback: () => void;
    observed: unknown[] = [];
    disconnected = false;
    constructor(callback: () => void) { this.callback = callback; }
    observe(element: unknown) { this.observed.push(element); }
    disconnect() { this.disconnected = true; }
}

async function setup(context: TestContext, translate: Translate = t) {
    const runtime = hooks(), observers: Observer[] = [];
    stubGlobals(context, { ResizeObserver: class extends Observer {
        constructor(callback: () => void) { super(callback); observers.push(this); }
    } });
    const { FlowGraph } = await loadModule<typeof import("./FlowGraph.tsx")>(new URL("./FlowGraph.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: translate }) },
        "../../../logics/flow/ioFlow.ts": ioFlow,
        "../../../logics/flow/flowText.ts": flowText,
        "../../../logics/common/featureLabel.ts": featureLabel,
    });
    let layout: Layout = {}, drawn: TreeNode | null = null;
    const column = () => layout.column ?? 200;
    const rect = (left: number, top: number, width: number, height: number) => {
        const zoom = layout.zoom ?? 1;
        return layout.hidden ? { left: 0, top: 0, width: 0, height: 0 }
            : { left: ORIGIN.left + left * zoom, top: ORIGIN.top + top * zoom, width: width * zoom, height: height * zoom };
    };
    const page = {
        get offsetWidth() { return layout.hidden ? 0 : 5 * column() + 4 * GAP; },
        getBoundingClientRect: () => rect(0, 0, page.offsetWidth, 6 * ROW),
        querySelector: (selector: string) => {
            const id = /^\[data-node="(\w+)"\]$/.exec(selector)?.[1];
            if (id === undefined || layout.missing?.includes(id)) return null;
            const cell = find(drawn, node => node.props["data-node"] === id)?.props.style;
            if (!cell) return null;
            const [start, end] = String(cell.gridRow).split(" / ").map(Number);
            const shift = layout.shift?.[id] ?? {};
            return { getBoundingClientRect: () => rect((cell.gridColumn - 1) * (column() + GAP) + (shift.x ?? 0),
                (start - 1) * ROW + (shift.y ?? 0), column(), (end - start) * ROW - ROW_GAP) };
        },
    };
    type Props = { graph: FlowGraphModel | null; compact?: boolean };
    // One render. With `mounted`, the root's ref gets the page, as React gives it the element.
    const render = (props: Props, { mounted = true } = {}) => runtime.render(FlowGraph, { names, ...props }, tree => {
        drawn = tree;
        if (tree && mounted) setRef(tree, page);
    });
    // The layout effect measures and sets the arrows; React then draws again with them.
    const measured = (props: Props, next: Layout = {}) => {
        layout = next;
        render(props);
        return render(props);
    };
    // The page changes size: the observer measures again, and React draws again.
    const resized = (props: Props, next: Layout) => {
        layout = next;
        const observer = observers.at(-1);
        assert.ok(observer);
        observer.callback();
        return render(props);
    };
    return { runtime, observers, page, render, measured, resized };
}

// The graph's drawing: the arrowheads, the arrows in the order they are drawn, and the pulses on
// the lit path. Read from the tree as drawn, so the keys are the view's own.
function drawing(tree: TreeNode | null) {
    assert.ok(tree);
    const svg = findIn(tree, node => node.type === "svg", "the arrows' drawing");
    const [defs, arrows, pulses]: [TreeNode, TreeNode[], TreeNode[]] = svg.props.children;
    return {
        svg, defs,
        arrows: arrows.map(path => ({ id: path.key, d: path.props.d, className: path.props.className, marker: path.props.markerEnd })),
        pulses: pulses.map(path => ({ key: path.key, d: path.props.d, className: path.props.className })),
    };
}
const pathsOf = (tree: TreeNode | null) => Object.fromEntries(drawing(tree).arrows.map(row => [row.id, row.d]));

// The words a part of the tree shows, its own parts drawn as React would draw them.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    if (!node) return "";
    return textOf(componentName(node) ? draw(node) : node.props.children);
};
const box = (tree: TreeNode | null, id: string) => findIn(tree, node => node.props["data-node"] === id, `the box ${id}`);
// What a box says, line by line: each line's class and its words.
function lines(tree: TreeNode | null, id: string): [string, string][] {
    const text = draw(findIn(box(tree, id), node => componentName(node) === "NodeText", "the box's words"));
    return React.Children.toArray(text.props.children).map(child => {
        const node = treeNode(child);
        assert.ok(node);
        const line = componentName(node) ? draw(node) : node;
        return [line.props.className, textOf(line)];
    });
}

test("each box sits in its grid cell, says its kind and lane, and is dashed when unused", async context => {
    const h = await setup(context);
    const tree = h.render({ graph: converted() });
    assert.ok(tree);
    assert.deepEqual([tree.props.className, tree.props.role, tree.props["aria-label"]], ["graph", "group", "io_flow.graph"]);
    const [svg, boxes]: [TreeNode, TreeNode[]] = tree.props.children;
    assert.deepEqual([svg.props.className, svg.props["aria-hidden"]], ["edges", "true"]);
    assert.deepEqual(boxes.map(node => [node.key, node.props["data-node"], node.props.style.gridColumn, node.props.style.gridRow, node.props.className]), [
        ["in_voice", "in_voice", 1, "1 / 3", "node kind_input lane_voice"],
        ["recognition", "recognition", 2, "1 / 3", "node kind_stage lane_voice"],
        ["translate_voice", "translate_voice", 3, "1 / 3", "node kind_stage lane_voice"],
        ["in_chat", "in_chat", 1, "5 / 7", "node kind_input lane_chat"],
        ["translate_chat", "translate_chat", 3, "5 / 7", "node kind_stage lane_chat"],
        ["speech", "speech", 4, "2 / 4", "node kind_speech"],
        ["conversion", "conversion", 4, "4 / 6", "node kind_conversion"],
        ["chatbox", "chatbox", 5, "1 / 2", "node kind_output"],
        ["live_voice", "live_voice", 5, "2 / 3", "node kind_output"],
        ["desktop_caption", "desktop_caption", 5, "3 / 4", "node kind_output"],
        ["vr_log", "vr_log", 5, "4 / 5", "node kind_output off"],
        ["clipboard", "clipboard", 5, "5 / 6", "node kind_output off"],
        ["websocket", "websocket", 5, "6 / 7", "node kind_output off"],
    ]);
    // The style object holds the cell and nothing else.
    assert.deepEqual(boxes[0].props.style, { gridColumn: 1, gridRow: "1 / 3" });
    // The VR window's graph is the compact one.
    assert.equal(h.render({ graph: converted(), compact: true })?.props.className, "graph compact");
});

test("each kind of arrowhead is defined once: in use, unused and lit", async context => {
    const h = await setup(context);
    const { defs } = drawing(h.render({ graph: converted() }));
    const markers: TreeNode[] = defs.props.children;
    assert.deepEqual(markers.map(marker => {
        const { children, ...props } = marker.props;
        return { key: marker.key, ...props, head: children.props };
    }), ["on", "off", "lit"].map(kind => ({ key: kind, id: `flow-arrow-${kind}`, viewBox: "0 0 8 8", refX: "7", refY: "4",
        markerWidth: "6", markerHeight: "6", orient: "auto", head: { d: "M0,0 L8,4 L0,8 z", className: `head_${kind}` } })));
});

test("arrows are measured from the boxes: from under the microphone, straight down a column, or curving across", async context => {
    const h = await setup(context);
    const graph = converted();
    // Nothing is drawn before the boxes are measured.
    const first = h.render({ graph });
    assert.deepEqual([drawing(first).arrows, drawing(first).pulses], [[], []]);
    const tree = h.render({ graph });
    const on = "url(#flow-arrow-on)", lit = "url(#flow-arrow-lit)";
    // Unused routes (to the VR log, the clipboard, the WebSocket, chat to speech) are not drawn.
    // The lit path of the newest message (a chat to the chatbox) comes last, on top.
    assert.deepEqual(drawing(tree).arrows, [
        { id: "in_voice>recognition", d: "M200,50 C224,50 212,50 236,50", className: "edge lane_voice", marker: on },
        { id: "recognition>translate_voice", d: "M440,50 C464,50 452,50 476,50", className: "edge lane_voice", marker: on },
        { id: "translate_voice>chatbox", d: "M680,50 C818,50 818,20 956,20", className: "edge lane_voice", marker: on },
        { id: "translate_voice>desktop_caption", d: "M680,50 C818,50 818,140 956,140", className: "edge lane_voice", marker: on },
        { id: "translate_chat>desktop_caption", d: "M680,290 C818,290 818,140 956,140", className: "edge lane_chat", marker: on },
        { id: "translate_voice>speech", d: "M680,50 C704,50 692,110 716,110", className: "edge lane_voice", marker: on },
        // Speech above its conversion, in one column: straight down to just above the box.
        { id: "speech>conversion", d: "M820,160 L820,176", className: "edge lane_speech", marker: on },
        // The live voice leaves the microphone from below and enters the conversion from the left.
        { id: "in_voice>conversion", d: "M100,100 C100,230 660,230 716,230", className: "edge lane_voice", marker: on },
        // Boxes close together still bend by at least 24 px.
        { id: "conversion>live_voice", d: "M920,230 C944,230 932,80 956,80", className: "edge lane_speech", marker: on },
        { id: "in_chat>translate_chat", d: "M200,290 C338,290 338,290 476,290", className: "edge lane_chat lit", marker: lit },
        { id: "translate_chat>chatbox", d: "M680,290 C818,290 818,20 956,20", className: "edge lane_chat lit", marker: lit },
    ]);
    // The lit path pulses once more on top, keyed by the message, so a new one plays it again.
    assert.equal(graph.pulse, "c2:chatbox");
    assert.deepEqual(drawing(tree).pulses, [
        { key: "c2:chatbox:in_chat>translate_chat", d: "M200,290 C338,290 338,290 476,290", className: "pulse lane_chat" },
        { key: "c2:chatbox:translate_chat>chatbox", d: "M680,290 C818,290 818,20 956,20", className: "pulse lane_chat" },
    ]);
});

test("VRChat reading the microphone itself is a dotted arrow drawn first, under the ones in use", async context => {
    const h = await setup(context);
    const tree = h.measured({ graph: withoutConversion() });
    const on = "url(#flow-arrow-on)";
    assert.deepEqual(drawing(tree).arrows, [
        { id: "in_voice>live_voice", d: "M100,100 C100,80 900,80 956,80", className: "edge lane_voice off direct", marker: "url(#flow-arrow-off)" },
        { id: "in_voice>recognition", d: "M200,50 C224,50 212,50 236,50", className: "edge lane_voice", marker: on },
        { id: "recognition>translate_voice", d: "M440,50 C464,50 452,50 476,50", className: "edge lane_voice", marker: on },
        { id: "translate_voice>chatbox", d: "M680,50 C818,50 818,20 956,20", className: "edge lane_voice", marker: on },
        { id: "translate_voice>desktop_caption", d: "M680,50 C818,50 818,140 956,140", className: "edge lane_voice", marker: on },
        { id: "translate_chat>desktop_caption", d: "M680,290 C818,290 818,140 956,140", className: "edge lane_chat", marker: on },
        { id: "translate_voice>speech", d: "M680,50 C704,50 692,110 716,110", className: "edge lane_voice", marker: on },
        // Speech goes to the mic VRChat hears without the conversion.
        { id: "speech>live_voice", d: "M920,110 C944,110 932,80 956,80", className: "edge lane_speech", marker: on },
        { id: "in_chat>translate_chat", d: "M200,290 C338,290 338,290 476,290", className: "edge lane_chat lit", marker: "url(#flow-arrow-lit)" },
        { id: "translate_chat>chatbox", d: "M680,290 C818,290 818,20 956,20", className: "edge lane_chat lit", marker: "url(#flow-arrow-lit)" },
    ]);
});

test("the VR window's zoom is taken out of the measures, and a graph not laid out yet draws without dividing by zero", async context => {
    const h = await setup(context);
    const graph = converted();
    const plain = pathsOf(h.measured({ graph }));
    const zoomed = await setup(context);
    assert.deepEqual(pathsOf(zoomed.measured({ graph }, { zoom: 1.5 })), plain);
    // Hidden: every box measures 0 at 0, and the arrows are drawn there, at a scale of 1.
    const hidden = await setup(context);
    const paths = pathsOf(hidden.measured({ graph }, { hidden: true }));
    assert.equal(paths["in_voice>recognition"], "M0,0 C24,0 -28,0 -4,0");
    assert.equal(paths["in_voice>conversion"], "M0,0 C0,0 -60,0 -4,0");
    // Not below the speech box, so not straight down.
    assert.equal(paths["speech>conversion"], "M0,0 C24,0 -28,0 -4,0");
});

test("a box less than 8 px aside from the one above joins it straight down; 8 px aside or touching, the arrow curves", async context => {
    const graph = converted();
    const speechToConversion = async (layout: Layout) => pathsOf((await setup(context)).measured({ graph }, layout))["speech>conversion"];
    assert.equal(await speechToConversion({ shift: { conversion: { x: 7 } } }), "M820,160 L827,176");
    assert.equal(await speechToConversion({ shift: { conversion: { x: 8 } } }), "M920,110 C944,110 700,230 724,230");
    assert.equal(await speechToConversion({ shift: { conversion: { x: -8 } } }), "M920,110 C944,110 684,230 708,230");
    // The conversion moved up 20 px begins where the speech box ends.
    assert.equal(await speechToConversion({ shift: { conversion: { y: -20 } } }), "M920,110 C944,110 692,210 716,210");
});

test("an arrow to or from a box that is not on the page is left out", async context => {
    const h = await setup(context);
    const paths = pathsOf(h.measured({ graph: converted() }, { missing: ["translate_chat"] }));
    assert.deepEqual(Object.keys(paths), ["in_voice>recognition", "recognition>translate_voice", "translate_voice>chatbox",
        "translate_voice>desktop_caption", "translate_voice>speech", "speech>conversion", "in_voice>conversion", "conversion>live_voice"]);
});

test("the graph is measured again when it resizes or changes, and stops watching when it goes", async context => {
    const h = await setup(context);
    const graph = converted();
    h.measured({ graph });
    assert.equal(h.observers.length, 1);
    assert.deepEqual(h.observers[0].observed, [h.page]);
    // Wider columns: the arrows follow the boxes.
    const wide = pathsOf(h.resized({ graph }, { column: 300 }));
    assert.equal(wide["in_chat>translate_chat"], "M300,290 C488,290 488,290 676,290");
    // A new message: the graph is new, so it is measured again and watched by a new observer.
    const voiceFirst = graphOf(sample.flow, sample.traces.filter(row => row.id !== "c2"));
    const tree = h.measured({ graph: voiceFirst }, { column: 300 });
    assert.deepEqual(h.observers.map(observer => observer.disconnected), [true, false]);
    assert.deepEqual(h.observers[1].observed, [h.page]);
    assert.deepEqual(drawing(tree).pulses.map(row => row.key), ["in_voice>recognition", "recognition>translate_voice",
        "translate_voice>chatbox", "translate_voice>speech", "speech>conversion", "conversion>live_voice"].map(id => `v5:chatbox,speech:${id}`));
    assert.equal(drawing(tree).pulses[0].className, "pulse lane_voice");
    h.runtime.unmount();
    assert.deepEqual(h.observers.map(observer => observer.disconnected), [true, true]);
});

test("nothing is measured before the graph has its element, and no graph draws nothing", async context => {
    const h = await setup(context);
    const graph = converted();
    h.render({ graph }, { mounted: false });
    assert.deepEqual(drawing(h.render({ graph }, { mounted: false })).arrows, []);
    assert.equal(h.observers.length, 0);
    const none = await setup(context);
    assert.equal(none.render({ graph: null }), null);
    assert.equal(none.observers.length, 0);
});

test("each box says what it is, what it does and how long the latest message took", async context => {
    const h = await setup(context);
    const tree = h.render({ graph: converted() });
    assert.deepEqual(lines(tree, "in_voice"), [["name", "io_flow.voice"]]);
    assert.deepEqual(lines(tree, "in_chat"), [["name", "io_flow.chat"]]);
    // The sample's newest voice message has no recognition time, only its wait.
    assert.deepEqual(lines(tree, "recognition"), [["name", "io_flow.stage.recognition"], ["detail", "io_flow.recognition_realtime"],
        ["time", "io_flow.stage.wait 8 ms"]]);
    assert.deepEqual(lines(tree, "translate_voice"), [["name", "io_flow.stage.translate"], ["detail", "lang(Japanese) → lang(English)"],
        ["time", "212 ms"]]);
    assert.deepEqual(lines(tree, "translate_chat"), [["name", "io_flow.stage.translate"], ["detail", "lang(Japanese) → lang(English)"],
        ["time", "198 ms"]]);
    assert.deepEqual(lines(tree, "speech"), [["name", "io_flow.output.speech"], ["detail", 'io_flow.speech_language:{"language":"lang(English)"}']]);
    assert.deepEqual(lines(tree, "conversion"), [["name", 'io_flow.conversion_with:{"engine":"RVC"}'], ["time", 'io_flow.round_trip:{"ms":31}']]);
    // An output: the latest time from each input that reached it, and what it does.
    assert.deepEqual(lines(tree, "chatbox"), [["name", "io_flow.output_node.chatbox"],
        ["time", "io_flow.lane_short.voice 226 ms · io_flow.lane_short.chat 209 ms"], ["detail", "io_flow.content.both"]]);
    assert.deepEqual(lines(tree, "live_voice"), [["name", "io_flow.output_node.live_voice"], ["time", "io_flow.lane_short.voice 851 ms"],
        ["detail", 'io_flow.live.converted:{"engine":"RVC"} · io_flow.during_speech.suppress']]);
    assert.deepEqual(lines(tree, "desktop_caption"), [["name", "io_flow.output_node.desktop_caption"], ["detail", "io_flow.used"]]);
    for (const id of ["vr_log", "clipboard", "websocket"]) {
        assert.deepEqual(lines(tree, id), [["name", `io_flow.output_node.${id}`], ["detail", "io_flow.reason.setting_off"]]);
    }
});

test("boxes say when an input or stage is off, and an output tells the lane that uses it, or why neither does", async context => {
    const row = (id: string, on: boolean, extra: Partial<FlowOutputRow> = {}): FlowOutputRow => ({ id, on, reason: on ? null : "setting_off", ...extra });
    const quiet: IoFlow = {
        voice: { on: false, recognition: { realtime: false, engine: "whisper" }, translation: { on: false, source: "Japanese", targets: [] },
            outputs: [row("chatbox", true, { content: "original" }), row("speech", false, { reason: "tts_off", path: "converted", language: "English" }),
                row("live_voice", true, { carried: "converted", engine: "seed-vc", during_speech: null }),
                row("desktop_caption", false), row("vr_log", false), row("clipboard", false)] },
        chat: { on: true, translation: { on: true, source: "Japanese", targets: ["English", "Korean"] },
            outputs: [row("chatbox", true, { content: "translation" }), row("speech", false, { reason: "chat_speech_off" }),
                row("desktop_caption", true), row("vr_log", false, { reason: "vrchat_off" }), row("websocket", false, { reason: "server_off" })] },
        conversion_round_trip_ms: null,
    };
    const traces: Trace[] = [
        { id: "q1", input: "voice", text: "テスト", origin: "final", stages: { recognition: 140, translate: 90 }, outputs: { chatbox: { state: "off" } } },
        { id: "q2", input: "chat", text: "了解", origin: "send", stages: { deliver: 12 }, outputs: { chatbox: { state: "sent", at_ms: 150 } } },
    ];
    const h = await setup(context);
    const tree = h.render({ graph: graphOf(quiet, traces) });
    assert.deepEqual(lines(tree, "in_voice"), [["name", "io_flow.voice"], ["detail", "io_flow.mic_off_short"]]);
    assert.equal(box(tree, "in_voice").props.className, "node kind_input lane_voice off");
    assert.deepEqual(lines(tree, "recognition"), [["name", "io_flow.stage.recognition"], ["detail", "whisper"],
        ["time", "io_flow.stage.recognition 140 ms"]]);
    // Translation off: no languages and no time, though the message has one from before.
    assert.deepEqual(lines(tree, "translate_voice"), [["name", "io_flow.stage.translate"], ["detail", "io_flow.translation_off"]]);
    // Several targets; no time when the message has none.
    assert.deepEqual(lines(tree, "translate_chat"), [["name", "io_flow.stage.translate"],
        ["detail", "lang(Japanese) → lang(English) / lang(Korean)"]]);
    // Speech off says so, though the route map names its language.
    assert.deepEqual(lines(tree, "speech"), [["name", "io_flow.output.speech"], ["detail", "io_flow.speech_off_short"]]);
    assert.equal(box(tree, "speech").props.className, "node kind_speech off");
    assert.deepEqual(lines(tree, "conversion"), [["name", 'io_flow.conversion_with:{"engine":"Seed-VC"}']]);
    // Both lanes use the chatbox: the voice lane's row says what it does. Only the chat reached it.
    assert.deepEqual(lines(tree, "chatbox"), [["name", "io_flow.output_node.chatbox"], ["time", "io_flow.lane_short.chat 150 ms"],
        ["detail", "io_flow.content.original"]]);
    assert.deepEqual(lines(tree, "live_voice"), [["name", "io_flow.output_node.live_voice"], ["detail", 'io_flow.live.converted:{"engine":"Seed-VC"}']]);
    const detail = (id: string) => lines(tree, id).find(([name]) => name === "detail")?.[1];
    // Only the chat uses the desktop captions.
    assert.equal(detail("desktop_caption"), "io_flow.used");
    // Neither lane uses these: the voice lane's reason, or the chat's when the voice lane has no row.
    assert.equal(detail("vr_log"), "io_flow.reason.setting_off");
    assert.equal(detail("clipboard"), "io_flow.reason.setting_off");
    assert.equal(detail("websocket"), "io_flow.reason.server_off");
});

test("the voice changer's box names its engine in brackets that stay whole, or none when it is not known", async context => {
    const english: Translate = (key, options) => key === "io_flow.conversion_with" ? `Voice changer (${String(options?.engine)})`
        : key === "io_flow.conversion" ? "Voice changer" : t(key, options);
    const named = await setup(context, english);
    const name = (tree: TreeNode | null) => {
        const feature = findIn(draw(findIn(box(tree, "conversion"), node => componentName(node) === "NodeText")),
            node => componentName(node) === "FeatureName", "the feature's name");
        const span = draw(feature);
        const [text, abbr] = span.props.children;
        return [span.props.className, text, abbr && [abbr.props.className, abbr.props.children]];
    };
    assert.deepEqual(name(named.render({ graph: converted() })), ["name", "Voice changer", ["abbr", "(RVC)"]]);
    const unknown = graphOf({ ...sample.flow, voice: { ...sample.flow.voice,
        outputs: sample.flow.voice.outputs.map(row => row.id === "live_voice" ? { ...row, engine: null } : row) } });
    assert.deepEqual(name(named.render({ graph: unknown })), ["name", "Voice changer", null]);
});

test("the live voice's box reads the graph's stand-in when the voice lane lists none; an output no lane lists stops", async context => {
    const voice = { ...sample.flow.voice, outputs: sample.flow.voice.outputs.filter(row => row.id !== "live_voice" && row.id !== "clipboard") };
    const graph = graphOf({ ...sample.flow, voice });
    const live = graph.nodes.find(node => node.id === "live_voice");
    assert.ok(live?.id === "live_voice");
    const h = await setup(context);
    const tree = h.render({ graph });
    assert.deepEqual(lines(tree, "live_voice"), [["name", "io_flow.output_node.live_voice"], ["time", "io_flow.lane_short.voice 851 ms"],
        ["detail", flowText.outputDetail(live.live, t, names)]]);
    assert.throws(() => lines(tree, "clipboard"), { name: "TypeError", message: "No lane has a row for the output clipboard" });
});
