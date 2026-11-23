import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { eventTarget, find, findIn, hooks, loadModule, nodesIn, setRef, stubGlobals, treeNode, unchecked } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as vrPanelTooltip from "../../logics/common/vrPanelTooltip.ts";
import type { VrTooltipLayout } from "./VrTooltip.tsx";

// The VR tooltip: the panel draws one tooltip into its own atlas region, and asks the backend
// (through the main window) to show that region over the button the laser or the focus is on.
// The page the tooltip reads is a stand-in: buttons with the data-tooltip-* attributes that
// VrTooltipButton writes, in a launcher or toolbar region, and the focus as the document has it.

const REQUEST = "/run/vr_panel_tooltip";
const TARGET = "button[data-tooltip-title]";

interface Rect { left: number; top: number; width: number; height: number }
interface FakeRegion { dataset: { vrRegion?: string }; getBoundingClientRect: () => Rect }
interface FakeButton {
    dataset: { tooltipTitle?: string; tooltipState?: string; tooltipHelp?: string; tooltipForce?: string };
    isConnected: boolean;
    focusVisible: boolean;
    region: FakeRegion | null;
    rect: Rect;
    closest: (selector: string) => unknown;
    matches: (selector: string) => boolean;
    getBoundingClientRect: () => Rect;
}

// The launcher's region is 400 x 100 in the atlas and drawn twice as large on the page (the
// atlas may be scaled in a preview), at (100, 200). A button 60 x 50 at (40, 10) in the region.
const LAYOUT = { tooltip_epoch: 7, regions: { launcher: [0, 0, 400, 100], toolbar: [0, 120, 400, 60], panel: [0, 200, 900, 900] } };
const regionAt = (name: string): FakeRegion => ({ dataset: { vrRegion: name }, getBoundingClientRect: () => ({ left: 100, top: 200, width: 800, height: 200 }) });
const SPOT: Rect = { left: 100 + 2 * 40, top: 200 + 2 * 10, width: 2 * 60, height: 2 * 50 };

function button(title: string, { state = "OFF", help = "Press to turn on", force = false, region = regionAt("launcher"), rect = SPOT, connected = true }:
    { state?: string; help?: string; force?: boolean; region?: FakeRegion | null; rect?: Rect; connected?: boolean } = {}): FakeButton {
    const fake: FakeButton = {
        dataset: { tooltipTitle: title, tooltipState: state, tooltipHelp: help, tooltipForce: force ? "true" : undefined },
        isConnected: connected, focusVisible: false, region, rect,
        closest: selector => selector === TARGET ? fake : selector === "[data-vr-region]" ? fake.region : null,
        matches: selector => selector === ":focus-visible" && fake.focusVisible,
        getBoundingClientRect: () => fake.rect,
    };
    return fake;
}

// A MutationObserver that keeps its callback, what it watches and whether it was disconnected.
class Observer {
    callback: (records: { attributeName: string | null }[]) => void;
    observed: [unknown, unknown][] = [];
    disconnected = false;
    constructor(callback: (records: { attributeName: string | null }[]) => void) { this.callback = callback; }
    observe(target: unknown, options: unknown) { this.observed.push([target, options]); }
    disconnect() { this.disconnected = true; }
}

async function setup(context: TestContext, { enabled = true, hasAtlas = true }: { enabled?: boolean; hasAtlas?: boolean } = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), sent: [string, unknown][] = [], observers: Observer[] = [], frames = new Map<number, () => void>(), cancelled: number[] = [];
    let frameId = 0, hovered: FakeButton | null = null, tooltips = enabled;
    const page: FakeButton[] = [];
    const documentEvents = eventTarget(), atlasEvents = eventTarget();
    const document: { activeElement: unknown } & typeof documentEvents = { ...documentEvents, activeElement: null };
    const atlas = { ...atlasEvents,
        contains: (node: unknown) => page.some(element => element === node),
        querySelector: (selector: string) => selector === `${TARGET}[data-vr-hover]` ? hovered : null,
    };
    // Unmounted before the globals go back: the clean-up stops listening on the document.
    context.onTestFinished(() => runtime.unmount());
    stubGlobals(context, { document,
        MutationObserver: class extends Observer {
            constructor(callback: (records: { attributeName: string | null }[]) => void) { super(callback); observers.push(this); }
        },
        requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: (id: number) => { cancelled.push(id); frames.delete(id); },
    });
    const { VrTooltip } = await loadModule<typeof import("./VrTooltip.tsx")>(new URL("./VrTooltip.tsx", import.meta.url), runtime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (path: string, payload: unknown) => { sent.push([path, payload]); return true; } }) },
        "@logics_configs": { useVr: () => ({ currentOverlayVrTooltip: { data: tooltips } }) },
        "../../logics/common/vrPanelTooltip": vrPanelTooltip,
    });
    const atlasRef = { current: hasAtlas ? atlas : null };
    let layout: VrTooltipLayout = LAYOUT, bodyHeight = 64;
    // One render. The tooltip's body gets a stand-in element whose height is the one set.
    const render = (next: Partial<VrTooltipLayout> = {}) => {
        layout = { ...layout, ...next };
        // Test data: the atlas holds only what the tooltip reads of an element.
        return runtime.render(VrTooltip, { atlasRef: unchecked<{ current: HTMLElement | null }>(atlasRef), layout }, tree => {
            const body = find(tree, node => node.props.role === "tooltip");
            if (body) setRef(body, { offsetHeight: bodyHeight });
        });
    };
    const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => { callback(); }); };
    return { runtime, sent, observers, frames, cancelled, document, atlas, atlasEvents, documentEvents, render, frame,
        // Adds a button to the page.
        add: (fake: FakeButton) => { page.push(fake); return fake; },
        hover: (fake: FakeButton | null) => { hovered = fake; },
        // The focused element: a button of the page, or any element the test makes.
        focus: (element: unknown) => { document.activeElement = element; },
        setHeight: (height: number) => { bodyHeight = height; },
        setEnabled: (value: boolean) => { tooltips = value; },
        // The page changed: the observer reports it, with these attribute names.
        mutate: (...names: (string | null)[]) => {
            const observer = observers.at(-1);
            assert.ok(observer);
            observer.callback(names.map(attributeName => ({ attributeName })));
        },
        // What was sent since the last call.
        take: () => sent.splice(0).map(([path, payload]) => { assert.equal(path, REQUEST); return payload; }),
    };
}
type Setup = Awaited<ReturnType<typeof setup>>;

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
// The tooltip as drawn: what the bubble says, its arrow and the marker's bits.
function shown(tree: unknown) {
    const body = findIn(tree, node => node.props.role === "tooltip", "the tooltip's body");
    const marker = findIn(tree, node => node.props["data-tooltip-marker"] === true, "the marker");
    const heading = findIn(body, node => Array.isArray(node.props.children) && treeNode(node.props.children[0])?.type === "strong", "the heading");
    const [title, state]: TreeNode[] = heading.props.children;
    const help = find(body, node => node.type === "p");
    const bits: TreeNode[] = marker.props.children;
    return { title: textOf(title), state: textOf(state), help: help && textOf(help), arrow: body.props.style["--tip-arrow"],
        hidden: marker.props["aria-hidden"], bits: bits.map(bit => bit.props.style.background === "#fff" ? 1 : bit.props.style.background === "#000" ? 0 : -1) };
}
const hidden = (epoch: number, revision: number) => ({ epoch, revision, visible: false });

// Shows the hovered button's tooltip and draws it, with its body measured. Once the tooltip has
// started, it learns of the hover from the page's change.
function showHovered(s: Setup, fake: FakeButton) {
    s.hover(fake);
    if (s.observers.length) s.mutate("data-vr-hover");
    s.render();
    vi.advanceTimersByTime(300);
    return s.render();
}

test("a tooltip button carries what its tooltip says, for the VR tooltip and for screen readers", async () => {
    const runtime = hooks();
    const { VrTooltipButton } = await loadModule<typeof import("./VrTooltip.tsx")>(new URL("./VrTooltip.tsx", import.meta.url), runtime, {
        "@logics_configs": { useVr: () => ({ currentOverlayVrTooltip: { data: true } }) },
        "../../logics/common/vrPanelTooltip": vrPanelTooltip,
    });
    const onClick = () => {};
    const forced = runtime.render(VrTooltipButton, { tipTitle: "Log", tipState: "Open", tipHelp: "Hold to recall", tipForce: true,
        className: "launcher", "aria-label": "Log", onClick, children: "icon", type: "submit" });
    assert.equal(forced.type, "button");
    // Always a plain button, never a form's submit.
    assert.equal(forced.props.type, "button");
    assert.deepEqual([forced.props["data-tooltip-title"], forced.props["data-tooltip-state"], forced.props["data-tooltip-help"], forced.props["data-tooltip-force"]],
        ["Log", "Open", "Hold to recall", "true"]);
    assert.deepEqual([forced.props.className, forced.props["aria-label"], forced.props.onClick], ["launcher", "Log", onClick]);
    // The state and the help are read out after the button's name, from a hidden line inside it.
    const [content, line]: [unknown, TreeNode] = forced.props.children;
    assert.equal(content, "icon");
    assert.equal(forced.props["aria-describedby"], line.props.id);
    assert.ok(line.props.id);
    assert.equal(line.props.children, "Open. Hold to recall");
    // The props that only the tooltip reads are not passed on to the button.
    for (const name of ["tipTitle", "tipState", "tipHelp", "tipForce"]) assert.equal(name in forced.props, false, name);

    runtime.remount();
    const plain = runtime.render(VrTooltipButton, { tipTitle: "Settings", tipHelp: "Open the settings" });
    assert.equal(plain.props["data-tooltip-force"], undefined, "shown only while the tooltips are on");
    assert.equal(plain.props["data-tooltip-state"], undefined);
    assert.equal(plain.props.children[1].props.children, "Open the settings", "no stray full stop without a state");
    runtime.remount();
    assert.equal(runtime.render(VrTooltipButton, { tipState: "ON" }).props.children[1].props.children, "ON");
    runtime.remount();
    assert.equal(runtime.render(VrTooltipButton, {}).props.children[1].props.children, "");
});

test("the hovered button's tooltip shows after 300 ms, over the button in the region's own pixels", async context => {
    const s = await setup(context);
    const log = s.add(button("Log", { state: "Hidden", help: "Press to open" }));
    s.hover(log);
    assert.equal(s.render(), null);
    // Nothing is shown yet: the backend is told so, at the first revision of this layout.
    assert.deepEqual(s.take(), [hidden(7, 1)]);
    vi.advanceTimersByTime(299);
    assert.equal(s.render(), null);
    vi.advanceTimersByTime(1);
    const tree = s.render();
    assert.deepEqual(shown(tree), { title: "Log", state: "Hidden", help: "Press to open", arrow: "58px", hidden: "true",
        bits: vrPanelTooltip.tooltipMarker(7, 2) });
    // The marker carries the layout's epoch and the revision: the backend shows this drawing only.
    assert.equal(shown(tree).bits.length, 80);
    assert.deepEqual(s.take(), []);
    // Two frames later the drawing is on the page; then the backend is asked to show it at its size.
    s.frame();
    assert.deepEqual(s.take(), []);
    s.frame();
    assert.deepEqual(s.take(), [{ epoch: 7, revision: 2, visible: true, region: "launcher", mode: "hover", button: [40, 10, 60, 50], arrow_x: 58, size: [360, 64] }]);
});

test("a tooltip on the toolbar is placed in the toolbar's region", async context => {
    const s = await setup(context);
    s.render({ regions: { ...LAYOUT.regions, toolbar: [0, 120, 200, 50] } });
    s.take();
    // The same spot on the page, in a region half as large: the region's scale is 4.
    const lock = s.add(button("Lock", { region: regionAt("toolbar") }));
    s.hover(lock);
    s.mutate("data-vr-hover");
    vi.advanceTimersByTime(300);
    s.render();
    s.frame();
    s.frame();
    assert.deepEqual(s.take().at(-1), { epoch: 7, revision: 2, visible: true, region: "toolbar", mode: "hover", button: [20, 5, 30, 25], arrow_x: 23, size: [360, 64] });
});

test("a tooltip without help has no help line", async context => {
    const s = await setup(context);
    const tree = showHovered(s, s.add(button("Settings", { help: "" })));
    assert.equal(shown(tree).help, null);
    assert.equal(nodesIn(findIn(tree, node => node.props.role === "tooltip")).some(node => node.type === "p"), false);
});

test("the size is asked for only while the drawing is the newest, and only for a height the region can hold", async context => {
    const s = await setup(context);
    const log = s.add(button("Log")), settings = s.add(button("Settings"));
    showHovered(s, log);
    s.take();
    // The laser moves on before the frames run: the old drawing's size is never sent.
    s.hover(settings);
    s.mutate("data-vr-hover");
    assert.deepEqual(s.take(), [hidden(7, 3)]);
    s.frame();
    s.frame();
    assert.deepEqual(s.take(), []);
    // A tooltip 1 to 104 px high fits; one that is not laid out, or taller, is never shown.
    for (const [height, sends] of [[0, false], [1, true], [104, true], [105, false]] as const) {
        s.setHeight(height);
        s.hover(height % 2 ? log : settings);
        s.mutate("data-vr-hover");
        s.render();
        vi.advanceTimersByTime(300);
        s.render();
        s.take();
        s.frame();
        s.frame();
        assert.deepEqual(s.take().map(payload => Reflect.get(Object(payload), "size")), sends ? [[360, height]] : [], `height ${height}`);
    }
});

test("frames still waiting are cancelled when the tooltip changes or goes", async context => {
    const s = await setup(context);
    showHovered(s, s.add(button("Log")));
    const [first] = s.frames.keys();
    // The tooltip goes before the first frame: that frame is cancelled.
    s.hover(null);
    s.mutate("data-vr-hover");
    s.render();
    assert.deepEqual(s.cancelled, [first]);
    assert.equal(s.frames.size, 0);
    // Shown again; this time it goes between the two frames, and the second is cancelled.
    showHovered(s, s.add(button("Settings")));
    s.frame();
    const [second] = s.frames.keys();
    s.runtime.unmount();
    assert.ok(s.cancelled.includes(second));
    s.frame();
    assert.equal(s.take().some(payload => Reflect.get(Object(payload), "visible") === true), false);
});

test("a focused button's tooltip shows at once, and Escape dismisses it until the focus moves on", async context => {
    const s = await setup(context);
    const log = s.add(button("Log")), settings = s.add(button("Settings"));
    log.focusVisible = true;
    s.focus(log);
    // The focus is on a button when the tooltip starts: it is the one shown, without the hover delay.
    s.render();
    vi.advanceTimersByTime(0);
    const tree = s.render();
    assert.equal(shown(tree).title, "Log");
    s.frame();
    s.frame();
    assert.equal(Reflect.get(Object(s.take().at(-1)), "mode"), "focus");
    // Escape hides it.
    s.documentEvents.dispatch("keydown", { key: "Escape" });
    assert.deepEqual(s.take(), [hidden(7, 3)]);
    assert.equal(s.render(), null);
    // It stays hidden while the focus stays, even when the button's words change.
    s.mutate("data-tooltip-title");
    log.dataset.tooltipState = "ON";
    s.mutate("data-tooltip-state");
    vi.advanceTimersByTime(1000);
    assert.equal(s.render(), null);
    // Another key does nothing to it.
    s.documentEvents.dispatch("keydown", { key: "a" });
    assert.equal(s.render(), null);
    // The focus moves to another button: its tooltip shows.
    settings.focusVisible = true;
    s.focus(settings);
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Settings");
    // And back: the dismissed button's tooltip shows again.
    s.focus(log);
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Log");
});

test("the focus is followed once Tab is pressed, and the laser takes over when it moves", async context => {
    const s = await setup(context);
    const log = s.add(button("Log")), settings = s.add(button("Settings"));
    s.focus(settings);
    assert.equal(shown(showHovered(s, log)).title, "Log", "a focus without a ring is the laser's click: the hover wins");
    // Tab moves the focus with its ring: from then on, the focused button's tooltip shows, at once.
    s.documentEvents.dispatch("keydown", { key: "Tab" });
    settings.focusVisible = true;
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Settings");
    // The page changes in other ways: the focus keeps the tooltip.
    s.mutate("class", null);
    assert.equal(shown(s.render()).title, "Settings");
    // The laser moves onto another button: its tooltip, after the hover delay.
    s.mutate("data-vr-hover");
    assert.equal(s.render(), null);
    vi.advanceTimersByTime(299);
    assert.equal(s.render(), null);
    vi.advanceTimersByTime(1);
    assert.equal(shown(s.render()).title, "Log");
    // A click in the panel moves the focus without a ring: the laser keeps it.
    settings.focusVisible = false;
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(300);
    assert.equal(shown(s.render()).title, "Log");
});

test("when the focus leaves, the tooltip follows where it went once the browser has moved it", async context => {
    const s = await setup(context);
    const log = s.add(button("Log"));
    log.focusVisible = true;
    s.focus(log);
    s.render();
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Log");
    // The focus leaves the panel: the browser moves it after the focusout event.
    s.atlasEvents.dispatch("focusout");
    s.focus(null);
    assert.equal(shown(s.render()).title, "Log", "not before the focus has moved");
    await Promise.resolve();
    assert.equal(s.render(), null);
});

test("a focus ring outside the panel is not followed", async context => {
    const s = await setup(context);
    const log = s.add(button("Log"));
    // A focused element outside the atlas, with its ring.
    const outside = { ...button("Elsewhere"), focusVisible: true, matches: () => true };
    s.focus(outside);
    showHovered(s, log);
    assert.equal(shown(s.render()).title, "Log");
    // A focused element inside the panel but without a tooltip.
    const field = { matches: () => true, closest: () => null };
    s.add(unchecked<FakeButton>(field));
    s.focus(field);
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(0);
    assert.equal(s.render(), null);
});

test("the same button with new words shows them at once", async context => {
    const s = await setup(context);
    const translation = s.add(button("Translation", { state: "OFF" }));
    showHovered(s, translation);
    s.take();
    translation.dataset.tooltipState = "ON";
    s.mutate("data-tooltip-state");
    assert.deepEqual(s.take(), [hidden(7, 3)]);
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).state, "ON");
    // Words that did not change: nothing is hidden or sent again.
    s.mutate("data-tooltip-state");
    assert.deepEqual(s.take(), []);
    for (const field of ["tooltipTitle", "tooltipHelp"] as const) {
        translation.dataset[field] = `new ${field}`;
        s.mutate(null);
        vi.advanceTimersByTime(0);
        const now = shown(s.render());
        assert.equal(field === "tooltipTitle" ? now.title : now.help, `new ${field}`);
    }
});

test("with the tooltips turned off, only a button that must explain itself shows its tooltip", async context => {
    const s = await setup(context, { enabled: false });
    const plain = s.add(button("Settings")), blocked = s.add(button("OCR", { force: true }));
    showHovered(s, plain);
    vi.advanceTimersByTime(1000);
    assert.equal(s.render(), null);
    s.hover(blocked);
    s.mutate("data-vr-hover");
    vi.advanceTimersByTime(300);
    assert.equal(shown(s.render()).title, "OCR");
    // Focus follows the same rule.
    s.hover(null);
    plain.focusVisible = true;
    s.focus(plain);
    s.documentEvents.dispatch("keydown", { key: "Tab" });
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(300);
    assert.equal(s.render(), null);
    // The tooltips are turned on: the tooltip starts again and shows the plain button.
    s.setEnabled(true);
    s.render();
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Settings");
});

test("turning the tooltips off hides a plain button's tooltip that is showing", async context => {
    const s = await setup(context);
    showHovered(s, s.add(button("Settings")));
    s.take();
    s.setEnabled(false);
    s.render();
    assert.deepEqual(s.take(), [hidden(7, 3)]);
    vi.advanceTimersByTime(1000);
    assert.equal(s.render(), null);
});

test("only buttons that are on the page, in the launcher or the toolbar and inside their region show a tooltip", async context => {
    const s = await setup(context);
    s.render();
    const cases: [string, FakeButton][] = [
        ["removed", button("Removed", { connected: false })],
        ["in the log", button("Log", { region: regionAt("panel") })],
        ["in no region", button("Loose", { region: null })],
        ["in a region without a name", button("Unnamed", { region: { dataset: {}, getBoundingClientRect: () => ({ left: 100, top: 200, width: 800, height: 200 }) } })],
        ["outside its region", button("Outside", { rect: { ...SPOT, left: 0 } })],
    ];
    for (const [name, fake] of cases) {
        s.add(fake);
        s.hover(fake);
        s.mutate("data-vr-hover");
        vi.advanceTimersByTime(300);
        assert.equal(s.render(), null, name);
    }
});

test("without a layout epoch or an atlas, the tooltip waits and sends nothing", async context => {
    const s = await setup(context);
    s.hover(s.add(button("Log")));
    assert.equal(s.render({ tooltip_epoch: 0 }), null);
    assert.equal(s.render({ tooltip_epoch: undefined }), null);
    vi.advanceTimersByTime(1000);
    assert.equal(s.render(), null);
    assert.deepEqual([s.take(), s.observers.length, s.documentEvents.added, s.atlasEvents.added], [[], 0, [], []]);
    const none = await setup(context, { hasAtlas: false });
    none.hover(none.add(button("Log")));
    assert.equal(none.render(), null);
    vi.advanceTimersByTime(1000);
    assert.equal(none.render(), null);
    assert.deepEqual([none.take(), none.observers.length], [[], 0]);
});

test("the tooltip watches the page for what it shows, and stops when it goes", async context => {
    const s = await setup(context);
    s.render();
    const [observer] = s.observers;
    assert.deepEqual(observer.observed, [[s.atlas, { subtree: true, attributes: true, childList: true,
        attributeFilter: ["data-vr-hover", "data-tooltip-title", "data-tooltip-state", "data-tooltip-help", "data-tooltip-force"] }]]);
    assert.deepEqual(s.atlasEvents.added.map(([type]) => type), ["focusin", "focusout"]);
    assert.deepEqual(s.documentEvents.added.map(([type]) => type), ["keydown"]);
    assert.deepEqual(s.take(), [], "nothing to hide yet");
    s.runtime.unmount();
    assert.equal(observer.disconnected, true);
    assert.deepEqual(s.atlasEvents.removed, s.atlasEvents.added);
    assert.deepEqual(s.documentEvents.removed, s.documentEvents.added);
    assert.deepEqual(s.take(), [hidden(7, 1)]);
    // A change the observer reports after that does nothing.
    s.hover(s.add(button("Log")));
    observer.callback([{ attributeName: "data-vr-hover" }]);
    vi.advanceTimersByTime(1000);
    assert.deepEqual(s.take(), []);
});

test("a hover waiting to show is dropped when the tooltip goes", async context => {
    const s = await setup(context);
    s.hover(s.add(button("Log")));
    s.render();
    s.runtime.unmount();
    s.take();
    vi.advanceTimersByTime(1000);
    assert.deepEqual(s.take(), []);
    assert.equal(s.render(), null);
});

test("a new layout epoch starts the revisions again; a new launcher or toolbar size or setting starts the tooltip again", async context => {
    const s = await setup(context);
    s.render();
    // Nothing hovered or focused: nothing to hide.
    assert.deepEqual([s.take(), s.observers.length], [[], 1]);
    // The same layout drawn again: nothing starts again.
    s.render();
    assert.deepEqual([s.take(), s.observers.length], [[], 1]);
    // A new epoch: the tooltip is hidden in the old epoch, and the new one counts from 1.
    s.render({ tooltip_epoch: 8 });
    assert.deepEqual([s.take(), s.observers.length], [[hidden(7, 1)], 2]);
    s.render({ regions: { ...LAYOUT.regions, launcher: [0, 0, 500, 100] } });
    assert.deepEqual([s.take(), s.observers.length], [[hidden(8, 1)], 3]);
    // In the same epoch the revisions go on.
    s.render({ regions: { ...LAYOUT.regions, launcher: [0, 0, 500, 100], toolbar: [0, 0, 1, 1] } });
    assert.deepEqual([s.take(), s.observers.length], [[hidden(8, 2)], 4]);
    // The other regions do not place the tooltip: a change there starts nothing again.
    s.render({ regions: { ...LAYOUT.regions, launcher: [0, 0, 500, 100], toolbar: [0, 0, 1, 1], panel: [1, 1, 1, 1] } });
    assert.deepEqual([s.take(), s.observers.length], [[], 4]);
});

test("words that move between the title and the state are new words", async context => {
    const s = await setup(context);
    const translation = s.add(button("Translation", { state: "ON" }));
    showHovered(s, translation);
    s.take();
    translation.dataset.tooltipTitle = "TranslationO";
    translation.dataset.tooltipState = "N";
    s.mutate("data-tooltip-title");
    assert.deepEqual(s.take(), [hidden(7, 3)]);
    vi.advanceTimersByTime(0);
    assert.deepEqual([shown(s.render()).title, shown(s.render()).state], ["TranslationO", "N"]);
});

test("the laser moving to another button with the same words moves the tooltip to it", async context => {
    const s = await setup(context);
    const left = s.add(button("Hand")), right = s.add(button("Hand", { rect: { ...SPOT, left: SPOT.left + 2 * 100 } }));
    showHovered(s, left);
    s.frame();
    s.frame();
    assert.deepEqual(Reflect.get(Object(s.take().at(-1)), "button"), [40, 10, 60, 50]);
    showHovered(s, right);
    s.frame();
    s.frame();
    assert.deepEqual(Reflect.get(Object(s.take().at(-1)), "button"), [140, 10, 60, 50]);
});

test("the same button taken over by the keyboard or the laser is placed again for the new mode", async context => {
    const s = await setup(context);
    const log = s.add(button("Log"));
    showHovered(s, log);
    s.frame();
    s.frame();
    assert.equal(Reflect.get(Object(s.take().at(-1)), "mode"), "hover");
    // Tab puts the focus ring on the button the laser is on: the tooltip is sent again, at once, for the focus.
    log.focusVisible = true;
    s.focus(log);
    s.documentEvents.dispatch("keydown", { key: "Tab" });
    s.atlasEvents.dispatch("focusin");
    assert.deepEqual(s.take(), [hidden(7, 3)]);
    vi.advanceTimersByTime(0);
    s.render();
    s.frame();
    s.frame();
    assert.equal(Reflect.get(Object(s.take().at(-1)), "mode"), "focus");
    // The laser moves on the same button: back to the hover, after the hover's delay.
    s.mutate("data-vr-hover");
    assert.deepEqual(s.take(), [hidden(7, 5)]);
    vi.advanceTimersByTime(299);
    assert.equal(s.render(), null);
    vi.advanceTimersByTime(1);
    s.render();
    s.frame();
    s.frame();
    assert.equal(Reflect.get(Object(s.take().at(-1)), "mode"), "hover");
});

test("Tab hands the tooltip to the focused button at the next change of the page, before the focus moves", async context => {
    const s = await setup(context);
    const log = s.add(button("Log")), settings = s.add(button("Settings"));
    settings.focusVisible = true;
    s.focus(settings);
    s.render();
    // The laser takes over from the focus.
    showHovered(s, log);
    assert.equal(shown(s.render()).title, "Log");
    // Another key, and a change of the page: the laser keeps it.
    s.documentEvents.dispatch("keydown", { key: "ArrowDown" });
    s.mutate("class");
    vi.advanceTimersByTime(300);
    assert.equal(shown(s.render()).title, "Log");
    // Tab, then a change of the page (a picker mounts the next row before it moves the focus).
    s.documentEvents.dispatch("keydown", { key: "Tab" });
    s.mutate("class");
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Settings");
});

test("keys other than Escape leave a showing tooltip as it is", async context => {
    const s = await setup(context);
    showHovered(s, s.add(button("Log")));
    s.take();
    for (const key of ["a", "Enter", "Tab"]) s.documentEvents.dispatch("keydown", { key });
    assert.deepEqual(s.take(), []);
    assert.equal(shown(s.render()).title, "Log");
});

test("a click in the panel gives the tooltip back to the laser; the focus leaving the panel does not", async context => {
    const s = await setup(context);
    const log = s.add(button("Log")), settings = s.add(button("Settings")), field = s.add(button("Field"));
    s.hover(log);
    settings.focusVisible = true;
    s.focus(settings);
    s.render();
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Settings", "the focus with its ring comes first");
    // The laser clicks another part of the panel: the focus moves there without a ring.
    s.focus(field);
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(300);
    assert.equal(shown(s.render()).title, "Log");
    // Tab back to the button, then the focus leaves the panel for something without a ring.
    s.focus(settings);
    s.atlasEvents.dispatch("focusin");
    vi.advanceTimersByTime(0);
    assert.equal(shown(s.render()).title, "Settings");
    s.focus({ matches: () => false });
    s.atlasEvents.dispatch("focusout");
    await Promise.resolve();
    vi.advanceTimersByTime(300);
    assert.equal(s.render(), null, "still the keyboard's: the laser's button does not take over");
});

test("a frame left from an older layout never asks for a size, even when the new revision has caught up", async context => {
    const s = await setup(context);
    const log = s.add(button("Log"));
    showHovered(s, log);
    s.take();
    // A new layout arrives before the frames run; its tooltip is shown at the same revision.
    s.render({ tooltip_epoch: 8 });
    vi.advanceTimersByTime(300);
    assert.deepEqual(s.take(), [hidden(7, 3), hidden(8, 1)]);
    s.frame();
    s.frame();
    assert.deepEqual(s.take(), []);
});
