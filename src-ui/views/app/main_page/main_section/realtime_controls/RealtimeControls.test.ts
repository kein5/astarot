import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../logics/test/hookHarness.ts";

type RealtimeControlsModule = typeof import("./RealtimeControls.tsx");

// Draw the nested components too (the kit's Button), so the whole strip can be searched.
const draw = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(draw);
    const type: unknown = Reflect.get(node, "type"), props: unknown = Reflect.get(node, "props");
    return typeof type === "function" ? draw(type(props))
        : { ...node, props: { ...Object(props), children: draw(Reflect.get(Object(props), "children")) } };
};

async function strip({ requested = ["mic"], configOpen = false }: { requested?: string[]; configOpen?: boolean } = {}) {
    const runtime = hooks(), sent: [string, unknown][] = [];
    const { RealtimeControls } = await loadModule<RealtimeControlsModule>(new URL("./RealtimeControls.tsx", import.meta.url), runtime, {
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: configOpen } }) },
        "../../../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => ({
            state: Object.fromEntries(requested.map(source => [source, { requested: true, state: "running" }])),
            error: null,
            send: (endpoint: string, body: unknown) => sent.push([endpoint, body]),
        }) },
    });
    return { tree: draw(runtime.render(RealtimeControls)), sent };
}

test("each running source has its stop, the kit's plain button, and it stops only that source", async () => {
    const { tree, sent } = await strip({ requested: ["mic", "speaker"] });
    const buttons: TreeNode[] = [];
    find(tree, node => { if (node.type === "button") buttons.push(node); return false; });
    assert.deepEqual(buttons.map(button => [button.props["data-slot"], button.props["data-tone"], button.props.children]),
        [["button", "plain", "realtime.stop_mic"], ["button", "plain", "realtime.stop_speaker"]]);
    buttons[1].props.onClick();
    assert.deepEqual(sent, [["/run/stop_realtime_asr", { source: "speaker" }]]);
    // Beside each stop, which source runs and in what state, as a status.
    const statuses: TreeNode[] = [];
    find(tree, node => { if (node.props?.role === "status") statuses.push(node); return false; });
    assert.deepEqual(statuses.map(status => [status.props.children].flat().join("")),
        ["realtime.mic: realtime.state_running", "realtime.speaker: realtime.state_running"]);
});

test("the strip stays away while settings are open or nothing runs", async () => {
    assert.equal((await strip({ configOpen: true })).tree, null);
    assert.equal((await strip({ requested: [] })).tree, null);
});
