import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";

// The GPU builds of ONNX Runtime for translation (decision 2 (c)): offered only where the
// backend offers them, set up through the runtime setup, and the device list asked for again
// once one is set up.
const load = async (runtime, vc, refreshed) => (await loadModule(new URL("./TranslationGpuRuntimes.tsx", import.meta.url), runtime, {
    "@logics_configs": { useTranslation: () => ({ getSelectableTranslationComputeDeviceList: () => refreshed.push("list") }) },
    "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => vc },
    "../advanced_settings/VcRuntimeSetup": { VcRuntimeSetup: "runtime-setup" },
    "../_components/description/Description": { Description: "description" },
})).TranslationGpuRuntimes;

test("only the builds the backend offers are shown, and none is fetched unasked", async () => {
    const runtime = hooks();
    const sent = [], refreshed = [];
    const vc = { catalog: null, state: { jobs: {}, installed: {} }, send: (endpoint, data) => sent.push([endpoint, data]) };
    const TranslationGpuRuntimes = await load(runtime, vc, refreshed);
    // Before the catalog arrives (and where it offers neither): nothing.
    assert.equal(runtime.render(TranslationGpuRuntimes), null);
    assert.deepEqual(sent.map(([endpoint]) => endpoint), ["/get/data/vc_runtime_catalog", "/get/data/vc_runtime_state"]);
    vc.catalog = { runtimes: [{ id: "rvc" }] };
    assert.equal(runtime.render(TranslationGpuRuntimes), null);
    // Windows without an NVIDIA driver: DirectML only.
    vc.catalog = { runtimes: [{ id: "rvc" }, { id: "onnxruntime-directml" }] };
    const tree = runtime.render(TranslationGpuRuntimes);
    const setups = [];
    find(tree, node => { if (node.type === "runtime-setup") setups.push(node.props); return false; });
    assert.deepEqual(setups, [{ engine: "onnxruntime-directml" }]);
    assert.equal(tree.props["aria-label"], "config_page.translation.gpu_runtimes.label");
    // Showing them starts no setup and asks for no list.
    assert.equal(sent.length, 2);
    assert.deepEqual(refreshed, []);
});

test("a build set up here makes the device list come again", async () => {
    const runtime = hooks();
    const refreshed = [];
    const vc = { catalog: { runtimes: [{ id: "onnxruntime-cuda" }, { id: "onnxruntime-directml" }] }, state: { jobs: {}, installed: {} }, send: () => {} };
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
