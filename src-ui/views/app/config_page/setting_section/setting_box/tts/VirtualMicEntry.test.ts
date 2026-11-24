import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";

// On Windows, the TTS page leads to the virtual microphone guide with the kit's plain button.
test("the way to the virtual microphone guide is the kit's plain button", async () => {
    const runtime = hooks(), opened: string[] = [];
    const { VirtualMicEntry } = await loadModule<typeof import("./VirtualMicEntry.tsx")>(new URL("./VirtualMicEntry.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useVirtualMic": { useVirtualMic: () => ({ status: { supported: true, cables: [] }, openGuide: () => opened.push("guide") }) },
        "../_components/form_row/FormRow": { FormRow: "row" },
    });
    const row = findIn(runtime.render(VirtualMicEntry), node => node.type === "row");
    assert.deepEqual([row.props.label, row.props.description, row.props.keepDescription], ["virtual_mic.entry.label", "virtual_mic.entry.missing", true]);
    const open = findIn(row, node => node.type === kitStandIns.Button);
    assert.deepEqual([open.props.tone, open.props.children], [undefined, "virtual_mic.entry.open"]);
    open.props.onClick();
    assert.deepEqual(opened, ["guide"]);
});
