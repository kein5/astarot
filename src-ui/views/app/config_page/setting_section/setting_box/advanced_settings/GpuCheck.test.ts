import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as shapes from "../../../../../../logics/support/gpuCheck.ts";

const REPORT = {
    devices: [{ device: "cpu", kind: "cpu", name: null }, { device: "Vulkan0", kind: "gpu", name: "AMD Radeon RX 7800 XT" }],
    tts: { runs: [{ device: "Vulkan0", ok: false, error: "out_of_memory" }, { device: "cpu", ok: true, rtfx: 0.1 }] },
    asr: { runs: [{ device: "cpu", ok: true, rtfx: 1, cer_to_cpu: 0 }, { device: "Vulkan0", ok: true, rtfx: 13.9, cer_to_cpu: 0.05 }] },
};

// The node the test reads next: one that is not there fails here, as reading it did.
const must = (node: TreeNode | null) => {
    assert.ok(node);
    return node;
};

// #288: the user starts the check, reads all of the report, and opens a GitHub issue with it.
async function setup(check: shapes.GpuCheckView) {
    const runtime = hooks(), calls: string[] = [], copied: string[] = [], opened: string[] = [];
    const { GpuCheck } = await loadModule<typeof import("./GpuCheck.tsx")>(new URL("./GpuCheck.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key }) },
        "@tauri-apps/api/core": { isTauri: () => true },
        "@tauri-apps/plugin-opener": { openUrl: async (url: string) => { opened.push(url); } },
        "@logics_common": { useCopyToClipboard: () => ({ is_copied: false, copyToClipboard: async (text: string) => { copied.push(text); } }) },
        "../../../../../../logics/support/useGpuCheck.ts": { useGpuCheck: () => ({
            check, start: async () => { calls.push("start"); }, stop: async () => { calls.push("stop"); } }) },
        "../../../../../../logics/support/gpuCheck.ts": shapes,
    });
    const render = () => runtime.render(GpuCheck);
    const button = (tree: unknown, key: string) => find(tree, node => node.type === "button" && node.props.children === key);
    return { render, button, calls, copied, opened };
}

const key = (name: string) => `config_page.advanced_settings.gpu_check.${name}`;

test("it runs only on the user's press, and can be stopped while it runs", async () => {
    const idle = await setup(shapes.IDLE_GPU_CHECK);
    let tree = idle.render();
    assert.equal(idle.button(tree, key("stop")), null);
    must(idle.button(tree, key("start"))).props.onClick();
    assert.deepEqual(idle.calls, ["start"]);
    // What it does and what the report holds are said before it runs.
    const texts: unknown[] = [];
    find(tree, node => { if (node.type === "p") texts.push(node.props.children); return false; });
    assert.deepEqual(texts.slice(0, 3), [key("desc"), key("what"), key("privacy")]);

    const running = await setup({ ...shapes.IDLE_GPU_CHECK, phase: "running", run: 1, step: "tts" });
    tree = running.render();
    assert.equal(must(running.button(tree, key("start"))).props.disabled, true);
    must(running.button(tree, key("stop"))).props.onClick();
    assert.deepEqual(running.calls, ["stop"]);
    const status = find(tree, node => node.props?.role === "status");
    assert.ok(find(status, node => node.props?.children === key("step_tts")));
});

test("the whole report is shown before it is copied or sent, and the issue carries it", async () => {
    const text = JSON.stringify(REPORT, null, 2);
    const s = await setup({ ...shapes.IDLE_GPU_CHECK, run: 1, outcome: "done", report: REPORT, text });
    const tree = s.render();
    const pre = must(find(tree, node => node.type === "pre"));
    assert.equal(pre.props.children, text, "exactly what is sent");
    const cells: unknown[] = [];
    find(find(tree, node => node.type === "tbody"), node => { if (node.type === "td" || node.type === "th") cells.push(node.props.children); return false; });
    assert.deepEqual(cells, [
        key("cpu"), `${key("run_ok")}${key("separator")}${key("run_speed")}:{"rtfx":0.1}`,
        `${key("run_ok")}${key("separator")}${key("run_speed")}:{"rtfx":1}${key("separator")}${key("run_match")}:{"percent":0}`,
        "AMD Radeon RX 7800 XT", `${key("run_failed")}:{"code":"out_of_memory"}`,
        `${key("run_ok")}${key("separator")}${key("run_speed")}:{"rtfx":13.9}${key("separator")}${key("run_match")}:{"percent":5}`,
    ]);
    must(s.button(tree, key("copy"))).props.onClick();
    await must(s.button(tree, key("open_issue"))).props.onClick();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(s.copied, [text, text]);
    assert.equal(s.opened.length, 1);
    assert.equal(new URL(s.opened[0]).searchParams.get("report"), text);
});

test("a check that did not complete says why", async () => {
    for (const [code, expected] of [
        ["gpu_check_no_speech_build", key("error_no_speech_build")],
        ["backend_unavailable", `${key("failed")}:{"code":"backend_unavailable"}`],
    ]) {
        const s = await setup({ ...shapes.IDLE_GPU_CHECK, run: 1, outcome: "failed", error: code });
        const tree = s.render();
        assert.ok(find(tree, node => node.type === "p" && node.props.children === expected), code);
        assert.equal(find(tree, node => node.type === "pre"), null, "no report");
    }
});
