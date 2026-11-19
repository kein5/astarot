import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";

// llama.cpp's server for the translation LLMs (ADR-015): offered only where the backend offers
// it, set up through the runtime setup after the user's consent, never fetched unasked.
const load = async runtime => (await loadModule(new URL("./TranslationLlamaRuntimes.jsx", import.meta.url), runtime, {
    "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => vc },
    "../advanced_settings/VcRuntimeSetup": { VcRuntimeSetup: "runtime-setup" },
})).TranslationLlamaRuntimes;

let vc;

test("both builds are offered where the backend offers them, and nothing starts unasked", async () => {
    const runtime = hooks(), sent = [];
    vc = { catalog: null, state: { jobs: {}, installed: {} }, send: (endpoint, data) => sent.push([endpoint, data]) };
    const TranslationLlamaRuntimes = await load(runtime);
    assert.equal(runtime.render(TranslationLlamaRuntimes), null);
    assert.deepEqual(sent.map(([endpoint]) => endpoint), ["/get/data/vc_runtime_catalog", "/get/data/vc_runtime_state"]);
    vc.catalog = { runtimes: [{ id: "rvc" }, { id: "onnxruntime-directml" }] };
    assert.equal(runtime.render(TranslationLlamaRuntimes), null);
    vc.catalog = { runtimes: [{ id: "rvc" }, { id: "llamacpp-vulkan" }, { id: "llamacpp-cpu" }] };
    const tree = runtime.render(TranslationLlamaRuntimes);
    const setups = [];
    find(tree, node => { if (node.type === "runtime-setup") setups.push(node.props); return false; });
    assert.deepEqual(setups, [{ engine: "llamacpp-vulkan" }, { engine: "llamacpp-cpu" }]);
    assert.equal(tree.props["aria-label"], "translation_catalog.llamacpp.label");
    assert.equal(sent.length, 2, "showing them starts no setup");
});

test("a build set up or removed makes the catalog ask again", async () => {
    const runtime = hooks(), asked = [];
    vc = { catalog: { runtimes: [{ id: "llamacpp-vulkan" }, { id: "llamacpp-cpu" }] }, state: { jobs: {}, installed: {} }, send: () => {} };
    const TranslationLlamaRuntimes = await load(runtime);
    const onInstalled = () => asked.push("catalog");
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    assert.deepEqual(asked, []);
    vc.state = { jobs: {}, installed: { "llamacpp-cpu": "C:/state/vc_runtimes/llamacpp-cpu" } };
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    assert.deepEqual(asked, ["catalog"]);
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    assert.deepEqual(asked, ["catalog"]);
});
