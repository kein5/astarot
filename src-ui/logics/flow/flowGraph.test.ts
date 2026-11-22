import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFlowGraph } from "./flowGraph.ts";
import type { FlowGraph, FlowNode } from "./flowGraph.ts";
import type { FlowInput, FlowLane, FlowOutputRow, IoFlow, Trace } from "./ioFlow.ts";
import { unchecked } from "../test/hookHarness.ts";

// The route map and traces the backend's tests share (tests/voice/fixtures/io_flow_sample.json),
// as the core sends them.
interface FlowSample {
    flow: IoFlow & { voice: FlowLane & { outputs: FlowOutputRow[] } };
    traces: Trace[];
}
// Test data: the sample the backend's tests share, read as far as these tests read it.
const sample = unchecked<FlowSample>(JSON.parse(readFileSync(new URL("../../../tests/voice/fixtures/io_flow_sample.json", import.meta.url), "utf8")));
// A box of the graph by its id, of the kind that id names.
type NodeKind<N, I> = N extends { id: infer D } ? (I extends D ? N : never) : never;
type NodeOf<I extends FlowNode["id"]> = NodeKind<FlowNode, I>;
const edge = (graph: FlowGraph | null, id: string) => graph?.edges.find(row => row.id === id);
const node = <I extends FlowNode["id"]>(graph: FlowGraph | null, id: I) => graph?.nodes.find((row): row is NodeOf<I> => row.id === id);

test("each input is wired to the outputs the settings send it to", () => {
    const graph = buildFlowGraph(sample.flow, sample.traces);
    assert.equal(edge(graph, "translate_voice>chatbox")?.on, true);
    assert.equal(edge(graph, "translate_chat>chatbox")?.on, true);
    assert.equal(edge(graph, "translate_voice>vr_log")?.on, false, "off in the settings");
    assert.equal(edge(graph, "translate_chat>speech")?.on, false, "chat is not spoken");
    assert.equal(edge(graph, "translate_chat>clipboard"), undefined, "chat never reaches the clipboard");
    // Speech and the live voice both go through the conversion to the mic VRChat hears.
    assert.equal(edge(graph, "speech>conversion")?.on, true);
    assert.equal(edge(graph, "in_voice>conversion")?.on, true);
    assert.equal(edge(graph, "conversion>live_voice")?.on, true);
    assert.equal(node(graph, "conversion")?.ms, 31);
});

test("the newest message's path lights up, and only the outputs it reached", () => {
    const graph = buildFlowGraph(sample.flow, sample.traces);
    assert.ok(graph);
    // The sample's newest is a chat that reached the chatbox only.
    assert.deepEqual(graph.edges.filter(row => row.lit).map(row => row.id).sort(),
        ["in_chat>translate_chat", "translate_chat>chatbox"]);
    const voiceFirst = buildFlowGraph(sample.flow, sample.traces.filter(row => row.id !== "c2"));
    assert.ok(voiceFirst);
    assert.deepEqual(voiceFirst.edges.filter(row => row.lit).map(row => row.id).sort(), [
        "conversion>live_voice", "in_voice>recognition", "recognition>translate_voice", "speech>conversion",
        "translate_voice>chatbox", "translate_voice>speech"]);
    assert.notEqual(graph.pulse, voiceFirst.pulse, "a new message pulses again");
});

test("outputs carry the latest time of each input", () => {
    const graph = buildFlowGraph(sample.flow, sample.traces);
    assert.deepEqual(node(graph, "chatbox")?.times, { voice: 226, chat: 209 });
    assert.deepEqual(node(graph, "live_voice")?.times, { voice: 851, chat: null });
    assert.equal(node(graph, "translate_voice")?.ms, 212);
});

test("without the conversion, speech goes straight to the mic; VRChat reading the mic itself is shown apart", () => {
    const voice = { ...sample.flow.voice, outputs: sample.flow.voice.outputs.map(row =>
        row.id === "live_voice" ? { ...row, carried: "vrchat_mic", engine: null, during_speech: null }
            : row.id === "speech" ? { ...row, path: "device" } : row) };
    const graph = buildFlowGraph({ ...sample.flow, voice, conversion_round_trip_ms: null }, []);
    assert.ok(graph);
    assert.equal(node(graph, "conversion"), undefined);
    assert.equal(edge(graph, "speech>live_voice")?.on, true);
    const direct = edge(graph, "in_voice>live_voice");
    assert.equal(direct?.on, false);
    assert.equal(direct?.direct, true);
    assert.equal(graph.edges.some(row => row.lit), false, "nothing measured, nothing lit");
    assert.equal(buildFlowGraph(null, []), null);
});

const row = (id: string, on: boolean, extra: Partial<FlowOutputRow> = {}): FlowOutputRow => ({ id, on, reason: null, ...extra });
interface LaneOptions {
    voiceOn?: boolean;
    voiceOutputs?: FlowOutputRow[];
    chatOutputs?: FlowOutputRow[];
    roundTrip?: number | null;
    translation?: boolean;
}
// Test data: the lanes' translations without their targets, which the graph does not read.
const lanes = ({ voiceOn = true, voiceOutputs = [], chatOutputs = [], roundTrip = null, translation = true }: LaneOptions = {}) => unchecked<IoFlow>({
    voice: { on: voiceOn, recognition: { realtime: false, engine: "whisper" }, translation: { on: translation }, outputs: voiceOutputs },
    chat: { on: true, translation: { on: translation }, outputs: chatOutputs },
    conversion_round_trip_ms: roundTrip,
});
const trace = (id: string, input: FlowInput, outputs: Trace["outputs"], stages: Trace["stages"] = { translate: 100 }): Trace => ({ id, input, text: "", stages, outputs });
const sent = { state: "sent", at_ms: 120 };
const playing = { state: "playing", at_ms: 400 };

test("every box and arrow is listed in order, with the ones in use", () => {
    const graph = buildFlowGraph(sample.flow, sample.traces);
    assert.ok(graph);
    assert.deepEqual(graph.nodes.map(row => [row.id, row.kind, row.lane ?? null, row.on]), [
        ["in_voice", "input", "voice", true],
        ["recognition", "stage", "voice", true],
        ["translate_voice", "stage", "voice", true],
        ["in_chat", "input", "chat", true],
        ["translate_chat", "stage", "chat", true],
        ["speech", "speech", null, true],
        ["conversion", "conversion", null, true],
        ["chatbox", "output", null, true],
        ["live_voice", "output", null, true],
        ["desktop_caption", "output", null, true],
        ["vr_log", "output", null, false],
        ["clipboard", "output", null, false],
        ["websocket", "output", null, false],
    ]);
    assert.deepEqual(graph.edges.map(row => [row.id, row.lane, row.on]), [
        ["in_voice>recognition", "voice", true],
        ["recognition>translate_voice", "voice", true],
        ["in_chat>translate_chat", "chat", true],
        ["translate_voice>chatbox", "voice", true],
        ["translate_chat>chatbox", "chat", true],
        ["translate_voice>desktop_caption", "voice", true],
        ["translate_chat>desktop_caption", "chat", true],
        ["translate_voice>vr_log", "voice", false],
        ["translate_chat>vr_log", "chat", false],
        ["translate_voice>clipboard", "voice", false],
        ["translate_voice>websocket", "voice", false],
        ["translate_chat>websocket", "chat", false],
        ["translate_voice>speech", "voice", true],
        ["translate_chat>speech", "chat", false],
        ["speech>conversion", "speech", true],
        ["in_voice>conversion", "voice", true],
        ["conversion>live_voice", "speech", true],
    ]);
    const recognition = node(graph, "recognition");
    assert.deepEqual([recognition?.realtime, recognition?.engine, recognition?.ms, recognition?.msKind], [true, null, 8, "wait"]);
    assert.equal(node(graph, "translate_chat")?.ms, 198);
    assert.deepEqual(node(graph, "translate_voice")?.translation, sample.flow.voice.translation);
    assert.equal(node(graph, "speech")?.language, "English");
    assert.deepEqual([node(graph, "conversion")?.engine, node(graph, "conversion")?.on], ["rvc", true]);
    assert.equal(node(graph, "live_voice")?.live.carried, "converted");
    assert.equal(node(graph, "chatbox")?.live, null);
    assert.deepEqual(node(graph, "desktop_caption")?.times, { voice: null, chat: null }, "only the chatbox and the mic are timed");
    assert.equal(node(graph, "chatbox")?.rows.chat?.content, "both");
});

test("a lane that is off, and outputs the route map leaves out, are drawn off", () => {
    const graph = buildFlowGraph(lanes({ voiceOn: false, translation: false,
        voiceOutputs: [row("chatbox", false)], chatOutputs: [row("chatbox", false)] }), []);
    assert.ok(graph);
    assert.deepEqual(graph.nodes.map(row => [row.id, row.on]), [
        ["in_voice", false], ["recognition", false], ["translate_voice", false], ["in_chat", true],
        ["translate_chat", false], ["speech", false], ["chatbox", false], ["live_voice", false],
        ["desktop_caption", false], ["vr_log", false], ["clipboard", false], ["websocket", false],
    ]);
    assert.equal(node(graph, "speech")?.language, null);
    assert.equal(node(graph, "recognition")?.ms, null);
    assert.deepEqual(graph.edges.map(row => [row.id, row.on]), [
        ["in_voice>recognition", false], ["recognition>translate_voice", false], ["in_chat>translate_chat", true],
        ["translate_voice>chatbox", false], ["translate_chat>chatbox", false],
        ["translate_voice>speech", false], ["translate_chat>speech", false],
        ["speech>live_voice", false], ["in_voice>live_voice", false],
    ]);
    // Without a live_voice row, the mic is VRChat's own and nothing the app sends.
    assert.equal(edge(graph, "in_voice>live_voice")?.direct, true);
    assert.equal(node(graph, "live_voice")?.live.carried, "vrchat_mic");
});

test("speech from the chat alone reaches the mic and gives the language", () => {
    const graph = buildFlowGraph(lanes({
        voiceOutputs: [row("chatbox", false), row("speech", false, { path: null, language: null }),
            row("live_voice", false, { carried: "vrchat_mic" })],
        chatOutputs: [row("chatbox", true), row("speech", true, { path: "device", language: "Japanese" })],
    }), []);
    assert.equal(node(graph, "speech")?.on, true);
    assert.equal(node(graph, "speech")?.language, "Japanese");
    assert.equal(node(graph, "chatbox")?.on, true, "on for the chat lane");
    assert.equal(node(graph, "live_voice")?.on, true, "the chat's speech is heard through the mic");
    assert.equal(edge(graph, "translate_chat>speech")?.on, true);
    assert.equal(edge(graph, "speech>live_voice")?.on, true);
    assert.equal(node(graph, "conversion"), undefined);
    assert.equal(edge(graph, "conversion>live_voice"), undefined);
});

test("the live voice: passed through, muted, or speech only", () => {
    const passthrough = buildFlowGraph(lanes({ voiceOutputs: [row("live_voice", true, { carried: "passthrough" })] }), []);
    const direct = edge(passthrough, "in_voice>live_voice");
    assert.deepEqual([direct?.on, direct?.direct], [true, false]);
    assert.equal(node(passthrough, "live_voice")?.on, true);

    const speaking = [row("speech", true, { path: "device", language: "English" })];
    const voiceOnlyBySpeech = buildFlowGraph(lanes({ voiceOutputs: [...speaking, row("live_voice", false, { carried: "vrchat_mic" })] }), []);
    assert.equal(node(voiceOnlyBySpeech, "live_voice")?.on, true, "speech alone makes the mic carry something");

    const muted = buildFlowGraph(lanes({ voiceOutputs: [...speaking, row("live_voice", false, { carried: "muted" })] }), []);
    assert.equal(edge(muted, "speech>live_voice")?.on, false, "a muted mic carries no speech");
    const mutedConverted = buildFlowGraph(lanes({
        voiceOutputs: [row("speech", true, { path: "converted" }), row("live_voice", false, { carried: "muted" })] }), []);
    assert.equal(edge(mutedConverted, "speech>conversion")?.on, true);
    assert.equal(edge(mutedConverted, "conversion>live_voice")?.on, false);
});

test("the conversion box appears for any path through it, and shows only a whole-ms round trip", () => {
    const chatConverted = buildFlowGraph(lanes({ roundTrip: 12.5,
        chatOutputs: [row("speech", true, { path: "converted" })] }), []);
    assert.equal(node(chatConverted, "conversion")?.ms, null);
    assert.equal(node(chatConverted, "conversion")?.engine, null);
    assert.equal(edge(chatConverted, "speech>conversion")?.on, true);
    assert.equal(edge(chatConverted, "speech>live_voice"), undefined);

    const liveConverted = buildFlowGraph(lanes({ roundTrip: 40,
        voiceOutputs: [row("speech", false, { path: "device" }), row("live_voice", true, { carried: "converted", engine: "rvc" })] }), []);
    assert.equal(node(liveConverted, "conversion")?.ms, 40);
    assert.equal(edge(liveConverted, "in_voice>conversion")?.on, true);
    assert.equal(edge(liveConverted, "speech>live_voice")?.on, false, "nothing is spoken");
    assert.equal(edge(liveConverted, "conversion>live_voice")?.on, true);
});

test("the recognition box shows recognition time when there is one, the wait otherwise", () => {
    const flow = lanes();
    const timed = buildFlowGraph(flow, [trace("v1", "voice", {}, { recognition: 120, wait: 5 })]);
    assert.deepEqual([node(timed, "recognition")?.ms, node(timed, "recognition")?.msKind], [120, "recognition"]);
    const untimed = buildFlowGraph(flow, [trace("v1", "voice", {}, {})]);
    assert.deepEqual([node(untimed, "recognition")?.ms, node(untimed, "recognition")?.msKind], [null, "wait"]);
});

test("only what the newest message reached lights up", () => {
    const flow = lanes({ voiceOutputs: [row("chatbox", true), row("speech", true, { path: "device" }),
        row("live_voice", false, { carried: "vrchat_mic" })] });
    const spokenOnly = buildFlowGraph(flow, [trace("v1", "voice", { speech: playing })]);
    assert.ok(spokenOnly);
    assert.deepEqual(spokenOnly.edges.filter(row => row.lit).map(row => row.id).sort(),
        ["in_voice>recognition", "recognition>translate_voice", "speech>live_voice", "translate_voice>speech"]);
    assert.equal(spokenOnly.pulse, "v1:speech");
    assert.equal(node(spokenOnly, "chatbox")?.on, true, "on for the voice lane, which the chat lane does not send to");
    const both = buildFlowGraph(flow, [trace("v2", "voice", { chatbox: sent, speech: playing })]);
    assert.ok(both);
    assert.equal(both.pulse, "v2:chatbox,speech");
    const nowhere = buildFlowGraph(flow, [trace("v3", "voice", {})]);
    assert.ok(nowhere);
    assert.equal(nowhere.edges.some(row => row.lit), false, "a message that reached nothing lights nothing");
    assert.equal(nowhere.pulse, "v3:");

    // Speech sent straight to the mic does not light the conversion of the live voice.
    const liveConverted = lanes({ voiceOutputs: [row("speech", true, { path: "device" }),
        row("live_voice", true, { carried: "converted" })] });
    const spokenDirect = buildFlowGraph(liveConverted, [trace("v4", "voice", { speech: playing })]);
    assert.ok(spokenDirect);
    assert.equal(edge(spokenDirect, "conversion>live_voice")?.on, true);
    assert.deepEqual(spokenDirect.edges.filter(row => row.lit).map(row => row.id).sort(),
        ["in_voice>recognition", "recognition>translate_voice", "speech>live_voice", "translate_voice>speech"]);
});
