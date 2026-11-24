import assert from "node:assert/strict";
import { test } from "vitest";
import { findIn, hooks, kitStandIns, loadModule, nodesIn } from "../../../../../logics/test/hookHarness.ts";

// #614: what the panel is for is not a line of the panel. It is the hint of the title, which
// opens while the pointer is on the title and while its mark has keyboard focus.

async function panel(open: boolean) {
    const runtime = hooks();
    const { IoFlowPanel } = await loadModule<typeof import("./IoFlowPanel.tsx")>(new URL("./IoFlowPanel.tsx", import.meta.url), runtime, {
        "../../../../../logics/flow/useIoFlow": { useIoFlow: () => ({ isPanelOpen: open, togglePanel() {}, currentIoFlow: { data: null }, currentIoTraces: { data: [] } }) },
        "../../../../../logics/flow/useGpuMemory": { useGpuMemory: () => ({ currentGpuMemory: { data: null } }) },
        "../../../io_flow/IoFlowView": { IoFlowView: "flow-view" },
        "../../../config_page/setting_section/setting_box/_components/hint/Hint": { Hint: "hint" },
    });
    return runtime.render(IoFlowPanel);
}

test("the panel's title carries what the panel is for as its hint, which the keyboard reaches", async () => {
    const tree = await panel(true);
    const line = findIn(tree, node => node.props.className === "title_line", "the title's line");
    assert.equal(line.props["data-hint-host"], true, "the pointer on the title opens the hint");
    assert.deepEqual(nodesIn(line).map(node => node.type), ["div", "h2", "hint"]);
    const hint = findIn(line, node => node.type === "hint");
    assert.deepEqual(hint.props, { text: "io_flow.hint", focusable: true });
    // The head holds the title's line and the close button, the kit's plain Button at the compact
    // size, and no paragraph.
    const head = findIn(tree, node => node.props.className === "head", "the head");
    assert.deepEqual(nodesIn(head).map(node => node.type), ["div", "div", "h2", "hint", kitStandIns.Button]);
    const close = findIn(head, node => node.type === kitStandIns.Button, "the close button");
    assert.deepEqual([close.props.size, close.props.children], ["compact", "io_flow.close"]);
    assert.equal(nodesIn(tree).filter(node => node.type === "p").length, 0);
});

test("a closed panel draws nothing", async () => {
    assert.equal(await panel(false), null);
});
