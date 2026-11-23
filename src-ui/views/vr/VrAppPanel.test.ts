import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, draw, drawWith, findIn, hooks, loadModule, nodesIn, setRef, stubGlobals } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as wire from "../../logics/common/vrPanelWire.ts";
import { keepNewestVrLayout } from "../../logics/common/vrPanelTooltip.ts";

// The VR panel's page: one atlas with a region for each window, which the backend shows as
// separate overlays. It tells the backend when a new layout is drawn and which windows are open,
// counts its settings window as the main window's settings page, follows the VR laser for hover,
// and mirrors the main window's state from its own channel. The windows are stand-ins.

const LAYOUT = { atlas: [2048, 1024], regions: { panel: [0, 0, 900, 600], launcher: [910, 0, 400, 100], popup: [910, 110, 700, 600],
    toolbar: [0, 610, 900, 60], tooltip: [1320, 0, 360, 104] } };
type Layout = typeof LAYOUT;

// The windows the panel holds, as stand-ins.
const VrLauncher = () => null, VrLogWindow = () => null, VrPopupWindow = () => null, VrToolbar = () => null, VrTooltip = () => null;
const UiLanguageController = () => null, FontFamilyController = () => null;
// A setting the main window mirrors that is a hook, not an atom.
const useSomething = () => null;

class Channel { onmessage: (message: Readonly<Record<string, unknown>>) => void = () => {}; }

async function panel(context: TestContext, { layout = LAYOUT, configOpen = false }: { layout?: Layout; configOpen?: unknown } = {}) {
    const runtime = hooks();
    // Unmounted before the globals go back: the clean-up cancels frames.
    context.onTestFinished(() => runtime.unmount());
    const frames = new Map<number, () => void>(), cancelled: number[] = [];
    let frameId = 0;
    stubGlobals(context, {
        requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: (id: number) => { cancelled.push(id); frames.delete(id); },
    });
    const sent: unknown[][] = [], toMain: unknown[][] = [], subscriptions: [string, Channel][] = [];
    const listeners = new Map<string, (event: { payload: unknown }) => void>(), unlistened: string[] = [];
    const tracked: { root: unknown; pointers: unknown[]; disposed: boolean }[] = [];
    // The window's store: the atoms the main window mirrors here, with what they hold.
    const atoms = new Map<unknown, unknown>([["layout-atom", { state: "ok", data: { tooltip_epoch: 5, atlas: [1, 1] } }]]);
    let subscribed: () => void = () => {};
    const current = { layout, configOpen };
    const dependencies = {
        "@tauri-apps/api/core": { Channel, invoke: (name: string, args: { channel: Channel }) => {
            subscriptions.push([name, args.channel]);
            return new Promise<void>(resolve => { subscribed = resolve; });
        } },
        "@tauri-apps/api/event": { listen: (name: string, handler: (event: { payload: unknown }) => void) => {
            listeners.set(name, handler);
            return Promise.resolve(() => { unlistened.push(name); listeners.delete(name); });
        } },
        jotai: { getDefaultStore: () => ({ set: (atom: unknown, update: (previous: unknown) => unknown) => { atoms.set(atom, update(atoms.get(atom))); } }) },
        "@store": { dynamicStoreRegistry: { Atom_MessageLogs: "logs-atom", Atom_VrPanelLayout: "layout-atom", Atom_SelectableFontFamilyList: "fonts-atom",
            Atom_Something: useSomething } },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (...args: unknown[]) => { sent.push(args); } }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: current.configOpen } }) },
        "../app/_app_controllers": { UiLanguageController, FontFamilyController },
        "@logics_configs": { useVr: () => ({ currentVrPanelLayout: { data: current.layout } }) },
        "./VrLauncher": { VrLauncher }, "./VrLogWindow": { VrLogWindow }, "./VrPopupWindow": { VrPopupWindow },
        "./VrToolbar": { VrToolbar }, "./VrTooltip": { VrTooltip },
        "./vrPanelHover": { trackVrPointerHover: (root: unknown) => {
            const hover = { root, pointers: [] as unknown[], disposed: false };
            tracked.push(hover);
            return { setPointer: (pointer: unknown) => { hover.pointers.push(pointer); }, dispose: () => { hover.disposed = true; } };
        } },
        "../../logics/common/vrPanelTooltip": { keepNewestVrLayout },
        "../../logics/common/vrPanelWire": wire,
        "../../logics/common/vrPanelSend.ts": { sendToMain: async (...args: unknown[]) => { toMain.push(args); } },
    };
    const load = (on: typeof runtime) => loadModule<typeof import("./VrApp.tsx")>(new URL("./VrApp.tsx", import.meta.url), on, dependencies);
    const { VrApp } = await load(runtime);
    const atlas = { name: "atlas" };
    let tree: TreeNode | undefined;
    const render = () => { tree = runtime.render(VrApp, undefined, drawn => { setRef(drawn, atlas); }); return tree; };
    render();
    const now = () => { assert.ok(tree); return tree; };
    const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => { callback(); }); };
    return { runtime, current, frames, cancelled, sent, toMain, subscriptions, listeners, unlistened, tracked, atoms, atlas, render, frame,
        subscribed: () => subscribed(),
        get tree() { return now(); },
        launcher: () => findIn(now(), node => node.type === VrLauncher, "the launcher").props,
        // The regions of the atlas, drawn, by name.
        regions: (): Record<string, TreeNode> => Object.fromEntries(nodesIn(now()).filter(node => componentName(node) === "Region").map(node => [node.props.name, draw(node)])),
        part: (name: string) => findIn(now(), node => componentName(node) === name, name),
        // One of the page's own parts, with a runtime of its own: a second copy of the page is
        // drawn once to reach the part, and its runtime then draws only the part.
        partAlone: async (name: string) => {
            const own = hooks();
            context.onTestFinished(() => own.unmount());
            const copy = await load(own);
            const node = findIn(own.render(copy.VrApp, undefined, drawn => { setRef(drawn, atlas); }), node => componentName(node) === name, name);
            own.remount();
            return { runtime: own, node };
        },
        // The windows' report since the last call.
        windows: () => sent.splice(0).filter(([path]) => path === "/run/vr_panel_windows").map(([, payload]) => payload),
    };
}
type Panel = Awaited<ReturnType<typeof panel>>;

test("the atlas is the layout's size, and each window is drawn in the region the layout gives it", async context => {
    const view = await panel(context);
    assert.deepEqual(view.tree.props.style, { width: 2048, height: 1024 });
    const regions = view.regions();
    assert.deepEqual(Object.keys(regions), ["panel", "launcher", "popup", "toolbar", "tooltip"]);
    for (const [name, region] of Object.entries(regions)) {
        const [x, y, w, h] = LAYOUT.regions[name as keyof Layout["regions"]];
        assert.equal(region.props["data-vr-region"], name);
        assert.deepEqual([region.props.style.left, region.props.style.top, region.props.style.width, region.props.style.height], [x, y, w, h], name);
    }
    // Only the log's region is hidden, while the log is closed.
    for (const name of ["launcher", "popup", "toolbar", "tooltip"]) {
        assert.deepEqual([regions[name].props.inert, regions[name].props["aria-hidden"], regions[name].props.style.visibility], [false, undefined, undefined], name);
    }
    const children = (name: string) => regions[name].props.children.type;
    assert.deepEqual([children("panel"), children("launcher"), children("popup"), children("toolbar"), children("tooltip")],
        [VrLogWindow, VrLauncher, VrPopupWindow, VrToolbar, VrTooltip]);
    // The tooltip reads the atlas and the layout.
    const tooltip = regions.tooltip.props.children.props;
    assert.deepEqual([tooltip.layout, typeof tooltip.atlasRef], [LAYOUT, "object"]);
    assert.equal(tooltip.atlasRef.current, view.atlas);
    assert.ok([UiLanguageController, FontFamilyController].every(controller => nodesIn(view.tree).some(node => node.type === controller)));
});

test("two frames after a layout is drawn, the backend is told the log's size", async context => {
    const view = await panel(context);
    const rendered = () => view.sent.splice(0).filter(([path]) => path === "/run/vr_panel_layout_rendered");
    view.windows();
    view.frame();
    assert.deepEqual(rendered(), []);
    view.frame();
    assert.deepEqual(rendered(), [["/run/vr_panel_layout_rendered", [900, 600]]]);
    // The log changes size: told again, with the new size. The whole atlas changing alone is not news.
    view.current.layout = { ...LAYOUT, atlas: [4096, 2048] };
    view.render();
    view.frame();
    view.frame();
    assert.deepEqual(rendered(), []);
    view.current.layout = { ...LAYOUT, regions: { ...LAYOUT.regions, panel: [0, 0, 1200, 800] } };
    view.render();
    view.frame();
    view.frame();
    assert.deepEqual(rendered(), [["/run/vr_panel_layout_rendered", [1200, 800]]]);
});

test("a layout replaced before its frames ran is never reported", async context => {
    const view = await panel(context);
    const [first] = view.frames.keys();
    view.current.layout = { ...LAYOUT, regions: { ...LAYOUT.regions, panel: [0, 0, 1000, 700] } };
    view.render();
    assert.deepEqual(view.cancelled, [first]);
    view.frame();
    const [second] = view.frames.keys();
    view.current.layout = { ...LAYOUT, regions: { ...LAYOUT.regions, panel: [0, 0, 1100, 700] } };
    view.render();
    assert.ok(view.cancelled.includes(second));
    view.frame();
    view.frame();
    assert.deepEqual(view.sent.filter(([path]) => path === "/run/vr_panel_layout_rendered").map(([, size]) => size), [[1100, 700]]);
});

test("the backend is told which windows are open: the log, and whether a temporary window is", async context => {
    const view = await panel(context);
    assert.deepEqual(view.windows(), [{ log: false, popup: false }]);
    assert.deepEqual(view.launcher().windows, { log: false, popup: null });
    view.launcher().toggleLog();
    view.render();
    assert.deepEqual(view.windows(), [{ log: true, popup: false }]);
    assert.equal(findIn(view.tree, node => node.type === VrLogWindow).props.open, true);
    // Opening the log when it is open keeps it open, and nothing is said.
    view.launcher().openLog();
    view.render();
    assert.deepEqual(view.windows(), []);
    view.launcher().togglePopup("language");
    view.render();
    assert.deepEqual(view.windows(), [{ log: true, popup: true }]);
    assert.equal(findIn(view.tree, node => node.type === VrPopupWindow).props.popup, "language");
    // Another temporary window takes its place; the same one again closes it.
    view.launcher().togglePopup("io_flow");
    view.render();
    assert.deepEqual([view.windows(), view.launcher().windows], [[{ log: true, popup: true }], { log: true, popup: "io_flow" }]);
    view.launcher().togglePopup("io_flow");
    view.render();
    assert.deepEqual(view.windows(), [{ log: true, popup: false }]);
    view.launcher().togglePopup("settings");
    view.render();
    findIn(view.tree, node => node.type === VrPopupWindow).props.onClose();
    view.render();
    assert.deepEqual(view.launcher().windows, { log: true, popup: null });
    findIn(view.tree, node => node.type === VrLogWindow).props.onClose();
    view.render();
    assert.deepEqual(view.launcher().windows, { log: false, popup: null });
    assert.deepEqual(view.windows().at(-1), { log: false, popup: false });
});

test("the settings window counts as the main window's settings page while it is open", async context => {
    const view = await panel(context);
    await Promise.resolve();
    assert.deepEqual(view.toMain, [["vr-panel-config-page", false]]);
    view.launcher().togglePopup("settings");
    view.render();
    view.launcher().togglePopup("language");
    view.render();
    // Another temporary window, or the log, is not the settings page.
    view.launcher().togglePopup("io_flow");
    view.render();
    view.launcher().toggleLog();
    view.render();
    assert.deepEqual(view.toMain, [["vr-panel-config-page", false], ["vr-panel-config-page", true], ["vr-panel-config-page", false]]);
});

test("the main window closing its settings page closes the VR settings window, and nothing else", async context => {
    const view = await panel(context);
    view.launcher().togglePopup("settings");
    view.render();
    view.current.configOpen = true;
    view.render();
    view.render();
    assert.equal(view.launcher().windows.popup, "settings", "the page opening keeps it open");
    view.current.configOpen = false;
    view.render();
    view.render();
    assert.equal(view.launcher().windows.popup, null);
    // With another window open, closing the page leaves it.
    view.launcher().togglePopup("language");
    view.render();
    view.current.configOpen = true;
    view.render();
    view.current.configOpen = false;
    view.render();
    view.render();
    assert.equal(view.launcher().windows.popup, "language");
});

test("a settings page that was never open closes nothing", async context => {
    const view = await panel(context);
    view.launcher().togglePopup("settings");
    view.render();
    // Drawn again with the page still closed, or with a value that is not true.
    view.current.configOpen = false;
    view.render();
    view.current.configOpen = "true";
    view.render();
    view.current.configOpen = false;
    view.render();
    view.render();
    assert.equal(view.launcher().windows.popup, "settings");
});

test("the VR laser's position, forwarded by the main window, marks what it points at", async context => {
    const view = await panel(context);
    const { runtime: hoverRuntime, node: hover } = await view.partAlone("VrPointerHover");
    view.tracked.length = 0;
    assert.equal(drawWith(hoverRuntime, hover), null);
    assert.deepEqual(view.tracked.map(tracker => tracker.root), [view.atlas]);
    const listener = view.listeners.get("vr-panel-pointer");
    assert.ok(listener);
    listener({ payload: { x: 10, y: 20 } });
    listener({ payload: null });
    assert.deepEqual(view.tracked[0].pointers, [{ x: 10, y: 20 }, null]);
    // Drawn again: nothing starts again.
    drawWith(hoverRuntime, hover);
    assert.equal(view.tracked.length, 1);
    hoverRuntime.unmount();
    assert.equal(view.tracked[0].disposed, true);
    await Promise.resolve();
    assert.deepEqual(view.unlistened, ["vr-panel-pointer"]);
});

test("following the laser needs the atlas to be drawn", async context => {
    const view = await panel(context);
    const { runtime, node } = await view.partAlone("VrPointerHover");
    assert.throws(() => drawWith(runtime, node, { atlasRef: { current: null } }), { name: "TypeError", message: "The VR panel's atlas is not drawn" });
});

// The state receiver, started: its channel, and a way to stop it.
async function receiver(view: Panel) {
    const { runtime: stateRuntime, node } = await view.partAlone("VrStateReceiver");
    view.subscriptions.length = 0;
    assert.equal(drawWith(stateRuntime, node), null);
    const [[command, channel]] = view.subscriptions;
    assert.equal(command, "vr_panel_state_subscribe");
    return { channel, stop: () => stateRuntime.unmount() };
}
const log = (sent: wire.SentLog<unknown> | null, data: unknown[], full = false) => wire.encodeLogUpdate(sent, { data, state: "ok" }, full);

test("the mirrored state is written to this window's atoms as the main window holds it, in order", async context => {
    const view = await panel(context);
    const { channel } = await receiver(view);
    channel.onmessage({ SelectableFontFamilyList: wire.encodeOrdered({ state: "ok", data: { Zeta: "Zeta", Alpha: "Alpha" } }) });
    const fonts = view.atoms.get("fonts-atom");
    assert.deepEqual(fonts, { state: "ok", data: { Zeta: "Zeta", Alpha: "Alpha" } });
    assert.deepEqual(Object.keys(Reflect.get(Object(fonts), "data")), ["Zeta", "Alpha"]);
    // A name with no atom here, or whose entry is a hook, is not written.
    channel.onmessage({ Unknown: 1, Something: 2 });
    assert.deepEqual([...view.atoms.keys()], ["layout-atom", "fonts-atom"]);
});

test("the log arrives whole, then as changes to what was received; a change to something else asks for it whole again", async context => {
    const view = await panel(context);
    const { channel } = await receiver(view);
    const ready = () => view.toMain.filter(([name]) => name === "vr-panel-ready").length;
    // Subscribed: the panel asks for everything once.
    view.subscribed();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(ready(), 1);
    // A change before the whole log has come is dropped: the whole log is on its way.
    const x = { id: "x" };
    const early = log({ seq: 3, rows: [x] }, [x, { id: "y" }]);
    channel.onmessage({ MessageLogs: early.message });
    assert.deepEqual([view.atoms.has("logs-atom"), ready()], [false, 1]);
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const whole = log(null, [a, b]);
    channel.onmessage({ MessageLogs: whole.message });
    assert.deepEqual(view.atoms.get("logs-atom"), { state: "ok", data: [a, b] });
    const change = log(whole.sent, [b, c]);
    assert.notEqual(Reflect.get(Object(change.message)[Object.keys(change.message)[0]], "base"), null);
    channel.onmessage({ MessageLogs: change.message });
    assert.deepEqual(view.atoms.get("logs-atom"), { state: "ok", data: [b, c] });
    // A change to a log this window did not receive: nothing is written, and the whole log is asked for once.
    const stray = log({ seq: 99, rows: [c] }, [c, a]);
    channel.onmessage({ MessageLogs: stray.message, SelectableFontFamilyList: wire.encodeOrdered({ state: "ok", data: {} }) });
    channel.onmessage({ MessageLogs: stray.message });
    await Promise.resolve();
    assert.deepEqual([view.atoms.get("logs-atom"), ready()], [{ state: "ok", data: [b, c] }, 2]);
    assert.deepEqual(view.atoms.get("fonts-atom"), { state: "ok", data: {} }, "the other names in that message are still written");
    // The whole log comes again; then a stray change asks again.
    const again = log(null, [a], true);
    channel.onmessage({ MessageLogs: again.message });
    assert.deepEqual(view.atoms.get("logs-atom"), { state: "ok", data: [a] });
    channel.onmessage({ MessageLogs: stray.message });
    await Promise.resolve();
    assert.equal(ready(), 3);
});

test("an older layout never replaces a newer one", async context => {
    const view = await panel(context);
    const { channel } = await receiver(view);
    const layout = (data: unknown) => ({ VrPanelLayout: wire.encodeOrdered({ state: "ok", data }) });
    const kept = view.atoms.get("layout-atom");
    channel.onmessage(layout({ tooltip_epoch: 4, atlas: [2, 2] }));
    assert.equal(view.atoms.get("layout-atom"), kept);
    // Values with no layout in them read as the oldest.
    for (const value of [null, "x", { state: "ok" }]) {
        channel.onmessage({ VrPanelLayout: wire.encodeOrdered(value) });
        assert.equal(view.atoms.get("layout-atom"), kept, JSON.stringify(value));
    }
    channel.onmessage(layout({ tooltip_epoch: 6, atlas: [3, 3] }));
    assert.deepEqual(view.atoms.get("layout-atom"), { state: "ok", data: { tooltip_epoch: 6, atlas: [3, 3] } });
    // The rule is the layout's own: another name is written as it comes.
    channel.onmessage({ SelectableFontFamilyList: wire.encodeOrdered({ state: "ok", data: { tooltip_epoch: 1 } }) });
    assert.deepEqual(view.atoms.get("fonts-atom"), { state: "ok", data: { tooltip_epoch: 1 } });
});

test("once stopped, the receiver writes nothing and does not ask for the state", async context => {
    const view = await panel(context);
    const { channel, stop } = await receiver(view);
    stop();
    view.subscribed();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(view.toMain.filter(([name]) => name === "vr-panel-ready"), []);
    channel.onmessage({ SelectableFontFamilyList: wire.encodeOrdered({ state: "ok", data: {} }) });
    assert.equal(view.atoms.has("fonts-atom"), false);
});
