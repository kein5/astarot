import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule, stubGlobals } from "../test/hookHarness.js";

// innerSize reports physical pixels; the 800px breakpoint is in CSS pixels
// (scaled by the UI size), like the stylesheet's (max-width: 800px) queries.
for (const [physical, ratio, scaling, narrow] of [
    [1200, 1.5, 100, true], [1202, 1.5, 100, false],
    [1600, 2, 100, true], [1700, 2, 100, false],
    [800, 1, 100, true], [801, 1, 100, false],
    [1800, 1.5, 150, true], [1801, 1.5, 150, false],
]) test(`a ${physical}px window at devicePixelRatio ${ratio} and UI ${scaling}% is ${narrow ? "narrow" : "wide"}`, async context => {
    const attributes = new Set(), updates = [];
    stubGlobals(context, { devicePixelRatio: ratio, document: { documentElement: {
        hasAttribute: name => attributes.has(name),
        toggleAttribute: (name, on) => { if (on) attributes.add(name); else attributes.delete(name); },
    } } });
    const { useWindow } = await loadModule(new URL("./useWindow.js", import.meta.url), hooks(), {
        "@tauri-apps/api/window": {},
        "@store": { store: { appWindow: { innerSize: async () => ({ width: physical }) } },
            useStore_IsBreakPoint: () => ({ updateIsBreakPoint: value => updates.push(value) }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: scaling } }) },
    });
    await useWindow().asyncUpdateBreakPoint();
    assert.equal(attributes.has("data-narrow"), narrow);
    assert.deepEqual(updates, narrow ? [true] : []);
});

// The window is placed before it is first shown (src-tauri/src/window_placement.rs). The UI
// used to place it once the engine was ready, so it showed centred and then jumped.
test("the window is placed before it shows, and the UI does not move it afterwards", async () => {
    const { readFile } = await import("node:fs/promises");
    const read = path => readFile(new URL(path, import.meta.url), "utf8");
    const config = JSON.parse(await read("../../../src-tauri/tauri.conf.json"));
    assert.equal(config.app.windows[0].visible, false, "the main window is made hidden");
    const lib = await read("../../../src-tauri/src/lib.rs");
    const setup = lib.split(".setup(move |app| {")[1].split("main_window.show()")[0];
    assert.match(setup, /window_placement::apply\(&main_window/);
    const { useWindow } = await loadModule(new URL("./useWindow.js", import.meta.url), hooks(), {
        "@store": { store: { appWindow: {} }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint() {} }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: 100 } }) },
    });
    assert.equal(useWindow().restoreWindowGeometry, undefined);
    const routes = await read("../useReceiveRoutes.js");
    assert.match(routes, /endpoint: "\/get\/data\/main_window_geometry", ns: null, hook_name: null, method_name: null/);
});

const loadClosing = async (runtime, appWindow, sent) => loadModule(new URL("./useWindow.js", import.meta.url), runtime, {
    "@tauri-apps/api/window": {},
    "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: endpoint => sent.push(endpoint) }) },
    "@store": { store: { appWindow }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint() {} }) },
    "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: 100 } }) },
});

test("Alt+F4 and the close button share one shutdown before the window is destroyed", async context => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), sent = [], calls = [];
    let requested = null;
    const appWindow = {
        onCloseRequested: async handler => { requested = handler; return () => calls.push("unlisten"); },
        destroy: async () => calls.push("destroy"),
        close: async () => calls.push("close"),
    };
    const { WindowCloseController, useWindow } = await loadClosing(runtime, appWindow, sent);
    runtime.render(WindowCloseController);
    await Promise.resolve();

    let prevented = false;
    requested({ preventDefault: () => { prevented = true; } }); // Alt+F4
    useWindow().asyncCloseApp(); // and the title bar button while it waits
    assert.equal(prevented, true);
    assert.deepEqual(sent, ["/run/shutdown"]);
    assert.deepEqual(calls, []); // the backend gets its time to save first
    vi.advanceTimersByTime(2000);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ["destroy"]);
    runtime.unmount();
    assert.deepEqual(calls, ["destroy", "unlisten"]);
});

test("a failed destroy removes the listener and closes the window the usual way", async context => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubGlobals(context, { console: { ...console, error() {} } });
    const runtime = hooks(), sent = [], calls = [];
    const appWindow = {
        onCloseRequested: async () => () => calls.push("unlisten"),
        destroy: async () => { throw new Error("not allowed"); },
        close: async () => calls.push("close"),
    };
    const { WindowCloseController, useWindow } = await loadClosing(runtime, appWindow, sent);
    runtime.render(WindowCloseController);
    await Promise.resolve();
    const closed = useWindow().asyncCloseApp();
    vi.advanceTimersByTime(2000);
    await closed;
    assert.deepEqual(calls, ["unlisten", "close"]);
});
