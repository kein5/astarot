import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";
import * as needsLogic from "../../../../../../logics/main/setupNeeds.ts";

async function setup({ needs = [], sends = true, vr = false, startup = null } = {}) {
    const runtime = hooks(), started = [];
    const { EmptyState } = await loadModule(new URL("./EmptyState.jsx", import.meta.url), runtime, {
        "@store": { store: { is_vr_panel: vr } },
        "@logics_configs": { useSettingValue: name => ({ data: name === "EnableSendMessageToVrc" ? sends : undefined }) },
        "../../../../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs, start: id => started.push(id) }) },
        "../../../../../../logics/main/setupNeeds": needsLogic,
        "../../../startupContext": { useStartupPlaceholder: () => startup },
    });
    // Draw the nested component too, so the whole screen can be searched.
    const draw = node => !node || typeof node !== "object" ? node : Array.isArray(node) ? node.map(draw)
        : typeof node.type === "function" ? draw(node.type(node.props))
        : { ...node, props: { ...node.props, children: draw(node.props?.children) } };
    const texts = node => !node || typeof node !== "object" ? (typeof node === "string" ? [node] : [])
        : Array.isArray(node) ? node.flatMap(texts) : texts(node.props?.children);
    const tree = draw(runtime.render(EmptyState));
    return { tree, started, texts: texts(tree) };
}

test("the empty conversation lists what the selected engines still need, each with the step that provides it", async () => {
    const s = await setup({ needs: [{ id: "translation", weight: { id: "small" }, action: "review" },
        { id: "transcription", weight: { id: "base" }, action: "review" }] });
    const list = find(s.tree, node => node.type === "ul");
    assert.equal(list.props["aria-label"], "studio.setup_label");
    assert.deepEqual(s.texts.filter(text => text.startsWith("studio.setup_")), ["studio.setup_translation", "studio.setup_transcription"]);
    const buttons = [];
    find(s.tree, node => { if (node.type === "button") buttons.push(node); return false; });
    assert.deepEqual(buttons.map(button => button.props.children), ["model_downloads.review", "model_downloads.review"]);
    buttons[1].props.onClick();
    assert.deepEqual(s.started, ["transcription"], "the button opens the review; it does not download");
});

test("the local speech recognition's models are set in its settings: the button opens them, it does not download", async () => {
    const s = await setup({ needs: [{ id: "transcription", weight: null, action: "settings" }] });
    assert.deepEqual(s.texts.filter(text => text.startsWith("studio.setup_")), ["studio.setup_transcription", "studio.setup_open_settings"]);
    const button = find(s.tree, node => node.type === "button");
    assert.equal(button.props.children, "studio.setup_open_settings");
    button.props.onClick();
    assert.deepEqual(s.started, ["transcription"]);
});

test("a model on its way shows its progress instead of the button", async () => {
    const s = await setup({ needs: [{ id: "translation", weight: { id: "small", is_pending: true, progress: null } },
        { id: "transcription", weight: { id: "base", is_pending: true, progress: 41.7 } }] });
    assert.equal(find(s.tree, node => node.type === "button"), null);
    const status = [];
    find(s.tree, node => { if (node.props?.role === "status") status.push(node.props.children); return false; });
    assert.deepEqual(status, ["studio.setup_preparing", "studio.setup_downloading"]);
});

test("nothing to prepare leaves the greeting and the VRChat hint", async () => {
    const s = await setup();
    assert.equal(find(s.tree, node => node.type === "ul"), null);
    assert.deepEqual(s.texts, ["studio.empty_title", "studio.empty_description", "studio.empty_vrchat_hint"]);
});

test("the VRChat hint is shown only while messages are sent to VRChat", async () => {
    assert.ok(!(await setup({ sends: false })).texts.includes("studio.empty_vrchat_hint"));
    assert.ok(!(await setup({ sends: null })).texts.includes("studio.empty_vrchat_hint"));
});

test("the VR panel keeps the greeting alone", async () => {
    const s = await setup({ vr: true, needs: [{ id: "translation", weight: { id: "small" } }] });
    assert.deepEqual(s.texts, ["studio.empty_title", "studio.empty_description"]);
});

test("while the engine starts, the main page's startup list takes the setup list's place", async () => {
    const StartupProgress = () => createElement("p", null, "startup");
    const s = await setup({ startup: createElement(StartupProgress), needs: [{ id: "translation", weight: { id: "small" } }] });
    assert.deepEqual(s.texts, ["studio.empty_title", "studio.empty_description", "startup"]);
    assert.equal(find(s.tree, node => node.type === "button"), null);
    // The VR panel never shows it.
    assert.deepEqual((await setup({ vr: true, startup: createElement(StartupProgress) })).texts,
        ["studio.empty_title", "studio.empty_description"]);
});
