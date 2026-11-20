import assert from "node:assert/strict";
import { test } from "vitest";
import { componentName, draw, findIn, hooks, loadModule, nodesIn } from "../../../logics/test/hookHarness.ts";
import * as ioFlow from "../../../logics/flow/ioFlow.ts";
import * as gpuMemory from "../../../logics/flow/gpuMemory.ts";
import type { GpuMemory } from "../../../logics/flow/gpuMemory.ts";
import type { FlowLane } from "../../../logics/flow/ioFlow.ts";

// #614: how the GPU memory is read is the hint of its heading, not a line under the readout.
// The readout keeps its state in words.

async function gpuSection(memory: GpuMemory | null) {
    const runtime = hooks();
    const { IoFlowView } = await loadModule<typeof import("./IoFlowView.tsx")>(new URL("./IoFlowView.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "../../../logics/common/languageNames.ts": { createLanguageNames: () => ({}) },
        "../../../logics/flow/ioFlow.ts": ioFlow,
        "../../../logics/flow/flowText.ts": { flowNote: () => null, offGroups: () => [], timelineRows: () => [] },
        // The graph is drawn by its own part; the view only needs one to be there.
        "../../../logics/flow/flowGraph.ts": { buildFlowGraph: () => ({}) },
        "../../../logics/flow/gpuMemory.ts": gpuMemory,
        "./FlowGraph": { FlowGraph: "graph" },
        "../config_page/setting_section/setting_box/_components/hint/Hint": { Hint: "hint" },
    });
    const lane: FlowLane = { on: true, translation: { on: false, targets: [] }, outputs: [] };
    const view = runtime.render(IoFlowView, { flow: { voice: lane, chat: lane }, traces: [], gpuMemory: memory });
    return draw(findIn(view, node => componentName(node) === "GpuMemorySection", "the GPU memory"));
}

test("the GPU memory's heading carries how it is read as its hint; the state stays in words", async () => {
    const section = await gpuSection(null);
    const line = findIn(section, node => node.props.className === "gpu_title", "the heading's line");
    assert.equal(line.props["data-hint-host"], true);
    assert.deepEqual(nodesIn(line).map(node => node.type), ["div", "h3", "hint"]);
    assert.deepEqual(findIn(line, node => node.type === "hint").props, { text: "io_flow.gpu.note", focusable: true });
    // The section is still named by its heading.
    assert.equal(section.props["aria-labelledby"], findIn(line, node => node.type === "h3").props.id);
    // Until the first answer the readout says it is measuring, and nothing else is a paragraph.
    const paragraphs = nodesIn(section).filter(node => node.type === "p");
    assert.deepEqual(paragraphs.map(node => [node.props.children, node.props.role]), [["io_flow.gpu.state.measuring", "status"]]);
});
