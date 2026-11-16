import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find } from "../../logics/test/hookHarness.js";
import { flush } from "../../logics/test/bridgeHarness.js";
import * as status from "../../logics/companion/status.ts";
import * as hexagram from "../../logics/companion/hexagram.ts";

const off = { on: false, pending: false };
const ready = { ready: true, language: "ja", edge: "right", mic: { on: true, pending: false }, translation: off, tts: off,
    rvc: { on: false, pending: true }, listening: off, ocr: off,
    menu: { start: "s", stop: "s", panel: "p", main: "m", quit: "q" } };

async function setup(context, { layout = { out: true, edge: "right", x: 330, y: 120 } } = {}) {
    context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
    const runtime = hooks(), calls = [], callbacks = {};
    context.after(() => runtime.unmount());
    const i18n = { language: "ja", changeLanguage: async () => {} };
    const state = { layout };
    const bridge = {
        status: async () => ready,
        layout: async () => state.layout,
        request: async action => { calls.push(["request", action]); },
        togglePanel: async () => { calls.push(["panel"]); },
        onChanged: async callback => { callbacks.changed = callback; return () => {}; },
        onLayout: async callback => { callbacks.layout = callback; return () => {}; },
    };
    const { CompanionHandle } = await loadModule(new URL("./CompanionHandle.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: key => key, i18n }) },
        "../../logics/companion/bridge.ts": { companionBridge: bridge },
        "../../logics/companion/status.ts": status,
        "../../logics/companion/hexagram.ts": hexagram,
    });
    const render = () => runtime.render(CompanionHandle, { bridge });
    render(); await flush(); render();
    const settle = async () => { await flush(); render(); await flush(); render(); };
    const point = label => find(render(), node => node.type === "polygon" && node.props["aria-label"] === label);
    // A switch's docked label (in the tests a .css.ts class is its own name).
    const dock = () => find(render(), node => node.type === "button" && node.props.className === "dock");
    const shown = () => [...FEATURE_LABELS].filter(label => point(label).props["data-shown"] === true);
    // The pointer rests on a triangle (or the middle) long enough for its dock to open.
    const rest = async target => { target.props.onPointerEnter(); context.mock.timers.tick(200); await settle(); };
    const core = () => find(render(), node => node.type === "polygon" && node.props.role === "button");
    const menu = () => find(render(), node => node.type === "div" && node.props.role === "group");
    return { render, calls, state, callbacks, point, dock, shown, settle, rest, core, menu, context };
}

const FEATURE_LABELS = ["main_page.transcription_send", "main_page.translation", "main_page.tts",
    "main_page.rvc", "main_page.transcription_receive", "main_page.ocr"];

test("hidden at its edge it draws nothing; out, it draws the hexagram with the switches that are on filled", async context => {
    const s = await setup(context, { layout: { out: false, edge: "right", x: 0, y: 0 } });
    assert.equal(s.render(), null);
    s.state.layout = { out: true, edge: "right", x: 330, y: 120 };
    await s.callbacks.layout();
    await s.settle();
    const tree = s.render();
    assert.equal(tree.props["data-edge"], "right");
    assert.equal(s.point("main_page.transcription_send").props["data-on"], true);
    assert.equal(s.point("main_page.rvc").props["data-pending"], true);
    // At the right edge the three points facing left show: the voice changer, listening and chat reading.
    assert.deepEqual(s.shown(), ["main_page.rvc", "main_page.transcription_receive", "main_page.ocr"]);
});

test("the wheel turns it a point at a time, bringing another switch into view", async context => {
    const s = await setup(context);
    const before = s.shown();
    s.render().props.onWheel({ deltaY: 100 });
    s.render().props.onWheel({ deltaY: 100 });
    await s.settle();
    const once = s.shown();
    assert.equal(once.filter(label => !before.includes(label)).length, 1, "a fast wheel still turns one point");
    s.context.mock.timers.tick(200);
    s.render().props.onWheel({ deltaY: -100 });
    await s.settle();
    assert.deepEqual(s.shown(), before, "turned back");
});

test("hovering a point that shows docks its feature out towards the screen; only a press toggles it", async context => {
    const s = await setup(context);
    await s.rest(s.point("main_page.transcription_send"));
    assert.equal(s.dock(), null, "the mic's point is turned beyond the edge");
    await s.rest(s.point("main_page.transcription_receive"));
    const dock = s.dock();
    assert.equal(dock.props["data-side"], "left", "at the right edge the label grows left, into the screen");
    assert.deepEqual(s.calls, [], "hovering changed nothing");
    dock.props.onClick();
    await flush();
    assert.deepEqual(s.calls, [["request", "toggle_listening"]]);
    await s.rest(s.point("main_page.rvc"));
    assert.equal(s.dock().props.disabled, true, "a switch waiting for the backend cannot be pressed again");
});

test("a click on the hexagon in the middle opens the control panel, and going back in clears the docked label", async context => {
    const s = await setup(context);
    const core = s.core();
    assert.equal(core.props["aria-label"], "companion.handle");
    core.props.onClick();
    await flush();
    assert.deepEqual(s.calls, [["panel"]]);
    await s.rest(s.point("main_page.ocr"));
    assert.notEqual(s.dock(), null);
    s.state.layout = { out: false, edge: "right", x: 0, y: 0 };
    await s.callbacks.layout();
    await s.settle();
    assert.equal(s.render(), null);
    s.state.layout = { out: true, edge: "bottom", x: 290, y: 190 };
    await s.callbacks.layout();
    await s.settle();
    assert.equal(s.dock(), null);
    // At the bottom edge the mic's point faces up into the screen.
    assert.ok(s.shown().includes("main_page.transcription_send"));
});

test("passing over a triangle on the way does not dock it; only resting there does", async context => {
    const s = await setup(context);
    s.point("main_page.transcription_receive").props.onPointerEnter();
    s.context.mock.timers.tick(100);
    s.point("main_page.transcription_receive").props.onPointerLeave();
    s.context.mock.timers.tick(300);
    await s.settle();
    assert.equal(s.dock(), null);
});

test("resting on the hexagon in the middle docks out the common settings towards the screen", async context => {
    const s = await setup(context);
    await s.rest(s.core());
    assert.equal(s.dock(), null, "no switch's label");
    const menu = s.menu();
    assert.equal(menu.props["data-side"], "left", "at the right edge it opens to the left, into the screen");
    assert.equal(menu.props["aria-label"], "companion.common.title");
    const edges = [];
    find(menu, node => { if (node.type === "button" && node.props["aria-pressed"] !== undefined) edges.push(node); return false; });
    assert.deepEqual(edges.map(node => node.props["aria-pressed"]), [true, false, false, false], "right is the current edge");
    // Pressing the current edge does nothing; another edge asks the main window to save it.
    edges[0].props.onClick();
    edges[3].props.onClick();
    await flush();
    assert.deepEqual(s.calls, [["request", "edge_bottom"]]);
    const items = [];
    find(menu, node => { if (node.type === "button" && node.props["aria-pressed"] === undefined) items.push(node); return false; });
    assert.deepEqual(items.map(node => node.props.children), ["companion.open_main", "companion.menu_panel"]);
    items[0].props.onClick();
    items[1].props.onClick();
    await flush();
    assert.deepEqual(s.calls.slice(1), [["request", "open_main"], ["panel"]]);
    // Resting on a triangle afterwards trades the settings for that switch's label.
    await s.rest(s.point("main_page.ocr"));
    assert.equal(s.menu(), null);
    assert.notEqual(s.dock(), null);
});
