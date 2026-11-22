import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { find, hooks, loadModule } from "../../../../../logics/test/hookHarness.ts";

// #766: when the engine is gone, the rail says so once at its head, not under each of its
// switches (up to six lines, each announced). While the engine starts nothing is said.

async function readout({ ready = false, starting = false, compact = false } = {}) {
    const runtime = hooks();
    const { EngineReadout } = await loadModule<typeof import("./EngineReadout.tsx")>(new URL("./EngineReadout.tsx", import.meta.url), runtime, {
        "@logics_common": { useIsBackendReady: () => ({ currentIsBackendReady: { data: ready } }) },
        "@logics_main": { useIsMainPageCompactMode: () => ({ currentIsMainPageCompactMode: { data: compact } }) },
        "../../startupContext": { useIsStartingUp: () => starting },
        "../../../config_page/setting_section/setting_box/_components/env_readout/EnvReadout": { EnvReadout: "env-readout" },
    });
    return runtime.render(EngineReadout);
}

test("the wide rail states that the engine is gone in one readout, in words", async () => {
    const tree = await readout();
    assert.ok(tree);
    // An environment readout: its words are announced once as a status, the tone only colours them.
    assert.equal(tree.type, "env-readout");
    assert.deepEqual([tree.props.tone, tree.props.children], ["warning", "main_page.backend_disconnected"]);
    assert.equal(tree.props.live, undefined, "announced: the readout's default");
});

test("the icon rail shows a mark that carries the words as its name and its tooltip", async () => {
    const tree = await readout({ compact: true });
    assert.ok(tree);
    assert.equal(tree.props.role, "status");
    const tip = find(tree, node => node.type === "tooltip");
    assert.ok(tip);
    assert.deepEqual([tip.props.title, tip.props.placement], ["main_page.backend_disconnected", "right"]);
    const mark = find(tip, node => node.props.role === "img");
    assert.ok(mark);
    assert.equal(mark.props["aria-label"], "main_page.backend_disconnected");
    assert.equal(mark.props.tabIndex, 0, "the keyboard reaches it, which opens the tooltip");
});

test("nothing is said while the engine runs or is still starting", async () => {
    assert.equal(await readout({ ready: true }), null);
    assert.equal(await readout({ starting: true }), null);
    assert.equal(await readout({ starting: true, compact: true }), null);
});

test("the rail draws the readout once, before its switches", () => {
    const rail = readFileSync(new URL("../SidebarSection.tsx", import.meta.url), "utf8");
    assert.match(rail, /<EngineReadout \/>\s*<MainFunctionSwitch \/>/);
    assert.equal(rail.match(/<EngineReadout \/>/g)?.length, 1);
    // The switches no longer take the reason as a line of their own.
    const switches = readFileSync(new URL("../main_function_switch/MainFunctionSwitch.tsx", import.meta.url), "utf8");
    assert.match(switches, /statusText=\{ready \? item\.statusText : null\}/);
    assert.match(switches, /unavailableText=\{ready \|\| starting \? null : t\("main_page\.backend_disconnected"\)\}/);
});
