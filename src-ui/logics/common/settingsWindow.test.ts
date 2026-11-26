import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import * as settingsWindow from "./settingsWindow.ts";
import { isSettingsWindow, noticesHere, placeOf } from "./settingsWindow.ts";
import { noticesQuiet, withNotices } from "./noticeScope.ts";
import { createAttachedBackendCommand } from "./backendCommand.ts";
import { hooks, loadModule, unchecked } from "../test/hookHarness.ts";
import { flush } from "../test/bridgeHarness.ts";
import { loadRecordedRoutes } from "../test/routeRecorder.ts";

// The settings window (#1236): the settings in a window of their own, beside the main window.

// This page as the settings window's: its location is settings.html.
const asSettingsWindow = (context: TestContext) => {
    Reflect.set(globalThis, "location", { pathname: "/settings.html" });
    context.onTestFinished(() => { Reflect.deleteProperty(globalThis, "location"); });
};

test("the settings window is the page settings.html, and a place is a page and a setting", () => {
    assert.equal(isSettingsWindow({ pathname: "/settings.html" }), true);
    assert.equal(isSettingsWindow({ pathname: "/index.html" }), false);
    assert.equal(isSettingsWindow({ pathname: "/settings.html.bak" }), false);
    // Outside a page (the tests, a worker): not the settings window.
    assert.equal(isSettingsWindow(undefined), false);
    // Outside the app the settings stay a page of the main window.
    assert.equal(settingsWindow.settingsHaveAWindow(), false);
    assert.deepEqual(placeOf({ page: "vr", target: "vr_overlay" }), { page: "vr", target: "vr_overlay" });
    assert.deepEqual(placeOf({ page: "", target: "  " }), {});
    for (const value of [null, undefined, "vr", 3, { page: 1, target: {} }]) assert.deepEqual(placeOf(value), {}, JSON.stringify(value));
});

test("each window shows the notices of the lines that answer it, and the main window those of the core's own", () => {
    // The main window: its own requests and the core's notices (no origin), not the settings window's.
    assert.equal(noticesHere(undefined, false), true);
    assert.equal(noticesHere("vr_panel", false), true);
    assert.equal(noticesHere("settings", false), false);
    // The settings window: only the answers to its own requests.
    assert.equal(noticesHere("settings", true), true);
    assert.equal(noticesHere(undefined, true), false);
    assert.equal(noticesHere("vr_panel", true), false);
    // A line left to the other window is quiet while it is read, and only then, even when it throws.
    assert.equal(noticesQuiet(), false);
    assert.equal(withNotices(false, () => noticesQuiet()), true);
    assert.equal(withNotices(true, () => withNotices(false, () => noticesQuiet())), true);
    assert.throws(() => withNotices(false, () => { throw new Error("read"); }), /read/);
    assert.equal(noticesQuiet(), false);
});

test("a notice asked for while a line of the other window's is read is not shown", async () => {
    const shown: unknown[] = [];
    const { useNotificationStatus } = await loadModule<typeof import("./useNotificationStatus.ts")>(new URL("./useNotificationStatus.ts", import.meta.url), hooks(), {
        "@store": { useStore_NotificationStatus: () => ({ updateNotificationStatus: (value: { message: unknown }) => shown.push(value.message) }) },
        "react-toastify": { toast: { dismiss() {} } },
    });
    const notices = useNotificationStatus();
    withNotices(false, () => notices.showNotification_Error("theirs"));
    withNotices(true, () => notices.showNotification_Warning("mine"));
    notices.showNotification_Success("outside a line");
    assert.deepEqual(shown, ["mine", "outside a line"]);
});

class FakeChannel<T> {
    onmessage: (message: T) => void = () => {};
}

test("the settings window joins the main window's run, asking again while it is not there yet", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [], sleeps: number[] = [];
    let answers: unknown[] = ["backend_not_running", "backend_not_running", "session-1"];
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
        calls.push([command, args]);
        if (command !== "backend_attach") return unchecked<T>(null);
        const answer = answers.shift();
        if (answer !== "session-1") throw answer;
        return unchecked<T>(answer);
    };
    const command = createAttachedBackendCommand({ invoke, Channel: FakeChannel, sleep: async ms => { sleeps.push(ms); } });
    const lines: string[] = [], closes: unknown[] = [];
    command.stdout.on("data", line => lines.push(line));
    command.on("close", exit => closes.push(exit));
    const child = await command.spawn();
    assert.deepEqual(calls.map(([name]) => name), ["backend_attach", "backend_attach", "backend_attach"]);
    assert.deepEqual(sleeps, [250, 250]);
    // It reads every line of the run, and hears its end.
    const { lines: channel, exit } = unchecked<{ lines: FakeChannel<string>; exit: FakeChannel<number | null> }>(calls[2][1]);
    channel.onmessage('{"status":200}');
    exit.onmessage(0);
    assert.deepEqual(lines, ['{"status":200}']);
    assert.deepEqual(closes, [{ code: 0, signal: null }]);
    // It writes to the run it joined, and stopping it leaves the run to the main window.
    await child.write('{"endpoint":"/run/settings_snapshot"}\n');
    await child.kill();
    assert.deepEqual(calls.slice(3), [["backend_write", { session: "session-1", line: '{"endpoint":"/run/settings_snapshot"}' }]]);

    // A run that does not come gives up at last; any other refusal at once.
    answers = Array(3).fill("backend_not_running");
    await assert.rejects(createAttachedBackendCommand({ invoke, Channel: FakeChannel, sleep: async () => {}, attempts: 3 }).spawn(),
        error => error === "backend_not_running");
    answers = ["backend_forbidden"];
    calls.length = 0;
    await assert.rejects(createAttachedBackendCommand({ invoke, Channel: FakeChannel, sleep: async () => {} }).spawn(),
        error => error === "backend_forbidden");
    assert.equal(calls.length, 1);
});

// useOpenSettings with the window's helpers given: the app's main window (window), the settings
// window itself (settings) or a page in a browser (page).
const loadOpener = async (where: "window" | "settings" | "page") => {
    const calls: unknown[][] = [];
    // Run once, as a component would on its render: the hook's name is not used for the call.
    const { useOpenSettings: opener } = await loadModule<typeof import("./useOpenSettings.ts")>(new URL("./useOpenSettings.ts", import.meta.url), hooks(), {
        "./settingsWindow.ts": { ...settingsWindow,
            settingsHaveAWindow: () => where !== "page",
            isSettingsWindow: () => where === "settings",
            openSettingsWindow: async (place: unknown, focus: unknown) => { calls.push(["window", place, focus]); },
        },
        "./useIsOpenedConfigPage": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: (open: unknown) => calls.push(["page", open]) }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (tab: unknown) => calls.push(["tab", tab]) }) },
        "./showSetting.ts": { showSetting: (target: unknown) => calls.push(["show", target]) },
    });
    return { open: opener(), calls };
};

test("from the main window of the app the settings open in their window, at the page and setting asked for", async () => {
    const app = await loadOpener("window");
    app.open({ page: "transcription", target: "speechcpp_section" });
    app.open();
    app.open({ page: "vr" }, { focus: false });
    await flush();
    assert.deepEqual(app.calls, [
        ["window", { page: "transcription", target: "speechcpp_section" }, true],
        ["window", {}, true],
        // The VR panel's settings leave the focus in VR.
        ["window", { page: "vr" }, false],
    ]);
    // In the settings window, and in a page in a browser, they open in-page as before.
    for (const where of ["settings", "page"] as const) {
        const page = await loadOpener(where);
        page.open({ page: "transcription", target: "speechcpp_section" });
        page.open();
        assert.deepEqual(page.calls, [["tab", "transcription"], ["page", true], ["show", "speechcpp_section"], ["page", true]], where);
    }
});

test("an opening the shell refuses is logged, and nothing else happens", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: unknown[] = [];
    const { useOpenSettings } = await loadModule<typeof import("./useOpenSettings.ts")>(new URL("./useOpenSettings.ts", import.meta.url), hooks(), {
        "./settingsWindow.ts": { ...settingsWindow, settingsHaveAWindow: () => true, isSettingsWindow: () => false,
            openSettingsWindow: async () => { throw "settings_window_invalid"; } },
        "./useIsOpenedConfigPage": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: (open: unknown) => calls.push(open) }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (tab: unknown) => calls.push(tab) }) },
    });
    useOpenSettings()({ page: "Bad Page" });
    await flush();
    assert.deepEqual(calls, []);
    assert.deepEqual(errors.mock.calls, [["The settings window could not open", "settings_window_invalid"]]);
});

test("the main window follows the settings window, and opens Quick Chat it hands over", async context => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>(), stopped: string[] = [], calls: unknown[] = [];
    let open = true;
    const runtime = hooks();
    const { SettingsWindowController } = await loadModule<typeof import("../../views/app/_app_controllers/SettingsWindowController.tsx")>(
        new URL("../../views/app/_app_controllers/SettingsWindowController.tsx", import.meta.url), runtime, {
            "@tauri-apps/api/event": { listen: async (name: string, callback: (event: { payload: unknown }) => void) => {
                listeners.set(name, callback);
                return () => stopped.push(name);
            } },
            "../../../logics/common/settingsWindow.ts": { ...settingsWindow, settingsHaveAWindow: () => true, isSettingsWindowOpen: async () => open },
            "@logics_common": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: (value: unknown) => calls.push(["open", value]) }) },
            "@logics_configs": {
                useHotkeys: () => ({ openQuickChat: async () => { calls.push("quick_chat"); } }),
                useOcrSharedWindow: () => ({ refresh: async () => { calls.push("refresh"); } }),
            },
        });
    runtime.render(SettingsWindowController);
    await flush();
    // A main window loaded again while the settings window is open knows it at once.
    assert.deepEqual(calls, [["open", true]]);
    const changed = listeners.get(settingsWindow.SETTINGS_WINDOW_CHANGED), handed = listeners.get(settingsWindow.SETTINGS_HAND_OVER);
    assert.ok(changed && handed);
    calls.length = 0;
    changed({ payload: false });
    changed({ payload: true });
    // The Hotkeys page's button: the settings close, then Quick Chat opens; nothing else is taken.
    handed({ payload: "open_quick_chat" });
    handed({ payload: "quit" });
    await flush();
    assert.deepEqual(calls, [["open", false], "refresh", ["open", true], ["open", false], "quick_chat"]);
    runtime.unmount();
    assert.deepEqual(stopped.sort(), [settingsWindow.SETTINGS_HAND_OVER, settingsWindow.SETTINGS_WINDOW_CHANGED]);

    // A main window that starts with the settings closed changes nothing.
    open = false;
    // A new list: the checks above narrowed the type of the first.
    const later: unknown[] = [];
    const again = hooks();
    const reloaded = await loadModule<typeof import("../../views/app/_app_controllers/SettingsWindowController.tsx")>(
        new URL("../../views/app/_app_controllers/SettingsWindowController.tsx", import.meta.url), again, {
            "@tauri-apps/api/event": { listen: async () => () => {} },
            "../../../logics/common/settingsWindow.ts": { ...settingsWindow, settingsHaveAWindow: () => true, isSettingsWindowOpen: async () => open },
            "@logics_common": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: (value: unknown) => later.push(["open", value]) }) },
            "@logics_configs": { useHotkeys: () => ({ openQuickChat: async () => {} }), useOcrSharedWindow: () => ({ refresh: async () => {} }) },
        });
    again.render(reloaded.SettingsWindowController);
    await flush();
    assert.deepEqual(later, []);
    context.onTestFinished(() => again.unmount());
});

// The answers of the receive routes, as each window reads them (useReceiveRoutes.ts).
const noticeRecorder = () => {
    const shown: unknown[] = [];
    const notice = (key: unknown) => { if (!noticesQuiet()) shown.push(key); };
    return { shown, hooks: async () => ({ useNotificationStatus: () => ({
        showNotification_Error: notice, showNotification_Warning: notice, showNotification_Success: notice, dismissNotification() {},
    }) }) };
};

test("the main window says what its own requests and the core met, and leaves the settings window's to it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notices = noticeRecorder();
    const r = await loadRecordedRoutes({ hooks: notices.hooks });
    r.receiveRoutes({ endpoint: "/set/data/osc_ip_address", status: 404, result: null, origin: "settings" });
    r.receiveRoutes({ endpoint: "/set/data/osc_ip_address", status: 404, result: null });
    r.receiveRoutes({ endpoint: "/run/config_file_unreadable", status: 200, result: { backup: "config.json.bak" } });
    assert.deepEqual(notices.shown, ["common_error.request_404", 'common_warning.config_file_unreadable {"file":"config.json.bak"}']);
    // The settings window's snapshot is its own: the main window passes over it.
    const before = r.calls.length;
    r.receive("/run/settings_snapshot", 200, { "/get/data/ui_language": "ja" });
    assert.equal(r.calls.length, before);
});

test("the settings window says what its own requests met, and takes its snapshot as the start-up", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const started = await loadRecordedRoutes();
    started.receive("/run/initialization_complete", 200, {});
    asSettingsWindow(context);
    const notices = noticeRecorder();
    const r = await loadRecordedRoutes({ hooks: notices.hooks });
    r.receiveRoutes({ endpoint: "/set/data/osc_ip_address", status: 404, result: null });
    r.receiveRoutes({ endpoint: "/run/config_file_unreadable", status: 200, result: { backup: "config.json.bak" } });
    r.receiveRoutes({ endpoint: "/set/data/osc_ip_address", status: 404, result: null, origin: "settings" });
    assert.deepEqual(notices.shown, ["common_error.request_404"]);
    r.calls.length = 0;
    r.receiveRoutes({ endpoint: "/run/settings_snapshot", status: 200, result: {}, origin: "settings" });
    assert.deepEqual(r.calls, started.calls);
});
