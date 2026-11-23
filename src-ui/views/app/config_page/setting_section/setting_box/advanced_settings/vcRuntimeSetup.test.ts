import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { VcRuntimeCatalog, VcRuntimeState } from "../../../../../../logics/voice/useVcRuntimes.ts";

// What the runtime setup's hook gives the section, as far as it reads it.
interface VcRuntimes {
    catalog: VcRuntimeCatalog | null;
    state: VcRuntimeState;
    error: string | null;
    pending: boolean;
    send: (endpoint: string, data?: unknown) => unknown;
}

// useVcRuntimes.ts's list: that module is not loaded here, for its own imports.
const activeSetupPhases = ["queued", "tools", "python", "packages", "engine", "libraries", "assets", "verifying", "cancelling"];

const entry = {
    id: "rvc", name: "RVC", version: "1", license: "MIT", licenses: [], notice: "rvc_gpu", download_bytes: 1e9,
    disk_bytes: 2e9, destination: "C:/state/vc_runtimes/rvc", gpu_ready: true, requires_gpu: false, device: "cuda",
};

// Whether the page shows descriptions as hints (HintDescriptions); every settings page does.
let hints = false;

const load = async (runtime: HookRuntime, vc: VcRuntimes) => (await loadModule<typeof import("./VcRuntimeSetup.tsx")>(new URL("./VcRuntimeSetup.tsx", import.meta.url), runtime, {
    // A wording of its own for a runtime falls back to the common one (`own`).
    "@useI18n": { useI18n: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) },
    "@tauri-apps/api/core": { isTauri: () => false },
    "@tauri-apps/plugin-opener": { openUrl: async () => {} },
    "../../../../../../logics/voice/useVcRuntimes": { activeSetupPhases, useVcRuntimes: () => vc },
    "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => {} }) },
    "../_components/env_readout/EnvReadout": { EnvReadout: "env-readout" },
    "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
})).VcRuntimeSetup;

const words = (tree: unknown) => nodesIn(tree).flatMap((node: TreeNode) => [node.props?.children].flat())
    .filter((child): child is string => typeof child === "string");
const buttons = (tree: unknown) => nodesIn(tree).filter(node => node.type === "button").map(node => [node.props.children].flat().join(""));

// Windows: a repair of a runtime whose libraries the app holds is fetched and waits for the next
// start (#900). It says so, and offers no start that would only wait again.
test("a setup waiting for the next start says to restart and offers no start", async () => {
    const runtime = hooks();
    const job = { job_id: "job", phase: "restart_required", step: 2, steps: 3, received_bytes: 0, total_bytes: 0, error_code: null };
    const vc: VcRuntimes = { catalog: { runtimes: [entry] }, state: { observation_id: "1", jobs: { rvc: job }, installed: {} }, error: null, pending: false, send: () => {} };
    const VcRuntimeSetup = await load(runtime, vc);
    const tree = runtime.render(VcRuntimeSetup, { engine: "rvc" });
    assert.ok(words(tree).includes("vc_runtime.phase_restart_required"), "the wait is not said");
    assert.ok(!nodesIn(tree).some(node => node.type === "progress"), "it is drawn as running");
    assert.deepEqual(buttons(tree), []);

    // Failed, the same runtime offers to resume.
    vc.state = { ...vc.state, jobs: { rvc: { ...job, phase: "failed", error_code: "vc_runtime_in_use" } } };
    assert.deepEqual(buttons(runtime.render(VcRuntimeSetup, { engine: "rvc" })), ["vc_runtime.resume"]);
});

// One of a pair of builds for different GPUs (the translation's, #945): a badge under the name
// says whether it fits the user's GPU. The one that fits offers its review as the main action;
// the other leaves its summary out and offers no download.
test("a build that fits the GPU leads with the main action; one that is not needed is quieter", async () => {
    const runtime = hooks();
    const vc: VcRuntimes = { catalog: { runtimes: [entry] }, state: { observation_id: "1", jobs: {}, installed: {} }, error: null, pending: false, send: () => {} };
    const VcRuntimeSetup = await load(runtime, vc);
    const review = (tree: unknown) => nodesIn(tree).find(node => node.type === "button" && node.props.children === "vc_runtime.review");
    const fits = runtime.render(VcRuntimeSetup, { engine: "rvc", fit: "fits" });
    assert.equal(fits?.props["data-fit"], "fits");
    assert.ok(nodesIn(fits).some(node => node.type === "span" && node.props["data-tone"] === "recommended" && node.props.children === "vc_runtime.fit_fits"));
    assert.ok(words(fits).includes("vc_runtime.help_rvc_gpu"));
    assert.equal(review(fits)?.props.className, "primary");
    const unneeded = runtime.render(VcRuntimeSetup, { engine: "rvc", fit: "unneeded" });
    assert.ok(nodesIn(unneeded).some(node => node.type === "span" && node.props["data-tone"] === undefined && node.props.children === "vc_runtime.fit_unneeded"));
    assert.ok(!words(unneeded).includes("vc_runtime.help_rvc_gpu"), "its summary is left out");
    assert.equal(review(unneeded), undefined, "a build not needed for the GPU offers no download");
    // Alone (the voice changer's), it has neither the badge nor the main action.
    const alone = runtime.render(VcRuntimeSetup, { engine: "rvc" });
    assert.ok(!words(alone).some(word => word.startsWith("vc_runtime.fit_")));
    assert.equal(review(alone)?.props.className, undefined);
});

// #614: what a runtime holds and needs is its title's hint on a settings page, not a paragraph
// in sight; outside one it stays a line. A build not needed for the GPU says neither.
test("the runtime's description is its title's hint, and a build not needed has none", async () => {
    const runtime = hooks();
    const vc: VcRuntimes = { catalog: { runtimes: [entry] }, state: { observation_id: "1", jobs: {}, installed: {} }, error: null, pending: false, send: () => {} };
    try {
        hints = true;
        const VcRuntimeSetup = await load(runtime, vc);
        let tree = runtime.render(VcRuntimeSetup, { engine: "rvc" });
        const hint = nodesIn(tree).find(node => node.type === "hint");
        assert.ok(hint);
        assert.deepEqual([hint.props.text, hint.props.focusable], ["vc_runtime.help_rvc_gpu", true]);
        assert.ok(tree);
        assert.equal(tree.props["aria-describedby"], hint.props.id, "the section is described by it");
        assert.ok(!words(tree).includes("vc_runtime.help_rvc_gpu"), "no paragraph of it in sight");
        tree = runtime.render(VcRuntimeSetup, { engine: "rvc", fit: "unneeded" });
        assert.ok(tree);
        assert.ok(!nodesIn(tree).some(node => node.type === "hint"));
        assert.equal(tree.props["aria-describedby"], undefined);
        hints = false;
        tree = runtime.render(VcRuntimeSetup, { engine: "rvc" });
        assert.ok(words(tree).includes("vc_runtime.help_rvc_gpu"), "a line where hints are not shown");
    } finally {
        hints = false;
        runtime.unmount();
    }
});
