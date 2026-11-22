import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, fieldOf } from "../../../../../../logics/test/hookHarness.ts";

interface StartupDownload {
    kind: string;
    id: string;
    progress: number | string;
}

// node?.props?.children, for a rendered node of any kind.
const childrenOf = (node: unknown): unknown => fieldOf(node, "props", "children");

const texts = (node: unknown): string[] => !node || typeof node !== "object" ? (typeof node === "string" ? [node] : [])
    : Array.isArray(node) ? node.flatMap(texts) : texts(childrenOf(node));

const render = async ({ step = 0, downloads = [] }: { step?: number; downloads?: StartupDownload[] } = {}) => {
    const runtime = hooks();
    const { StartupProgress } = await loadModule<typeof import("./StartupProgress.tsx")>(new URL("./StartupProgress.tsx", import.meta.url), runtime, {
        "../../../../../../logics/common/useStartupProgress": { useStartupProgress: () => ({ step, downloads }), STARTUP_STEPS: 4 },
    });
    const tree = runtime.render(StartupProgress);
    return { tree, texts: texts(tree) };
};

test("the startup list says how far the engine has come and which models it fetches", async () => {
    const s = await render({ step: 2, downloads: [{ kind: "translation", id: "small", progress: 42 },
        { kind: "translation", id: "large", progress: "pending" }] });
    assert.equal(s.tree.props["aria-label"], "studio.startup_label");
    assert.deepEqual(s.texts, ["studio.startup_status", "studio.startup_step",
        "studio.startup_download_translation", "studio.setup_downloading", "studio.startup_download_translation", "studio.setup_preparing"]);
    // It sits in the inert page: no controls, and the live region is StartupAnnouncer, outside it.
    assert.equal(find(s.tree, node => node.type === "button"), null);
    assert.equal(find(s.tree, node => node.props?.role === "status"), null);
});

test("before the first step report there is no step to show", async () => {
    assert.deepEqual((await render()).texts, ["studio.startup_status"]);
});
