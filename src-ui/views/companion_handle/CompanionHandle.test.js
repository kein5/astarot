import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find } from "../../logics/test/hookHarness.js";
import { flush } from "../../logics/test/bridgeHarness.js";
import * as status from "../../logics/companion/status.ts";
import * as hexagram from "../../logics/companion/hexagram.ts";

const off = { on: false, pending: false };
const ready = { ready: true, language: "ja", mic: { on: true, pending: false }, translation: off, tts: off,
    rvc: { on: false, pending: true }, listening: off, ocr: off,
    menu: { start: "s", stop: "s", panel: "p", main: "m", quit: "q" } };

async function setup(context) {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const runtime = hooks(), calls = [], callbacks = {};
    context.after(() => runtime.unmount());
    const i18n = { language: "ja", changeLanguage: async () => {} };
    const bridge = {
        status: async () => ready,
        request: async action => { calls.push(["request", action]); },
        togglePanel: async () => { calls.push(["panel"]); },
        openHandle: async open => { calls.push(["open", open]); return open ? { x: 170, y: 150 } : { x: 20, y: 20 }; },
        onChanged: async callback => { callbacks.changed = callback; return () => {}; },
    };
    const { CompanionHandle } = await loadModule(new URL("./CompanionHandle.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: key => key, i18n }) },
        "../../logics/companion/bridge.ts": { companionBridge: bridge },
        "../../logics/companion/status.ts": status,
        "../../logics/companion/hexagram.ts": hexagram,
    });
    const render = () => runtime.render(CompanionHandle, { bridge });
    render(); await flush(); render();
    const point = label => find(render(), node => node.type === "polygon" && node.props["aria-label"] === label);
    const dock = () => find(render(), node => node.type === "button");
    return { render, calls, point, dock, context,
        root: () => render(),
        settle: async () => { await flush(); render(); await flush(); render(); } };
}

test("at rest the hexagram is small and shows which of the six switches are on", async context => {
    const s = await setup(context);
    const tree = s.root();
    assert.equal(tree.props["data-open"], false);
    assert.equal(s.point("main_page.transcription_send").props["data-on"], true);
    assert.equal(s.point("main_page.rvc").props["data-pending"], true);
    assert.equal(s.point("main_page.translation").props["data-on"], false);
    // At rest hovering a point docks nothing out: the handle is too small to aim at.
    s.point("main_page.tts").props.onPointerEnter();
    await s.settle();
    assert.equal(s.dock(), null);
});

test("under the pointer it opens, a hovered point docks its feature out, and only a press toggles it", async context => {
    const s = await setup(context);
    s.root().props.onPointerEnter();
    await s.settle();
    assert.deepEqual(s.calls, [["open", true]]);
    assert.equal(s.root().props["data-open"], true);
    s.point("main_page.tts").props.onPointerEnter();
    await s.settle();
    const dock = s.dock();
    // TTS is the third point, lower right: it docks out to the right of the star.
    assert.equal(dock.props["data-side"], "right");
    assert.equal(dock.props["aria-pressed"], false);
    assert.deepEqual(s.calls, [["open", true]], "hovering changed nothing");
    dock.props.onClick();
    await flush();
    assert.deepEqual(s.calls.at(-1), ["request", "toggle_tts"]);
    // A switch the backend has not confirmed yet cannot be pressed again.
    s.point("main_page.rvc").props.onPointerEnter();
    await s.settle();
    assert.equal(s.dock().props.disabled, true);
});

test("it closes a moment after the pointer leaves, or when the pointer stops over it", async context => {
    const s = await setup(context);
    s.root().props.onPointerEnter();
    await s.settle();
    s.root().props.onPointerLeave();
    s.context.mock.timers.tick(100);
    s.root().props.onPointerEnter();
    s.context.mock.timers.tick(300);
    await s.settle();
    assert.equal(s.calls.filter(([name, open]) => name === "open" && open === false).length, 0, "came back in time");
    s.root().props.onPointerLeave();
    s.context.mock.timers.tick(300);
    await s.settle();
    assert.deepEqual(s.calls.at(-1), ["open", false]);
    assert.equal(s.root().props["data-open"], false);
    s.root().props.onPointerEnter();
    await s.settle();
    s.context.mock.timers.tick(6100);
    await s.settle();
    assert.deepEqual(s.calls.at(-1), ["open", false]);
});

test("the hexagon in the middle closes the handle and opens the control panel", async context => {
    const s = await setup(context);
    s.root().props.onPointerEnter();
    await s.settle();
    const core = find(s.root(), node => node.type === "polygon" && node.props.role === "button");
    assert.equal(core.props["aria-label"], "companion.handle");
    core.props.onClick();
    await s.settle();
    assert.deepEqual(s.calls.slice(-2), [["open", false], ["panel"]]);
});
