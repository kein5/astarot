import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { componentName, draw, find, findIn, hooks, loadModule, nodesIn, treeNode, unchecked } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
import * as ioFlow from "../../../logics/flow/ioFlow.ts";
import * as flowText from "../../../logics/flow/flowText.ts";
import * as flowGraph from "../../../logics/flow/flowGraph.ts";
import * as gpuMemory from "../../../logics/flow/gpuMemory.ts";
import type { GpuMemory } from "../../../logics/flow/gpuMemory.ts";
import type { TimelineRow, Translate } from "../../../logics/flow/flowText.ts";
import type { FlowLane, FlowOutputRow, IoFlow, Trace } from "../../../logics/flow/ioFlow.ts";

// The I/O flow panel, drawn with the real route map logic (ioFlow, flowText, flowGraph, gpuMemory)
// from the route map and traces the backend's tests share (tests/voice/fixtures/io_flow_sample.json).
// The graph is drawn by its own part (FlowGraph.test.ts); here it is a stand-in that keeps its props.

interface FlowSample {
    flow: IoFlow & { voice: FlowLane & { outputs: FlowOutputRow[] }; chat: FlowLane & { outputs: FlowOutputRow[] } };
    traces: Trace[];
}
// Test data: the sample the backend's tests share, read as far as these tests read it.
const sample = unchecked<FlowSample>(JSON.parse(readFileSync(new URL("../../../../tests/voice/fixtures/io_flow_sample.json", import.meta.url), "utf8")));
const traceOf = (id: string) => {
    const trace = sample.traces.find(row => row.id === id);
    assert.ok(trace);
    return trace;
};

const t: Translate = (key, options) => key === "io_flow.list_separator" ? ", " : options ? `${key}:${JSON.stringify(options)}` : key;

async function setup() {
    const runtime = hooks(), i18n = { language: "en" };
    const module = await loadModule<typeof import("./IoFlowView.tsx")>(new URL("./IoFlowView.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t, i18n }) },
        // The language names are built for the UI's language; the stand-in says which one.
        "../../../logics/common/languageNames.ts": { createLanguageNames: (language: string) => ({ uiLanguage: language }) },
        "../../../logics/flow/ioFlow.ts": ioFlow,
        "../../../logics/flow/flowText.ts": flowText,
        "../../../logics/flow/flowGraph.ts": flowGraph,
        "../../../logics/flow/gpuMemory.ts": gpuMemory,
        "./FlowGraph": { FlowGraph: "graph" },
        "../config_page/setting_section/setting_box/_components/hint/Hint": { Hint: "hint" },
    });
    const render = (props: Parameters<typeof module.IoFlowView>[0]) => {
        const tree = runtime.render(module.IoFlowView, props);
        assert.ok(tree);
        return tree;
    };
    return { runtime, i18n, render, Timeline: module.Timeline };
}

const part = (tree: unknown, name: string) => findIn(tree, node => componentName(node) === name, name);
const classed = (tree: unknown, className: string) => find(tree, node => node.props.className === className);
// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};

async function gpuSection(memory: GpuMemory | null) {
    const h = await setup();
    return draw(part(h.render({ flow: sample.flow, traces: [], gpuMemory: memory }), "GpuMemorySection"));
}

test("until both lanes are known, the panel says it is reading the settings", async () => {
    const h = await setup();
    for (const flow of [null, { voice: sample.flow.voice }, { chat: sample.flow.chat }]) {
        const tree = h.render({ flow, traces: sample.traces });
        assert.deepEqual([tree.type, tree.props.className, tree.props.role, tree.props.children], ["p", "waiting", "status", "io_flow.loading"]);
    }
});

test("the graph is built from the route map and traces, with names in the UI's language, and built again only when they change", async () => {
    const h = await setup();
    const graphOf = (tree: TreeNode) => findIn(findIn(tree, node => node.props.className === "graph_scroll", "the graph's scroll"),
        node => node.type === "graph", "the graph");
    const view = h.render({ flow: sample.flow, traces: sample.traces });
    assert.equal(view.props.className, "view");
    const graph = graphOf(view);
    assert.deepEqual(graph.props, { graph: flowGraph.buildFlowGraph(sample.flow, sample.traces), names: { uiLanguage: "en" }, compact: false });
    // The same route map and traces: the same graph and names.
    const again = graphOf(h.render({ flow: sample.flow, traces: sample.traces })).props;
    assert.equal(again.graph, graph.props.graph);
    assert.equal(again.names, graph.props.names);
    // A new message: a new graph.
    const traces = sample.traces.filter(row => row.id !== "c2");
    assert.equal(graphOf(h.render({ flow: sample.flow, traces })).props.graph.pulse, "v5:chatbox,speech");
    // The UI's language changes: names in the new one.
    h.i18n.language = "ja";
    assert.deepEqual(graphOf(h.render({ flow: sample.flow, traces })).props.names, { uiLanguage: "ja" });
});

test("outputs a lane does not use are listed by lane and reason, but not in VR or when every output is used", async () => {
    const h = await setup();
    const list = classed(h.render({ flow: sample.flow, traces: sample.traces }), "unused");
    assert.ok(list);
    assert.equal(list.type, "ul");
    const items: TreeNode[] = list.props.children;
    assert.deepEqual(items.map(item => {
        const [mark, text] = item.props.children;
        return [item.key, mark.props.className, mark.props.children, text];
    }), [
        ["voice:setting_off", "lane_mark mark_voice", "io_flow.lane_short.voice",
            'io_flow.unused:{"outputs":"io_flow.output.vr_log, io_flow.output.clipboard, io_flow.output.websocket","reason":"io_flow.reason.setting_off"}'],
        ["chat:chat_speech_off", "lane_mark mark_chat", "io_flow.lane_short.chat",
            'io_flow.unused:{"outputs":"io_flow.output.speech","reason":"io_flow.reason.chat_speech_off"}'],
        ["chat:setting_off", "lane_mark mark_chat", "io_flow.lane_short.chat",
            'io_flow.unused:{"outputs":"io_flow.output.vr_log, io_flow.output.websocket","reason":"io_flow.reason.setting_off"}'],
    ]);
    const vr = h.render({ flow: sample.flow, traces: sample.traces, compact: true });
    assert.equal(vr.props.className, "view compact");
    assert.equal(classed(vr, "unused"), null);
    const used = (lane: FlowLane & { outputs: FlowOutputRow[] }) => ({ ...lane, outputs: lane.outputs.map(row => ({ ...row, on: true, reason: null })) });
    assert.equal(classed(h.render({ flow: { ...sample.flow, voice: used(sample.flow.voice), chat: used(sample.flow.chat) }, traces: [] }), "unused"), null);
});

test("each lane's latest message is shown beside the other's; VR shows only the newest input", async () => {
    const h = await setup();
    const pair = classed(h.render({ flow: sample.flow, traces: sample.traces }), "latest_pair");
    assert.ok(pair);
    const latest: TreeNode[] = pair.props.children;
    assert.deepEqual(latest.map(node => [componentName(node), node.key, node.props.lane, node.props.trace?.id,
        node.props.history.map((row: Trace) => row.id), node.props.compact]), [
        ["Latest", "voice", "voice", "v5", ["v5", "v4", "v3", "v2", "v1"], undefined],
        ["Latest", "chat", "chat", "c2", ["c2", "c1"], undefined],
    ]);
    const vr = h.render({ flow: sample.flow, traces: sample.traces, compact: true });
    assert.equal(classed(vr, "latest_pair"), null);
    assert.deepEqual(part(vr, "Latest").props, { trace: traceOf("c2"), history: [], compact: true });
    // Nothing measured yet: no message.
    assert.equal(part(h.render({ flow: sample.flow, traces: [], compact: true }), "Latest").props.trace, null);
});

test("a lane's latest message shows its words, total, origin, timeline and the totals of recent ones", async () => {
    const h = await setup();
    const [voice, chat]: TreeNode[] = findIn(h.render({ flow: sample.flow, traces: sample.traces }),
        node => node.props.className === "latest_pair").props.children;
    const section = draw(voice);
    assert.deepEqual([section.type, section.props.className, section.props["aria-label"]], ["section", "latest latest_voice", "io_flow.voice"]);
    const title = findIn(section, node => node.type === "h3");
    assert.deepEqual([title.props.className, title.props.children], ["latest_title", "io_flow.voice"]);
    assert.equal(classed(section, "latest_text")?.props.children, 'io_flow.latest_text:{"text":"ありがとうございます。お願いします！"}');
    // Speech reached the mic at 820 ms and the voice changer's round trip (31 ms) is added.
    assert.equal(textOf(classed(section, "latest_total")), "io_flow.total 851 ms");
    assert.equal(classed(section, "origin")?.props.children, "io_flow.origin.final");
    // The timeline's axis is the total rounded up to a readable step.
    assert.deepEqual(part(section, "Timeline").props, { rows: flowText.timelineRows(traceOf("v5"), t), scale: 1000 });
    // The recent totals, oldest first, and their median.
    assert.deepEqual(part(section, "History").props, { totals: [790, 942, 871, 1213, 851], middle: 871 });
    const chatSection = draw(chat);
    assert.equal(chatSection.props.className, "latest latest_chat");
    assert.equal(textOf(classed(chatSection, "latest_total")), "io_flow.total 213 ms");
    assert.equal(part(chatSection, "Timeline").props.scale, 500);
    assert.deepEqual(part(chatSection, "History").props, { totals: [190, 213], middle: 213 });
});

test("VR's newest input is titled by its lane, without its origin or history", async () => {
    const h = await setup();
    const section = draw(part(h.render({ flow: sample.flow, traces: sample.traces, compact: true }), "Latest"));
    assert.deepEqual([section.props.className, section.props["aria-label"]], ["latest latest_chat", "io_flow.chat"]);
    assert.equal(classed(section, "origin"), null);
    assert.equal(find(section, node => componentName(node) === "History"), null);
    assert.ok(find(section, node => componentName(node) === "Timeline"));
});

test("a lane with no message says nothing is measured yet; VR names it the newest input", async () => {
    const h = await setup();
    const lone = sample.traces.filter(row => row.input === "voice");
    const [, chat]: TreeNode[] = findIn(h.render({ flow: sample.flow, traces: lone }), node => node.props.className === "latest_pair").props.children;
    const empty = (section: TreeNode) => [section.type, section.props.className, section.props["aria-label"],
        nodesIn(section).slice(1).map(node => [node.type, node.props.className, node.props.children])];
    assert.deepEqual(empty(draw(chat)), ["section", "latest", undefined,
        [["h3", "latest_title", "io_flow.chat"], ["p", "no_trace", "io_flow.no_trace"]]]);
    const vr = part(h.render({ flow: sample.flow, traces: [], compact: true }), "Latest");
    assert.deepEqual(empty(draw(vr)), ["section", "latest", undefined,
        [["h3", "latest_title", "io_flow.newest"], ["p", "no_trace", "io_flow.no_trace"]]]);
});

test("a message with nothing measured has no total and is left out of the history, which needs two totals", async () => {
    const h = await setup();
    const unmeasured: Trace = { id: "x", input: "voice", text: "…", origin: "final", stages: {}, outputs: { chatbox: { state: "queued" } } };
    const latestVoice = (traces: Trace[]) => draw(findIn(h.render({ flow: sample.flow, traces }), node => componentName(node) === "Latest"));
    const newest = latestVoice([traceOf("v1"), unmeasured]);
    assert.equal(textOf(classed(newest, "latest_total")), "io_flow.total —");
    assert.equal(part(newest, "Timeline").props.scale, 100);
    // Only one of the two has a total.
    assert.equal(find(newest, node => componentName(node) === "History"), null);
    const between = latestVoice([traceOf("v1"), unmeasured, traceOf("v2")]);
    assert.deepEqual(part(between, "History").props, { totals: [790, 942], middle: 942 });
});

test("the history draws each total as a bar of its share of the largest, at least 8% high, the newest marked", async () => {
    const h = await setup();
    const chat = (id: string, ms: number): Trace => ({ id, input: "chat", text: id, origin: "send", stages: { translate: ms }, outputs: {} });
    const traces = [chat("h1", 100), chat("h2", 400), chat("h3", 20), chat("h4", 200)];
    const [, latest]: TreeNode[] = findIn(h.render({ flow: sample.flow, traces }), node => node.props.className === "latest_pair").props.children;
    const history = draw(part(draw(latest), "History"));
    assert.equal(history.props.className, "history");
    const [bars, text]: TreeNode[] = history.props.children;
    assert.deepEqual([bars.props.className, bars.props["aria-hidden"]], ["bars", "true"]);
    assert.deepEqual(bars.props.children.map((bar: TreeNode) => [bar.key, bar.props.className, bar.props.style]), [
        ["0", "spark", { height: "25%" }], ["1", "spark", { height: "100%" }], ["2", "spark", { height: "8%" }], ["3", "spark is_last", { height: "50%" }],
    ]);
    assert.deepEqual([text.props.className, text.props.children], ["history_text", 'io_flow.median:{"count":4,"value":"200 ms"}']);
});

test("the timeline draws a row per stage or output on a shared axis, and a row that did not happen without a bar", async () => {
    const h = await setup();
    const rows: TimelineRow[] = [
        { kind: "stage", stage: "translate", label: "Translation", value: "50 ms", start: 0, end: 50, off: false },
        { kind: "chatbox", label: "Chatbox", value: "150 ms", start: 50, end: 150, off: false },
        // Too short to see: still drawn half a percent wide.
        { kind: "synthesis", label: "Speech synthesis", value: "0 ms", start: 150, end: 150, off: false },
        { kind: "speech", label: "Speech", value: "io_flow.state.queued", start: 0, end: 0, off: true },
    ];
    const timeline = h.Timeline({ rows, scale: 200, className: "strip" });
    assert.deepEqual([timeline.props.className, timeline.props.role, timeline.props["aria-label"]],
        ["timeline strip", "list", 'io_flow.timeline:{"scale":200}']);
    const [items, axis]: [TreeNode[], TreeNode] = timeline.props.children;
    assert.deepEqual(items.map(item => {
        const [label, track, value]: TreeNode[] = item.props.children;
        const bar = treeNode(track.props.children);
        return [item.key, item.props.role, item.props.className, label.props.className, label.props.children,
            track.props.className, track.props["aria-hidden"], bar && [bar.props.className, bar.props.style], value.props.className, value.props.children];
    }), [
        ["0", "listitem", "row", "row_label", "Translation", "track", "true", ["bar bar_stage", { left: "0%", width: "25%" }], "row_value", "50 ms"],
        ["1", "listitem", "row", "row_label", "Chatbox", "track", "true", ["bar bar_chatbox", { left: "25%", width: "50%" }], "row_value", "150 ms"],
        ["2", "listitem", "row", "row_label", "Speech synthesis", "track", "true", ["bar bar_synthesis", { left: "75%", width: "0.5%" }], "row_value", "0 ms"],
        ["3", "listitem", "row is_off", "row_label", "Speech", "track no_track", "true", null, "row_value", "io_flow.state.queued"],
    ]);
    // The axis runs from 0 to the scale.
    assert.deepEqual([axis.props.className, axis.props["aria-hidden"]], ["row axis_row", "true"]);
    const [before, scale, after]: TreeNode[] = axis.props.children;
    assert.deepEqual([before.props.children, scale.props.className, scale.props.children.map(textOf), after.props.children],
        [undefined, "axis", ["0 ms", "200 ms"], undefined]);
    assert.equal(h.Timeline({ rows: [], scale: 100 }).props.className, "timeline");
});

test("the voice changer's recent round trip is read out under the panel while it runs", async () => {
    const h = await setup();
    const live = classed(h.render({ flow: sample.flow, traces: sample.traces }), "live");
    assert.deepEqual([live?.type, live?.props.children], ["p", 'io_flow.conversion_live:{"ms":31}']);
    assert.equal(classed(h.render({ flow: { ...sample.flow, conversion_round_trip_ms: null }, traces: sample.traces }), "live"), null);
});

// #614: how the GPU memory is read is the hint of its heading, not a line under the readout.
// The readout keeps its state in words.

test("the GPU memory's heading carries how it is read as its hint; the state stays in words", async () => {
    const section = await gpuSection(null);
    const line = findIn(section, node => node.props.className === "gpu_title", "the heading's line");
    assert.equal(line.props["data-hint-host"], true);
    assert.deepEqual(nodesIn(line).map(node => node.type), ["div", "h3", "hint"]);
    assert.deepEqual(findIn(line, node => node.type === "hint").props, { text: "io_flow.gpu.note", focusable: true });
    // The section is still named by its heading.
    const heading = findIn(line, node => node.type === "h3");
    assert.equal(section.props["aria-labelledby"], heading.props.id);
    assert.deepEqual([heading.props.className, heading.props.children], ["latest_title", "io_flow.gpu.title"]);
    // Until the first answer the readout says it is measuring, and nothing else is a paragraph.
    const paragraphs = nodesIn(section).filter(node => node.type === "p");
    assert.deepEqual(paragraphs.map(node => [node.props.children, node.props.role]), [["io_flow.gpu.state.measuring", "status"]]);
});

test("the GPU memory says why there is no readout: not reported, not read, or no GPU worth a row", async () => {
    const status = async (memory: GpuMemory) => {
        const section = await gpuSection(memory);
        assert.equal(classed(section, "gpu_list"), null);
        const message = findIn(section, node => node.type === "p");
        return [message.props.className, message.props.role, message.props.children];
    };
    assert.deepEqual(await status({ state: "unsupported", gpus: [], age_ms: 0 }), ["no_trace", "status", "io_flow.gpu.state.unsupported"]);
    assert.deepEqual(await status({ state: "failed", gpus: [], age_ms: 0 }), ["no_trace", "status", "io_flow.gpu.state.failed"]);
    // An integrated GPU the app does not work on is not worth a row.
    const idle = { name: "Integrated GPU", total: 512 * 1024 ** 2, used: 0, app: { speech: 0, conversion: 0, other: 0 }, app_shared: 0 };
    assert.deepEqual(await status({ state: "ready", gpus: [idle], age_ms: 0 }), ["no_trace", "status", "io_flow.gpu.none"]);
});

test("each GPU shows its name, its whole use, a bar of what the app holds, and each part in words", async () => {
    const GB = 1024 ** 3, MB = 1024 ** 2;
    const section = await gpuSection({ state: "ready", age_ms: 300, gpus: [
        { name: "Test GPU", total: 8 * GB, used: 3 * GB, app: { speech: GB, conversion: 512 * MB, other: 256 * MB }, app_shared: 0 },
        // Integrated: what the app holds is in system memory, and the GPU's own use is not drawn.
        { name: "Integrated GPU", total: 512 * MB, used: 100 * MB, app: { speech: 0, conversion: 0, other: 0 }, app_shared: 300 * MB },
    ] });
    assert.deepEqual(nodesIn(section).filter(node => node.type === "p" && node.props.role === "status"), []);
    const list = classed(section, "gpu_list");
    assert.ok(list);
    const rows: TreeNode[] = list.props.children;
    assert.deepEqual(rows.map(row => {
        const [head, track, app, parts]: TreeNode[] = row.props.children;
        const [name, whole]: TreeNode[] = head.props.children;
        return {
            key: row.key, className: row.props.className,
            head: [head.props.className, name.props.className, name.props.children, whole && [whole.props.className, whole.props.children]],
            track: track && [track.props.className, track.props["aria-hidden"],
                track.props.children.map((segment: TreeNode) => [segment.key, segment.props.className, segment.props.style])],
            app: [app.props.className, app.props.children],
            parts: parts && [parts.props.className, parts.props.children.map((item: TreeNode) => {
                const [swatch, text] = item.props.children;
                return [item.key, swatch.props.className, swatch.props["aria-hidden"], text];
            })],
        };
    }), [{
        key: "0:Test GPU", className: "gpu_row",
        head: ["gpu_head", "gpu_name", "Test GPU", ["gpu_whole", 'io_flow.gpu.whole:{"used":"3.0 GB","total":"8.0 GB"}']],
        track: ["gpu_track", "true", [
            ["speech", "gpu_segment gpu_speech", { width: "12.5%" }], ["conversion", "gpu_segment gpu_conversion", { width: "6.25%" }],
            ["other", "gpu_segment gpu_other", { width: "3.125%" }], ["rest", "gpu_segment gpu_rest", { width: "15.625%" }]]],
        app: ["gpu_app", 'io_flow.gpu.app:{"size":"1.8 GB"}'],
        parts: ["gpu_parts", [
            ["speech", "gpu_swatch gpu_speech", "true", 'io_flow.gpu.part.speech:{"size":"1.0 GB"}'],
            ["conversion", "gpu_swatch gpu_conversion", "true", 'io_flow.gpu.part.conversion:{"size":"512 MB"}'],
            ["other", "gpu_swatch gpu_other", "true", 'io_flow.gpu.part.other:{"size":"256 MB"}']]],
    }, {
        key: "1:Integrated GPU", className: "gpu_row",
        head: ["gpu_head", "gpu_name", "Integrated GPU", null],
        track: false,
        app: ["gpu_app", 'io_flow.gpu.app_shared:{"size":"300 MB"}'],
        parts: false,
    }]);
});

test("the GPU memory is the main window's only: not in VR, and not where the panel is given none", async () => {
    const h = await setup();
    const memory: GpuMemory = { state: "measuring", gpus: [], age_ms: null };
    const shown = (props: { gpuMemory?: GpuMemory | null; compact?: boolean }) =>
        find(h.render({ flow: sample.flow, traces: sample.traces, ...props }), node => componentName(node) === "GpuMemorySection") !== null;
    assert.equal(shown({ gpuMemory: memory }), true);
    assert.equal(shown({ gpuMemory: memory, compact: true }), false);
    assert.equal(shown({}), false);
});
