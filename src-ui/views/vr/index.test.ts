import assert from "node:assert/strict";
import { test } from "vitest";
import { StrictMode } from "react";
import { hooks, loadModule, stubGlobals } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";

// The VR panel's page: it marks the store as the panel's (the panel starts no backend of its own
// and sends through the main window), and draws the panel into #root.

// The panel the page draws: a stand-in.
const VrApp = () => null;

async function start() {
    const store: { is_vr_panel?: boolean } = {}, roots: unknown[] = [], drawn: TreeNode[] = [], steps: string[] = [];
    await loadModule(new URL("./index.tsx", import.meta.url), hooks(), {
        "react-dom/client": { createRoot: (element: unknown) => { roots.push(element); return { render: (tree: TreeNode) => { steps.push("render"); drawn.push(tree); } }; } },
        // The saved theme from the first paint (#1259).
        "../../logics/theme/startWithSavedTheme.ts": { startWithSavedTheme: () => { steps.push("theme"); } },
        "@root/locales/config.ts": {},
        "../app/_index_css/root.css": {},
        "@store": { store },
        "./VrApp": { VrApp },
    });
    return { store, roots, drawn, steps };
}

test("the page marks the store as the VR panel's and draws the panel in strict mode into #root", async context => {
    const root = { id: "root" }, asked: string[] = [];
    stubGlobals(context, { document: { getElementById: (id: string) => { asked.push(id); return id === "root" ? root : null; } } });
    const page = await start();
    assert.equal(page.store.is_vr_panel, true);
    assert.deepEqual([asked, page.roots], [["root"], [root]]);
    assert.equal(page.drawn.length, 1);
    const [tree] = page.drawn;
    assert.equal(tree.type, StrictMode);
    assert.equal(tree.props.children.type, VrApp);
    // The saved theme is in place before the first render (#1259).
    assert.deepEqual(page.steps, ["theme", "render"]);
});

test("without #root the page draws nothing", async context => {
    stubGlobals(context, { document: { getElementById: () => null } });
    const page = await start();
    assert.equal(page.store.is_vr_panel, true);
    assert.deepEqual([page.roots, page.drawn], [[], []]);
});
