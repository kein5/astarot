import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime } from "../../../../../../logics/test/hookHarness.ts";

// What the runtime setup's hook gives the section, as far as it reads it.
interface VcRuntimes {
    catalog: { runtimes: { id: string }[] } | null;
    state: { jobs: Record<string, unknown>; installed: Record<string, string> };
    send: (endpoint: string, data?: unknown) => unknown;
}

// The GPU builds of ONNX Runtime for translation (decision 2 (c)): offered only where the
// backend offers them, set up through the runtime setup, and the device list asked for again
// once one is set up.
const load = async (runtime: HookRuntime, vc: VcRuntimes, refreshed: string[]) => (await loadModule<typeof import("./TranslationGpuRuntimes.tsx")>(new URL("./TranslationGpuRuntimes.tsx", import.meta.url), runtime, {
    "@logics_configs": { useTranslation: () => ({ getSelectableTranslationComputeDeviceList: () => refreshed.push("list") }) },
    "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => vc },
    "../advanced_settings/VcRuntimeSetup": { VcRuntimeSetup: "runtime-setup" },
    "../_components": { SectionLabelComponent: "section-label" },
})).TranslationGpuRuntimes;

test("only the builds the backend offers are shown, and none is fetched unasked", async () => {
    const runtime = hooks();
    const sent: [string, unknown][] = [], refreshed: string[] = [];
    const vc: VcRuntimes = { catalog: null, state: { jobs: {}, installed: {} }, send: (endpoint, data) => sent.push([endpoint, data]) };
    const TranslationGpuRuntimes = await load(runtime, vc, refreshed);
    // Before the catalog arrives (and where it offers neither): nothing.
    assert.equal(runtime.render(TranslationGpuRuntimes), null);
    assert.deepEqual(sent.map(([endpoint]) => endpoint), ["/get/data/vc_runtime_catalog", "/get/data/vc_runtime_state"]);
    vc.catalog = { runtimes: [{ id: "rvc" }] };
    assert.equal(runtime.render(TranslationGpuRuntimes), null);
    // Windows without an NVIDIA driver: DirectML only, which fits; CUDA is named as needing an NVIDIA GPU.
    vc.catalog = { runtimes: [{ id: "rvc" }, { id: "onnxruntime-directml" }] };
    const tree = runtime.render(TranslationGpuRuntimes);
    assert.deepEqual(setupsIn(tree), [{ engine: "onnxruntime-directml", fit: "fits" }]);
    assert.ok(tree);
    assert.equal(tree.props["aria-label"], "config_page.translation.gpu_runtimes.label");
    // The part is named by a subheading, which carries what the builds are for: its hint on a
    // page that shows descriptions as hints (#614), a line under it elsewhere.
    const heading = find(tree, node => node.type === "section-label");
    assert.deepEqual([heading?.props.sub, heading?.props.label, heading?.props.desc],
        [true, "config_page.translation.gpu_runtimes.label", "config_page.translation.gpu_runtimes.desc"]);
    // Showing them starts no setup and asks for no list.
    assert.equal(sent.length, 2);
    assert.deepEqual(refreshed, []);
});

const setupsIn = (tree: unknown) => {
    const setups: unknown[] = [];
    find(tree, node => { if (node.type === "runtime-setup") setups.push(node.props); return false; });
    return setups;
};
const textsIn = (tree: unknown) => {
    const texts: string[] = [];
    find(tree, node => { for (const child of [node.props?.children].flat()) if (typeof child === "string") texts.push(child); return false; });
    return texts;
};

// The two builds are one choice (#945): the one that fits the GPU first and leading, "or" between,
// the other quieter, or where it cannot run, its name and what it needs alone. Off Windows CUDA is
// the only build, with no choice to show.
test("the builds are drawn as one choice, the one that fits the GPU first", async () => {
    const runtime = hooks();
    const vc: VcRuntimes = { catalog: { runtimes: [{ id: "onnxruntime-directml" }, { id: "onnxruntime-cuda" }] }, state: { jobs: {}, installed: {} }, send: () => {} };
    const TranslationGpuRuntimes = await load(runtime, vc, []);
    // Windows with an NVIDIA driver: CUDA fits, DirectML is not needed.
    let tree = runtime.render(TranslationGpuRuntimes);
    const group = find(tree, node => node.props?.role === "group");
    assert.ok(group, "one group holds the pair");
    assert.equal(group.props["aria-label"], "config_page.translation.gpu_runtimes.label");
    const order: string[] = [];
    find(group, node => {
        if (node.type === "runtime-setup") order.push(`${node.props.engine}:${node.props.fit}`);
        if (node.props?.children === "config_page.translation.gpu_runtimes.or") order.push("or");
        return false;
    });
    assert.deepEqual(order, ["onnxruntime-cuda:fits", "or", "onnxruntime-directml:unneeded"]);
    assert.ok(!textsIn(tree).includes("config_page.translation.gpu_runtimes.needs_nvidia"));
    // Windows without it: DirectML fits, and CUDA says it needs an NVIDIA GPU, with nothing to fetch.
    vc.catalog = { runtimes: [{ id: "onnxruntime-directml" }] };
    tree = runtime.render(TranslationGpuRuntimes);
    assert.deepEqual(setupsIn(tree), [{ engine: "onnxruntime-directml", fit: "fits" }]);
    const unavailable = find(tree, node => node.props?.["data-fit"] === "unavailable");
    assert.ok(unavailable);
    assert.ok(textsIn(unavailable).includes("config_page.translation.gpu_runtimes.needs_nvidia"));
    assert.ok(!find(unavailable, node => node.type === "button"), "nothing to fetch there");
    // Off Windows (Linux with an NVIDIA driver): CUDA alone, no choice.
    vc.catalog = { runtimes: [{ id: "onnxruntime-cuda" }] };
    tree = runtime.render(TranslationGpuRuntimes);
    assert.deepEqual(setupsIn(tree), [{ engine: "onnxruntime-cuda" }]);
    assert.equal(find(tree, node => node.props?.role === "group"), null);
    assert.ok(!textsIn(tree).includes("config_page.translation.gpu_runtimes.or"));
});

test("a build set up here makes the device list come again", async () => {
    const runtime = hooks();
    const refreshed: string[] = [];
    const vc: VcRuntimes = { catalog: { runtimes: [{ id: "onnxruntime-cuda" }, { id: "onnxruntime-directml" }] }, state: { jobs: {}, installed: {} }, send: () => {} };
    const TranslationGpuRuntimes = await load(runtime, vc, refreshed);
    runtime.render(TranslationGpuRuntimes);
    runtime.render(TranslationGpuRuntimes);
    assert.deepEqual(refreshed, []);
    vc.state = { jobs: { "onnxruntime-cuda": { phase: "ready" } }, installed: { "onnxruntime-cuda": "C:/state/vc_runtimes/onnxruntime-cuda" } };
    runtime.render(TranslationGpuRuntimes);
    assert.deepEqual(refreshed, ["list"]);
    // Drawn again with the same builds: not asked again.
    runtime.render(TranslationGpuRuntimes);
    assert.deepEqual(refreshed, ["list"]);
});
