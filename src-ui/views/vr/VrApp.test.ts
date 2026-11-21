import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, stubGlobals, findIn, draw, componentName, componentOf, fieldOf } from "../../logics/test/hookHarness.ts";
import * as wire from "../../logics/common/vrPanelWire.ts";
import { keepNewestVrLayout } from "../../logics/common/vrPanelTooltip.ts";

test("closed log region is inert and unpainted while the receiver keeps its data current", async context => {
    stubGlobals(context, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
    const runtime = hooks(), listeners = new Map<string, (event: unknown) => unknown>(), atoms = new Map<unknown, unknown>();
    class Channel { onmessage: (message: unknown) => void = () => {}; }
    const subscriptions: [string, Channel][] = [], emitted: unknown[][] = [];
    const layout = { atlas: [2000, 1000], regions: { panel: [0, 0, 900, 900] } };
    const VrLogWindow = () => null, VrLauncher = () => null;
    const { VrApp } = await loadModule<typeof import("./VrApp.tsx")>(new URL("./VrApp.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { Channel, invoke: async (name: string, args: { channel: Channel }) => { subscriptions.push([name, args.channel]); } },
        "@tauri-apps/api/event": { emit: (...args: unknown[]) => { emitted.push(args); }, listen: (name: string, handler: (event: unknown) => unknown) => {
            listeners.set(name, handler);
            return Promise.resolve(() => listeners.delete(name));
        } },
        jotai: { getDefaultStore: () => ({ set: (atom: unknown, value: unknown) => atoms.set(atom,
            typeof value === "function" ? value(atoms.get(atom)) : value) }) },
        "@store": { dynamicStoreRegistry: { Atom_MessageLogs: "logs" } },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: false } }) },
        "../app/_app_controllers": { UiLanguageController: () => null, FontFamilyController: () => null },
        "@logics_configs": { useVr: () => ({ currentVrPanelLayout: { data: layout } }) },
        "./VrLauncher": { VrLauncher }, "./VrLogWindow": { VrLogWindow }, "./VrPopupWindow": { VrPopupWindow: () => null },
        "./VrToolbar": { VrToolbar: () => null }, "./VrTooltip": { VrTooltip: () => null }, "./vrPanelHover": {},
        "../../logics/common/vrPanelTooltip": { keepNewestVrLayout }, "../../logics/common/vrPanelWire": wire,
        // #397: the panel sends nothing as an event; it asks Rust to pass it on to the main window.
        "../../logics/common/vrPanelSend.ts": { sendToMain: async (...args: unknown[]) => { emitted.push(args); } },
    });
    const closed = runtime.render(VrApp);
    const log = findIn(closed, node => node.type === VrLogWindow);
    assert.equal(log.props.open, false);
    const region = findIn(closed, node => node.props.name === "panel");
    const element = draw(region);
    assert.equal(element.props.inert, true);
    assert.equal(element.props["aria-hidden"], true);
    assert.equal(element.props.style.visibility, "hidden");
    const receiver = findIn(closed, node => componentName(node) === "VrStateReceiver");
    findIn(closed, node => node.type === VrLauncher).props.openLog();
    const opened = runtime.render(VrApp);
    const openedRegion = findIn(opened, node => node.props.name === "panel");
    assert.equal(draw(openedRegion).props.inert, false);
    assert.equal(findIn(opened, node => node.type === VrLogWindow).props.open, true);
    runtime.unmount();
    // Run the receiver's standalone effect, without rendering any log body.
    // The receiver's effect returns its clean-up, which the test runs when it finishes.
    runtime.api.useEffect = effect => {
        const cleanup = effect();
        assert.ok(typeof cleanup === "function", "the receiver's effect returns its clean-up");
        context.onTestFinished(() => { cleanup(); });
    };
    // The receiver is one of VrApp's function components, run without props as before.
    componentOf(receiver)();
    // SEC-03: the state arrives on the panel's own channel; the panel asks for it once subscribed.
    assert.equal(listeners.has("vr-panel-state"), false);
    assert.equal(subscriptions.length, 1);
    const [command, channel] = subscriptions[0];
    assert.equal(command, "vr_panel_state_subscribe");
    emitted.length = 0;
    await Promise.resolve();
    assert.deepEqual(emitted.map(([name]) => name), ["vr-panel-ready"]);
    channel.onmessage({ MessageLogs: wire.encodeOrdered({ state: "ok", data: [{ id: "new", status: "pending" }] }) });
    // The receiver writes the decoded log to the log atom.
    assert.equal(fieldOf(atoms.get("logs"), "data", "0", "id"), "new");
});
