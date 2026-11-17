import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";
import * as needsLogic from "../../../../../../logics/main/setupNeeds.ts";

async function setup({ needs = [], sends = true, vr = false, startup = null, settings = {}, recognition = "ready" } = {}) {
    const runtime = hooks(), started = [];
    const { EmptyState } = await loadModule(new URL("./EmptyState.jsx", import.meta.url), runtime, {
        "@store": { store: { is_vr_panel: vr } },
        "@logics_configs": { useSettingValue: name => settings[name] ?? ({ data: name === "EnableSendMessageToVrc" ? sends : undefined }) },
        "../../../../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs, start: id => started.push(id) }) },
        "../../../../../../logics/setup/useRecognitionState": { useRecognitionState: () => ({ state: recognition }) },
        "../../../../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({ openSetup: () => started.push("first_run") }) },
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

test("a recognition not set up yet offers the first-run setup in place of the other needs", async () => {
    const s = await setup({ recognition: "needs_setup", needs: [{ id: "transcription", weight: null, action: "settings" }] });
    assert.deepEqual(s.texts.filter(text => text.startsWith("studio.setup_")), ["studio.setup_first_run", "studio.setup_first_run_open"]);
    const button = find(s.tree, node => node.type === "button");
    button.props.onClick();
    assert.deepEqual(s.started, ["first_run"], "the button opens the setup; it does not download");
    for (const recognition of ["ready", "cloud", "own_server", "unknown"]) {
        assert.ok(!(await setup({ recognition })).texts.includes("studio.setup_first_run"), recognition);
    }
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

test("the greeting keeps its room but is drawn only once the saved UI size and language are in place", async () => {
    const greeting = tree => find(tree, node => node.props?.children?.[0]?.type === "h1");
    const pending = { state: "pending", data: 100 };
    const waiting = await setup({ settings: { UiScaling: pending } });
    assert.equal(greeting(waiting.tree).props["data-waiting"], true);
    assert.equal(greeting(waiting.tree).props["aria-hidden"], true);
    assert.ok(waiting.texts.includes("studio.empty_title"), "its room is kept");
    const ready = await setup({ settings: { UiScaling: { state: "ok", data: 100 }, UiLanguage: { state: "ok", data: "ja" } } });
    assert.equal(greeting(ready.tree).props["data-waiting"], undefined);
    // The VR panel gets its settings from the main window: it never waits.
    const vr = await setup({ vr: true, settings: { UiScaling: pending } });
    assert.equal(greeting(vr.tree).props["data-waiting"], undefined);
});

test("the greeting waits for the language and the narrow layout that the saved settings bring", async () => {
    const { greetingWaits } = await loadModule(new URL("./EmptyState.jsx", import.meta.url), hooks(), {
        "@store": { store: {} },
        "@logics_configs": { useSettingValue: () => null },
        "../../../../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs: [] }) },
        "../../../../../../logics/setup/useRecognitionState": { useRecognitionState: () => ({ state: "ready" }) },
        "../../../../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({ openSetup: () => {} }) },
        "../../../../../../logics/main/setupNeeds": needsLogic,
        "../../../startupContext": { useStartupPlaceholder: () => null },
    });
    const ok = (data) => ({ state: "ok", data });
    const base = { scaling: ok(100), language: ok("ja"), shownLanguage: "ja", width: 871, narrow: false };
    assert.equal(greetingWaits(base), null);
    assert.equal(greetingWaits({ ...base, scaling: { state: "pending", data: 100 } }), "settings");
    assert.equal(greetingWaits({ ...base, language: { state: "pending", data: "en" } }), "settings");
    assert.equal(greetingWaits({ ...base, shownLanguage: "en" }), "language", "the saved language is not shown yet");
    // At 120% an 871 px window is narrow (at most 960 px): wait until the layout says so.
    assert.equal(greetingWaits({ ...base, scaling: ok(120) }), "layout");
    assert.equal(greetingWaits({ ...base, scaling: ok(120), narrow: true }), null);
    // Within a pixel of the edge either layout counts.
    assert.equal(greetingWaits({ ...base, width: 800.5, narrow: false }), null);
    assert.equal(greetingWaits({ ...base, width: 800.5, narrow: true }), null);
    assert.equal(greetingWaits({ ...base, width: undefined }), null);
});

test("a language or layout that does not follow holds the greeting back for a second at most", async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const runtime = hooks();
    const { EmptyState, GREETING_FOLLOW_MS } = await loadModule(new URL("./EmptyState.jsx", import.meta.url), runtime, {
        "@store": { store: {} },
        "@logics_configs": { useSettingValue: name => name === "UiScaling" ? { state: "ok", data: 120 }
            : name === "UiLanguage" ? { state: "ok", data: "ja" } : { data: undefined } },
        "../../../../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs: [] }) },
        "../../../../../../logics/setup/useRecognitionState": { useRecognitionState: () => ({ state: "ready" }) },
        "../../../../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({ openSetup: () => {} }) },
        "../../../../../../logics/main/setupNeeds": needsLogic,
        "../../../startupContext": { useStartupPlaceholder: () => null },
    });
    const stub = { innerWidth: 871, document: { documentElement: { hasAttribute: () => false } } };
    const saved = Object.fromEntries(Object.keys(stub).map(key => [key, globalThis[key]]));
    Object.assign(globalThis, stub);
    context.after(() => Object.assign(globalThis, saved));
    const greeting = () => find(runtime.render(EmptyState), node => node.props?.children?.[0]?.type === "h1");
    assert.equal(greeting().props["data-waiting"], true, "871 px at 120% is narrow, the root is not marked yet");
    context.mock.timers.tick(GREETING_FOLLOW_MS);
    assert.equal(greeting().props["data-waiting"], undefined, "drawn after a second all the same");
    runtime.unmount();
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
