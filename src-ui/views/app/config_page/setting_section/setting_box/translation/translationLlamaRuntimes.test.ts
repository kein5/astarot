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

// llama.cpp's server for the translation LLMs (ADR-015): offered only where the backend offers
// it, set up through the runtime setup after the user's consent, never fetched unasked.
const load = async (runtime: HookRuntime) => (await loadModule<typeof import("./TranslationLlamaRuntimes.tsx")>(new URL("./TranslationLlamaRuntimes.tsx", import.meta.url), runtime, {
    "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => vc },
    "../advanced_settings/VcRuntimeSetup": { VcRuntimeSetup: "runtime-setup" },
})).TranslationLlamaRuntimes;

let vc: VcRuntimes;

test("the Vulkan build is offered where the backend offers it, and nothing starts unasked", async () => {
    const runtime = hooks(), sent: [string, unknown][] = [];
    vc = { catalog: null, state: { jobs: {}, installed: {} }, send: (endpoint, data) => sent.push([endpoint, data]) };
    const TranslationLlamaRuntimes = await load(runtime);
    assert.equal(runtime.render(TranslationLlamaRuntimes), null);
    assert.deepEqual(sent.map(([endpoint]) => endpoint), ["/get/data/vc_runtime_catalog", "/get/data/vc_runtime_state"]);
    vc.catalog = { runtimes: [{ id: "rvc" }, { id: "onnxruntime-directml" }] };
    assert.equal(runtime.render(TranslationLlamaRuntimes), null);
    // A CPU build an older backend might list is not shown: only the Vulkan build is offered.
    vc.catalog = { runtimes: [{ id: "rvc" }, { id: "llamacpp-vulkan" }, { id: "llamacpp-cpu" }] };
    const tree = runtime.render(TranslationLlamaRuntimes);
    const setups: unknown[] = [];
    find(tree, node => { if (node.type === "runtime-setup") setups.push(node.props); return false; });
    assert.deepEqual(setups, [{ engine: "llamacpp-vulkan" }]);
    assert.ok(tree);
    assert.equal(tree.props["aria-label"], "translation_catalog.llamacpp.label");
    assert.equal(sent.length, 2, "showing it starts no setup");
});

test("the build set up or removed makes the catalog ask again", async () => {
    const runtime = hooks(), asked: string[] = [];
    vc = { catalog: { runtimes: [{ id: "llamacpp-vulkan" }] }, state: { jobs: {}, installed: {} }, send: () => {} };
    const TranslationLlamaRuntimes = await load(runtime);
    const onInstalled = () => asked.push("catalog");
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    assert.deepEqual(asked, []);
    vc.state = { jobs: {}, installed: { "llamacpp-vulkan": "C:/state/vc_runtimes/llamacpp-vulkan" } };
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    assert.deepEqual(asked, ["catalog"]);
    runtime.render(TranslationLlamaRuntimes, { onInstalled });
    assert.deepEqual(asked, ["catalog"]);
});
