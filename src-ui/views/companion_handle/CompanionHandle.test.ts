import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, unchecked, findIn } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import { flush } from "../../logics/test/bridgeHarness.ts";
import * as status from "../../logics/companion/status.ts";
import * as hexagram from "../../logics/companion/hexagram.ts";
import type { CompanionStatus } from "../../logics/companion/status.ts";
import type { CompanionBridge, HandleLayout } from "../../logics/companion/bridge.ts";

const off = { on: false, pending: false };
const ready = { ready: true, language: "ja", edge: "right", mic: { on: true, pending: false }, translation: off, tts: off,
    rvc: { on: false, pending: true }, listening: off, ocr: off,
    menu: { start: "s", stop: "s", panel: "p", main: "m", quit: "q" } };

// A callback the handle registers; calling it before that stops with a TypeError.
const notYet = async (): Promise<void> => { throw new TypeError("the handle has not registered this callback"); };

async function setup(context: TestContext, { layout = { out: true, edge: "right", x: 330, y: 120 }, current = ready }: { layout?: HandleLayout; current?: object } = {}) {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: 1_000_000 });
    const runtime = hooks(), calls: string[][] = [];
    const callbacks: { changed: () => unknown; layout: () => unknown } = { changed: notYet, layout: notYet };
    context.onTestFinished(() => runtime.unmount());
    const i18n = { language: "ja", changeLanguage: async () => {} };
    const state = { layout };
    // Test data: the status carries only what the hexagram shows, and the bridge only what the
    // handle calls.
    const bridge = unchecked<CompanionBridge>({
        status: async () => unchecked<CompanionStatus>(current),
        layout: async () => state.layout,
        request: async (action: string) => { calls.push(["request", action]); },
        togglePanel: async () => { calls.push(["panel"]); },
        onChanged: async (callback: () => void) => { callbacks.changed = callback; return () => {}; },
        onLayout: async (callback: () => void) => { callbacks.layout = callback; return () => {}; },
    });
    const { CompanionHandle } = await loadModule<typeof import("./CompanionHandle.tsx")>(new URL("./CompanionHandle.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n }) },
        "../../logics/companion/bridge.ts": { companionBridge: bridge },
        "../../logics/companion/status.ts": status,
        "../../logics/companion/hexagram.ts": hexagram,
    });
    const render = () => runtime.render(CompanionHandle, { bridge });
    render(); await flush(); render();
    const settle = async () => { await flush(); render(); await flush(); render(); };
    const point = (label: string) => findIn(render(), node => node.type === "polygon" && node.props["aria-label"] === label);
    // A switch's docked label (in the tests a .css.ts class is its own name).
    const dock = () => find(render(), node => node.type === "button" && node.props.className === "dock");
    const shown = () => [...FEATURE_LABELS].filter(label => point(label).props["data-shown"] === true);
    // The pointer rests on a triangle (or the middle) long enough for its dock to open.
    const rest = async (target: TreeNode) => { target.props.onPointerEnter(); vi.advanceTimersByTime(200); await settle(); };
    const core = () => findIn(render(), node => node.type === "polygon" && node.props.role === "button");
    const menu = () => find(render(), node => node.type === "div" && node.props.role === "group");
    // The handle drawn while it is out: there is a tree to read.
    const tree = () => { const drawn = render(); assert.ok(drawn); return drawn; };
    return { render, tree, calls, state, callbacks, point, dock, shown, settle, rest, core, menu, context };
}

const FEATURE_LABELS = ["main_page.transcription_send", "main_page.translation", "main_page.tts",
    "main_page.rvc", "main_page.transcription_receive", "main_page.ocr"];

test("hidden at its edge it draws nothing; out, it draws the hexagram with the switches that are on filled", async context => {
    const s = await setup(context, { layout: { out: false, edge: "right", x: 0, y: 0 } });
    assert.equal(s.render(), null);
    s.state.layout = { out: true, edge: "right", x: 330, y: 120 };
    await s.callbacks.layout();
    await s.settle();
    const tree = s.tree();
    assert.equal(tree.props["data-edge"], "right");
    assert.equal(s.point("main_page.transcription_send").props["data-on"], true);
    assert.equal(s.point("main_page.rvc").props["data-pending"], true);
    // At the right edge the three points facing left show: the voice changer, listening and chat reading.
    assert.deepEqual(s.shown(), ["main_page.rvc", "main_page.transcription_receive", "main_page.ocr"]);
});

// #536: each triangle carries its feature's icon, Lilac while the switch is on, Off-White while it
// is off (the colours are the stylesheet's, keyed by data-on). The icons stay upright as it turns.
test("each triangle carries its feature's icon, lit while the switch is on and upright as the hexagram turns", async context => {
    const s = await setup(context);
    const icons = () => {
        const found: TreeNode[] = [];
        find(s.render(), node => { if (node.type === "g" && typeof node.props["data-feature"] === "string") found.push(node); return false; });
        return found;
    };
    assert.deepEqual(icons().map(node => node.props["data-feature"]), ["mic", "translation", "tts", "rvc", "listening", "ocr"]);
    const icon = (feature: string) => findIn(s.render(), node => node.type === "g" && node.props["data-feature"] === feature);
    assert.equal(icon("mic").props["data-on"], true);
    assert.equal(icon("translation").props["data-on"], false);
    assert.equal(icon("rvc").props["data-pending"], true);
    // Each its own icon, the main window's: six different pictures, left out of what is read.
    const pictures = icons().map(node => [node.props.children].flat().find(child => child && typeof child === "object"));
    assert.equal(new Set(pictures.map(picture => picture?.type)).size, 6);
    assert.ok(pictures.every(picture => picture?.props["aria-hidden"] === "true"));
    // Shown with its triangle; the ones turned beyond the edge are faint like their triangles.
    assert.equal(icon("ocr").props["data-shown"], s.point("main_page.ocr").props["data-shown"]);
    assert.equal(icon("mic").props["data-shown"], s.point("main_page.transcription_send").props["data-shown"]);
    // Turned back as far as the star turns, so it reads upright.
    const star = findIn(s.render(), node => node.type === "g" && node.props.className === "star");
    const turned = (style: { transform: string }) => Number(style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1]);
    assert.equal(turned(icon("mic").props.style), -turned(star.props.style));
    s.tree().props.onWheel({ deltaY: 100 });
    await s.settle();
    assert.equal(turned(icon("mic").props.style), -turned(findIn(s.render(), node => node.type === "g" && node.props.className === "star").props.style));
});

// #536, as decided: a switch that is off has an Off-White triangle and icon; one that is on turns
// its triangle Lilac (every edge of it, and a faint tint inside, as the green of the first draft
// did) and its icon Lilac. Its outline is as wide as when it is off.
test("a switch that is on turns its triangle and its icon Lilac, its outline as wide as before", () => {
    const css = readFileSync(new URL("./CompanionHandle.css.ts", import.meta.url), "utf8");
    const rules = (name: string) => css.split(`export const ${name} = style(`)[1].split("\n});")[0];
    assert.match(css, /const ON = "#A47AF5";/);
    assert.match(css, /const OFF_WHITE = "#FAFAFC";/);
    assert.match(css, /const ON_TINT = "rgba\(164, 122, 245, 0\.16\)";/, "the tint is the Lilac of ON");
    assert.match(rules("point"), /fill: "transparent", stroke: OFF_WHITE, strokeWidth: 2\.4/);
    // The triangle keeps the tint and the width the pointer finds; its outline is drawn over the star,
    // as wide as an outline that is off.
    assert.match(rules("point"), /'&\[data-on="true"\]': \{ fill: ON_TINT, stroke: "transparent" \}/);
    assert.match(rules("outline"), /fill: "none", stroke: "transparent", strokeWidth: 2\.4, strokeLinejoin: "round", pointerEvents: "none"/);
    assert.doesNotMatch(rules("point") + rules("outline"), /'&\[data-on="true"\]': \{[^}]*strokeWidth/, "an outline that is on is not wider");
    // Docked out, it is as wide on as off.
    assert.match(rules("point"), /'&\[data-docked="true"\]': \{ strokeWidth: 3\.2 \}/);
    assert.match(rules("outline"), /'&\[data-on="true"\]\[data-docked="true"\]': \{ stroke: "#ffffff", strokeWidth: 3\.2 \}/);
    assert.match(rules("outline"), /'&\[data-on="true"\]': \{ stroke: ON \}/);
    assert.match(rules("icon"), /fill: OFF_WHITE, color: OFF_WHITE/);
    assert.match(rules("icon"), /'&\[data-on="true"\]': \{ fill: ON, color: ON \}/);
});

// #536: no edge of a triangle that is on shows white. The hexagon in the middle and the next
// triangles draw their outlines on its lines, so its outline is drawn after them.
test("the outline of a switch that is on is drawn over the hexagon in the middle and the other triangles", async context => {
    const s = await setup(context);
    const star = findIn(s.render(), node => node.type === "g" && node.props.className === "star");
    const drawn = [star.props.children].flat(Infinity).filter((child): child is TreeNode => Boolean(child) && typeof child === "object");
    const core = drawn.findIndex(node => node.props.role === "button");
    const outlines = drawn.filter(node => typeof node.props["data-outline"] === "string");
    assert.ok(core >= 0, "the hexagon in the middle is drawn");
    assert.deepEqual(outlines.map(node => node.props["data-outline"]), ["mic", "translation", "tts", "rvc", "listening", "ocr"]);
    assert.ok(outlines.every(node => drawn.indexOf(node) > core), "an outline is drawn under the hexagon in the middle");
    const outline = (feature: string) => outlines.find(node => node.props["data-outline"] === feature) as TreeNode;
    // Each on its own triangle, lit by its switch, and nothing to point at or to read.
    assert.equal(outline("mic").props.points, s.point("main_page.transcription_send").props.points);
    assert.equal(outline("mic").props["data-on"], true);
    assert.equal(outline("translation").props["data-on"], false);
    assert.equal(outline("rvc").props["data-pending"], true);
    assert.equal(outline("ocr").props["data-shown"], s.point("main_page.ocr").props["data-shown"]);
    assert.ok(outlines.every(node => !node.props["aria-label"] && !node.props.role && !node.props.onPointerEnter));
});

test("the wheel turns it a point at a time, bringing another switch into view", async context => {
    const s = await setup(context);
    const before = s.shown();
    s.tree().props.onWheel({ deltaY: 100 });
    s.tree().props.onWheel({ deltaY: 100 });
    await s.settle();
    const once = s.shown();
    assert.equal(once.filter(label => !before.includes(label)).length, 1, "a fast wheel still turns one point");
    vi.advanceTimersByTime(200);
    s.tree().props.onWheel({ deltaY: -100 });
    await s.settle();
    assert.deepEqual(s.shown(), before, "turned back");
});

test("hovering a point that shows docks its feature out towards the screen; only a press toggles it", async context => {
    const s = await setup(context);
    await s.rest(s.point("main_page.transcription_send"));
    assert.equal(s.dock(), null, "the mic's point is turned beyond the edge");
    await s.rest(s.point("main_page.transcription_receive"));
    const dock = s.dock();
    assert.ok(dock);
    assert.equal(dock.props["data-side"], "left", "at the right edge the label grows left, into the screen");
    assert.deepEqual(s.calls, [], "hovering changed nothing");
    dock.props.onClick();
    await flush();
    assert.deepEqual(s.calls, [["request", "toggle_listening"]]);
    await s.rest(s.point("main_page.rvc"));
    const waiting = s.dock();
    assert.ok(waiting);
    assert.equal(waiting.props.disabled, true, "a switch waiting for the backend cannot be pressed again");
});

test("a switch whose main switch is greyed out is drawn so and says it needs setup; a press still asks, to hear why (#562)", async context => {
    const s = await setup(context, { current: { ...ready, listening: { on: false, pending: false, blocked: true } } });
    assert.equal(s.point("main_page.transcription_receive").props["data-blocked"], true);
    assert.equal(s.point("main_page.rvc").props["data-blocked"], false);
    await s.rest(s.point("main_page.transcription_receive"));
    const dock = s.dock();
    assert.ok(dock);
    assert.deepEqual([dock.props["aria-disabled"], dock.props.disabled], [true, false]);
    assert.equal(findIn(dock, node => node.props?.className === "dockState").props.children, "companion.unavailable");
    dock.props.onClick();
    await flush();
    assert.deepEqual(s.calls, [["request", "toggle_listening"]], "the main window says why");
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
    vi.advanceTimersByTime(100);
    s.point("main_page.transcription_receive").props.onPointerLeave();
    vi.advanceTimersByTime(300);
    await s.settle();
    assert.equal(s.dock(), null);
});

test("resting on the hexagon in the middle docks out the common settings towards the screen", async context => {
    const s = await setup(context);
    await s.rest(s.core());
    assert.equal(s.dock(), null, "no switch's label");
    const menu = s.menu();
    assert.ok(menu);
    assert.equal(menu.props["data-side"], "left", "at the right edge it opens to the left, into the screen");
    assert.equal(menu.props["aria-label"], "companion.common.title");
    const edges: TreeNode[] = [];
    find(menu, node => { if (node.type === "button" && node.props["aria-pressed"] !== undefined) edges.push(node); return false; });
    assert.deepEqual(edges.map(node => node.props["aria-pressed"]), [true, false, false, false], "right is the current edge");
    // Pressing the current edge does nothing; another edge asks the main window to save it.
    edges[0].props.onClick();
    edges[3].props.onClick();
    await flush();
    assert.deepEqual(s.calls, [["request", "edge_bottom"]]);
    const items: TreeNode[] = [];
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
