import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule, stubGlobals } from "../test/hookHarness.ts";
import type { HookRuntime } from "../test/hookHarness.ts";

type CloseRequest = { preventDefault: () => void };

// innerSize reports physical pixels; the 800px breakpoint is in CSS pixels
// (scaled by the UI size), like the stylesheet's (max-width: 800px) queries.
for (const [physical, ratio, scaling, narrow] of [
    [1200, 1.5, 100, true], [1202, 1.5, 100, false],
    [1600, 2, 100, true], [1700, 2, 100, false],
    [800, 1, 100, true], [801, 1, 100, false],
    [1800, 1.5, 150, true], [1801, 1.5, 150, false],
] satisfies [number, number, number, boolean][]) test(`a ${physical}px window at devicePixelRatio ${ratio} and UI ${scaling}% is ${narrow ? "narrow" : "wide"}`, async context => {
    const attributes = new Set<string>(), updates: unknown[] = [];
    stubGlobals(context, { devicePixelRatio: ratio, document: { documentElement: {
        hasAttribute: (name: string) => attributes.has(name),
        toggleAttribute: (name: string, on: boolean) => { if (on) attributes.add(name); else attributes.delete(name); },
    } } });
    const { useWindow } = await loadModule<typeof import("./useWindow.ts")>(new URL("./useWindow.ts", import.meta.url), hooks(), {
        "@tauri-apps/api/window": {},
        "@store": { store: { appWindow: { innerSize: async () => ({ width: physical }) } },
            useStore_IsBreakPoint: () => ({ updateIsBreakPoint: (value: unknown) => updates.push(value) }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: scaling } }) },
    });
    await useWindow().asyncUpdateBreakPoint();
    assert.equal(attributes.has("data-narrow"), narrow);
    assert.deepEqual(updates, narrow ? [true] : []);
});

// #1200: the narrow layout arrives after an await. Drawn as an ordinary update, a flushSync in a
// ResizeObserver callback (virtua's, where it measures the log) drew it, the rail turned to icons and
// resized the log inside that callback, and WebKit reported a ResizeObserver loop. As a transition it waits.
test("the narrow layout is drawn as a transition, so a flushSync elsewhere does not draw it", async context => {
    const attributes = new Set<string>(), updates: unknown[] = [];
    let inTransition = false;
    stubGlobals(context, { devicePixelRatio: 1, document: { documentElement: {
        hasAttribute: (name: string) => attributes.has(name),
        toggleAttribute: (name: string, on: boolean) => { if (on) attributes.add(name); else attributes.delete(name); },
    } } });
    const runtime = hooks();
    const { useWindow } = await loadModule<typeof import("./useWindow.ts")>(new URL("./useWindow.ts", import.meta.url), runtime, {
        react: { ...runtime.api, startTransition: (update: () => void) => { inTransition = true; update(); inTransition = false; } },
        "@tauri-apps/api/window": {},
        "@store": { store: { appWindow: { innerSize: async () => ({ width: 700 }) } },
            useStore_IsBreakPoint: () => ({ updateIsBreakPoint: (value: unknown) => updates.push([value, inTransition]) }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: 100 } }) },
    });
    await useWindow().asyncUpdateBreakPoint();
    assert.deepEqual(updates, [[true, true]]);
    // Still narrow: the page already has the narrow layout, and nothing is drawn again.
    await useWindow().asyncUpdateBreakPoint();
    assert.deepEqual(updates, [[true, true]]);
});

const narrowRoot = (attributes: Set<string>) => ({ documentElement: {
    hasAttribute: (name: string) => attributes.has(name),
    toggleAttribute: (name: string, on: boolean) => { if (on) attributes.add(name); else attributes.delete(name); },
} });

// The saved UI size arrives with the render that mounts the settings page. Decided only after the
// window answered (about 0.3 s later), the narrow layout came at that page's first layout, and
// WebKitGTK sometimes stopped laying the page out: the settings menu stayed outside the window. The
// width measured before decides at once; the window's answer still has the last word.
test("a new UI size takes the narrow layout at once from the width last measured, then the window's answer decides", async context => {
    const attributes = new Set<string>(), updates: unknown[] = [];
    stubGlobals(context, { devicePixelRatio: 1.5, document: narrowRoot(attributes) });
    const answers: ((size: { width: number }) => void)[] = [];
    const appearance = { currentUiScaling: { data: 100 } };
    const { useWindow } = await loadModule<typeof import("./useWindow.ts")>(new URL("./useWindow.ts", import.meta.url), hooks(), {
        "@tauri-apps/api/window": {},
        "@store": { store: { appWindow: { innerSize: () => new Promise(resolve => answers.push(resolve)) } },
            useStore_IsBreakPoint: () => ({ updateIsBreakPoint: (value: unknown) => updates.push(value) }) },
        "@logics_configs": { useAppearance: () => appearance },
    });
    // Nothing measured yet: the layout waits for the window's size.
    const first = useWindow().asyncUpdateBreakPoint();
    answers[0]({ width: 1305 }); // 870 CSS pixels
    await first;
    assert.equal(attributes.has("data-narrow"), false, "870px at UI 100% is wide");
    appearance.currentUiScaling = { data: 150 };
    const second = useWindow().asyncUpdateBreakPoint();
    assert.equal(attributes.has("data-narrow"), true, "870px at UI 150% is narrow before the window answers");
    assert.deepEqual(updates, [true]);
    answers[1]({ width: 1305 });
    await second;
    assert.deepEqual(updates, [true], "the same answer changes nothing");
    // The window made wider meanwhile: its answer decides.
    const third = useWindow().asyncUpdateBreakPoint();
    assert.equal(attributes.has("data-narrow"), true);
    answers[2]({ width: 1950 }); // 1300 CSS pixels
    await third;
    assert.equal(attributes.has("data-narrow"), false);
    assert.deepEqual(updates, [true, false]);
});

// As the UI size itself (UiSizeController), the layout it brings is decided before the browser
// paints: in the render's layout effects, not after it.
test("the controller decides the narrow layout for a new UI size before the browser paints", async context => {
    const attributes = new Set<string>(), updates: unknown[] = [];
    stubGlobals(context, { devicePixelRatio: 1, document: narrowRoot(attributes) });
    const runtime = hooks(), appearance = { currentUiScaling: { data: 100 } };
    let answer: (size: { width: number }) => void = () => {};
    const appWindow = { innerSize: () => new Promise<{ width: number }>(resolve => { answer = resolve; }) };
    const { WindowGeometryController } = await loadModule<typeof import("./useWindow.ts")>(new URL("./useWindow.ts", import.meta.url), runtime, {
        // Only what runs before the browser paints: the passive effects (useEffect) never run here.
        react: { ...runtime.api, useEffect: () => {}, startTransition: (update: () => void) => update() },
        "@tauri-apps/api/window": {},
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython() {} }) },
        "@store": { store: { appWindow }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint: (value: unknown) => updates.push(value) }) },
        "@logics_configs": { useAppearance: () => appearance },
    });
    runtime.render(WindowGeometryController);
    answer({ width: 870 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attributes.has("data-narrow"), false);
    appearance.currentUiScaling = { data: 150 };
    runtime.render(WindowGeometryController);
    assert.equal(attributes.has("data-narrow"), true);
    assert.deepEqual(updates, [true]);
});

// The window is placed before it is first shown (src-tauri/src/window_placement.rs). The UI
// used to place it once the engine was ready, so it showed centred and then jumped.
test("the window is placed before it shows, and the UI does not move it afterwards", async () => {
    const { readFile } = await import("node:fs/promises");
    const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
    const config = JSON.parse(await read("../../../src-tauri/tauri.conf.json"));
    assert.equal(config.app.windows[0].visible, false, "the main window is made hidden");
    const lib = await read("../../../src-tauri/src/lib.rs");
    const setup = lib.split(".setup(move |app| {")[1].split("main_window.show()")[0];
    assert.match(setup, /window_placement::apply\(&main_window/);
    const { useWindow } = await loadModule<typeof import("./useWindow.ts")>(new URL("./useWindow.ts", import.meta.url), hooks(), {
        "@store": { store: { appWindow: {} }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint() {} }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: 100 } }) },
    });
    // A function the hook no longer has: read by name.
    assert.equal(Reflect.get(useWindow(), "restoreWindowGeometry"), undefined);
    const routes = await read("../useReceiveRoutes.ts");
    assert.match(routes, /endpoint: "\/get\/data\/main_window_geometry", ns: null, hook_name: null, method_name: null/);
});

const loadClosing = async (runtime: HookRuntime, appWindow: object, sent: unknown[]) =>
    loadModule<typeof import("./useWindow.ts")>(new URL("./useWindow.ts", import.meta.url), runtime, {
    "@tauri-apps/api/window": {},
    "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (endpoint: string) => sent.push(endpoint) }) },
    "@store": { store: { appWindow }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint() {} }) },
    "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: 100 } }) },
});

test("Alt+F4 and the close button share one shutdown before the window is destroyed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), sent: unknown[] = [], calls: string[] = [];
    // Called before the controller has listened, it stops with a TypeError, as calling null did.
    let requested: (event: CloseRequest) => void = () => { throw new TypeError("requested is not a function"); };
    const appWindow = {
        onCloseRequested: async (handler: (event: CloseRequest) => void) => { requested = handler; return () => calls.push("unlisten"); },
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
    const runtime = hooks(), sent: unknown[] = [], calls: string[] = [];
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

// #1236: the settings window saves its own place, and its close button closes only it: no
// shutdown, no tray.
test("the settings window saves its own place and closes alone", async context => {
    Reflect.set(globalThis, "location", { pathname: "/settings.html" });
    context.onTestFinished(() => { Reflect.deleteProperty(globalThis, "location"); });
    const runtime = hooks(), sent: unknown[] = [], calls: string[] = [];
    const appWindow = {
        isMinimized: async () => false,
        outerPosition: async () => ({ x: 40, y: 50 }),
        outerSize: async () => ({ width: 800, height: 600 }),
        destroy: async () => { calls.push("destroy"); },
        close: async () => { calls.push("close"); },
    };
    const { useWindow } = await loadModule<typeof import("./useWindow.ts")>(new URL("./useWindow.ts", import.meta.url), runtime, {
        "@tauri-apps/api/window": {},
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (...args: unknown[]) => sent.push(args) }) },
        "@store": { store: { appWindow, companion_hide: async () => { calls.push("tray"); } }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint() {} }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: 100 } }) },
    });
    const window = runtime.render(useWindow);
    await window.asyncSaveWindowGeometry();
    await window.asyncCloseApp();
    assert.deepEqual(sent, [["/set/data/settings_window_geometry", { x_pos: 40, y_pos: 50, width: 800, height: 600 }]]);
    assert.deepEqual(calls, ["destroy"]);
});
