import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test, vi } from "vitest";
import { createSidecarSessionOwner } from "./sidecarSession.ts";
import * as startupPhase from "./startupPhase.ts";
import { expectBackendExit } from "./sidecarExitExpectation.ts";
import { hooks, loadModule, find } from "../test/hookHarness.js";
import { deferred, flush, loadBridgeStore, loadBridgeRoutes } from "../test/bridgeHarness.js";
import * as utils from "../utils.ts";

test("only the main window can start, feed or retire the backend", async () => {
    const directory = new URL("../../../src-tauri/capabilities/", import.meta.url);
    const capabilities = await Promise.all((await readdir(directory)).filter(name => name.endsWith(".json"))
        .map(async name => JSON.parse(await readFile(new URL(name, directory), "utf8"))));
    // No window may start or stop a program; the backend runs inside the app (#285).
    const shell = capabilities.flatMap(capability => capability.permissions).filter(permission =>
        (typeof permission === "string" ? permission : permission.identifier).startsWith("shell:"));
    assert.deepEqual(shell, []);
    // The app's own commands refuse every window but main.
    const host = await readFile(new URL("../../../src-tauri/src/backend_host.rs", import.meta.url), "utf8");
    for (const command of ["backend_start", "backend_write", "backend_kill"]) {
        // backend_start is async: it waits for a failed run off the main thread.
        const body = host.split(new RegExp(`pub (?:async )?fn ${command}\\(`))[1].split("\n}\n")[0];
        assert.match(body, /main_only\(&window\)\?/, command);
    }
});

const setup = () => {
    const store = {}, attempts = [], timers = new Map(), states = [], messages = [], crashes = [];
    let timerId = 0, stops = 0, feeds = 0;
    const createCommand = () => {
        const spawn = deferred(), events = {}, stdout = {}, stderr = {};
        const child = { kills: 0, kill: async () => { child.kills++; } };
        const command = { on: (name, fn) => { events[name] = fn; },
            stdout: { on: (name, fn) => { stdout[name] = fn; } },
            stderr: { on: (name, fn) => { stderr[name] = fn; } }, spawn: () => spawn.promise };
        attempts.push({ command, spawn, child, events, stdout, stderr });
        return command;
    };
    const timerTools = {
        setInterval: (fn, delay) => { assert.equal(delay, 20000); timers.set(++timerId, fn); return timerId; },
        clearInterval: id => timers.delete(id),
    };
    const owner = createSidecarSessionOwner({ store, createCommand, ...timerTools });
    const handlers = { setStartupState: phase => states.push(phase), beginStartup: () => {}, started: () => {},
        receiveRoutes: value => messages.push(value), backendStopped: () => { stops++; },
        unexpectedExit: event => crashes.push(event), stderr: line => messages.push(line), feedWatchdog: () => { feeds++; } };
    return { store, attempts, timers, states, messages, crashes, owner, handlers, createCommand, timerTools,
        mount: () => owner.attach(() => handlers), get stops() { return stops; }, get feeds() { return feeds; }, get installations() { return timerId; } };
};

test("two mounts share a pending/live session; detach and StrictMode replay keep one watchdog", async () => {
    const s = setup(), detachA = s.mount(), detachB = s.mount();
    await flush();
    assert.equal(s.attempts.length, 1);
    s.attempts[0].spawn.resolve(s.attempts[0].child);
    await s.store.backend_session.completion;
    assert.equal(s.timers.size, 1);
    detachA();
    assert.equal(s.timers.size, 1);
    detachB();
    assert.equal(s.timers.size, 0);
    const detachReplay = s.mount();
    assert.equal(s.attempts.length, 1);
    assert.equal(s.timers.size, 1);
    s.timers.values().next().value();
    assert.equal(s.feeds, 1);
    detachReplay();
});

test("unmount before spawn resolves installs no late watchdog; remount resumes feeding", async () => {
    const s = setup(), detach = s.mount();
    await flush();
    detach();
    s.attempts[0].spawn.resolve(s.attempts[0].child);
    await s.store.backend_session.completion;
    assert.equal(s.installations, 0);
    const detachAgain = s.mount();
    assert.equal(s.timers.size, 1);
    assert.equal(s.attempts.length, 1);
    detachAgain();
});

test("failed spawn has no automatic retry; repeated retry clicks start one new attempt", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), detach = s.mount();
    await flush();
    s.attempts[0].spawn.reject(Error("missing executable"));
    await s.store.backend_session.completion;
    assert.equal(s.states.at(-1), "failed");
    assert.equal(s.store.backend_stopped, true);
    assert.equal(s.store.backend_subprocess, null);
    assert.equal(s.installations, 0);
    detach();
    const detachAgain = s.mount();
    assert.equal(s.states.at(-1), "failed");
    assert.equal(s.attempts.length, 1);
    const retry = s.owner.retry();
    assert.equal(s.states.at(-1), "starting");
    assert.equal(await s.owner.retry(), false);
    await flush();
    assert.equal(s.attempts.length, 2);
    s.attempts[1].spawn.resolve(s.attempts[1].child);
    await retry;
    assert.equal(s.store.backend_subprocess, s.attempts[1].child);
    assert.equal(s.timers.size, 1);
    detachAgain();
});

test("command error retires a late child before retry; stale events cannot affect the replacement", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), detach = s.mount();
    await flush();
    const a = s.attempts[0], kill = deferred();
    a.child.kill = () => { a.child.kills++; return kill.promise; };
    a.events.error("failed pipe");
    assert.equal(s.states.at(-1), "failed");
    const retry = s.owner.retry();
    a.spawn.resolve(a.child);
    await flush();
    assert.equal(s.attempts.length, 1);
    assert.equal(a.child.kills, 1);
    kill.resolve();
    await flush();
    assert.equal(s.attempts.length, 2);
    const b = s.attempts[1];
    b.spawn.resolve(b.child);
    await retry;
    const installations = s.installations, stops = s.stops;
    a.events.close({ code: 1 });
    a.events.error("late error");
    a.stdout.data('{"endpoint":"old"}');
    a.stderr.data("late stderr");
    assert.equal(s.store.backend_subprocess, b.child);
    assert.equal(s.store.backend_stopped, false);
    assert.equal(s.stops, stops);
    assert.equal(s.installations, installations);
    assert.equal(s.timers.size, 1);
    assert.deepEqual(s.messages, []);
    b.stdout.data('{"endpoint":"new"}');
    assert.deepEqual(s.messages, [{ endpoint: "new" }]);
    detach();
});

test("failed cleanup prevents replacement until the child can be retired", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), detach = s.mount();
    await flush();
    const a = s.attempts[0];
    a.child.kill = async () => { throw Error("kill failed"); };
    a.events.error("spawn failed");
    a.spawn.resolve(a.child);
    await s.store.backend_session.completion;
    assert.equal(await s.owner.retry(), false);
    assert.equal(s.attempts.length, 1);
    assert.equal(s.states.at(-1), "failed");
    a.events.close({ code: 1 });
    const retry = s.owner.retry();
    await flush();
    s.attempts[1].spawn.resolve(s.attempts[1].child);
    await retry;
    detach();
});

test("a command error while running is logged and keeps the live sidecar", async context => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), detach = s.mount();
    await flush();
    const a = s.attempts[0];
    a.spawn.resolve(a.child);
    await s.store.backend_session.completion;
    a.events.error("stderr read failed");
    assert.equal(s.store.backend_subprocess, a.child);
    assert.equal(s.store.backend_stopped, false);
    assert.equal(a.child.kills, 0);
    assert.equal(s.states.at(-1), "running");
    assert.equal(logged.mock.calls.length, 1);
    a.stdout.data('{"endpoint":"still-live"}');
    assert.deepEqual(s.messages, [{ endpoint: "still-live" }]);
    detach();
});

test("expected exits release pending state without a crash notice and do not survive sessions", async () => {
    const s = setup(), detach = s.mount();
    await flush();
    s.attempts[0].spawn.resolve(s.attempts[0].child);
    await s.store.backend_session.completion;
    expectBackendExit(s.store.backend_session, "/run/update_cuda_software");
    s.attempts[0].events.close({ code: 0 });
    assert.equal(s.stops, 1);
    assert.deepEqual(s.crashes, []);
    assert.equal(s.store.backend_session.expectedExits.size, 0);
    assert.equal(s.timers.size, 0);
    detach();
});

test("exit after spawn but before initialization fails startup and permits only an explicit retry", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), detach = s.mount();
    await flush();
    const first = s.attempts[0];
    first.spawn.resolve(first.child);
    await s.store.backend_session.completion;
    assert.equal(s.states.at(-1), "running");
    first.stdout.data(JSON.stringify({ endpoint: "/run/initialization_complete", status: 500 }));
    first.events.close({ code: 1 });
    assert.equal(s.states.at(-1), "failed");
    assert.equal(s.stops, 1);
    assert.equal(s.timers.size, 0);
    await flush();
    assert.equal(s.attempts.length, 1);
    const retry = s.owner.retry();
    await flush();
    assert.equal(s.attempts.length, 2);
    const second = s.attempts[1];
    second.spawn.resolve(second.child);
    await retry;
    first.stdout.data(JSON.stringify({ endpoint: "/run/initialization_complete", status: 200, result: {} }));
    second.events.close({ code: 1 });
    assert.equal(s.states.at(-1), "failed", "old initialization cannot mark the replacement ready");
    detach();
});

for (const beforeSpawn of [false, true]) test(`acknowledged initialization (${beforeSpawn ? "before" : "after"} spawn resolves) makes later exit stopped`, async () => {
    const s = setup(), detach = s.mount();
    await flush();
    const first = s.attempts[0];
    const acknowledge = () => first.stdout.data(JSON.stringify({ endpoint: "/run/initialization_complete", status: 200, result: {} }));
    if (beforeSpawn) acknowledge();
    first.spawn.resolve(first.child);
    await s.store.backend_session.completion;
    if (!beforeSpawn) acknowledge();
    first.events.close({ code: 1 });
    assert.equal(s.states.at(-1), "stopped");
    assert.equal(s.crashes.length, 1);
    assert.equal(s.store.backend_subprocess, null);
    assert.equal(await s.owner.retry(), false);
    assert.equal(s.attempts.length, 1);
    detach();
});

test("lines that overtake spawn() wait for the child, so their replies can send requests", async () => {
    // The core's start-up runs while backend_start is answering: on the AppImage its
    // initialization_complete reached the UI first, and the requests made for it could not
    // be written (backend_unavailable right after the window opened).
    const s = setup(), seen = [];
    s.handlers.receiveRoutes = message => seen.push([message.endpoint, s.store.backend_subprocess]);
    const detach = s.mount();
    await flush();
    const a = s.attempts[0];
    a.stdout.data(JSON.stringify({ endpoint: "/run/initialization_complete", status: 200, result: {} }));
    a.stdout.data(JSON.stringify({ endpoint: "/run/after", status: 200 }));
    assert.deepEqual(seen, []);
    a.spawn.resolve(a.child);
    await s.store.backend_session.completion;
    assert.deepEqual(seen, [["/run/initialization_complete", a.child], ["/run/after", a.child]]);
    assert.equal(s.store.backend_session.early, undefined);
    a.stdout.data(JSON.stringify({ endpoint: "/run/later", status: 200 }));
    assert.deepEqual(seen.at(-1), ["/run/later", a.child]);
    detach();
});

test("lines held before a failed spawn are dropped", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), detach = s.mount();
    await flush();
    const a = s.attempts[0];
    a.stdout.data(JSON.stringify({ endpoint: "/run/initialization_complete", status: 200, result: {} }));
    a.events.error("spawn failed");
    a.spawn.resolve(a.child);
    await s.store.backend_session.completion;
    assert.deepEqual(s.messages, []);
    assert.equal(a.child.kills, 1);
    detach();
});

test("production controller publishes startup failure and the failure dialog says why and offers a working retry", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), b = await loadBridgeStore();
    vi.spyOn(globalThis, "setInterval").mockImplementation(s.timerTools.setInterval);
    vi.spyOn(globalThis, "clearInterval").mockImplementation(s.timerTools.clearInterval);
    const common = { useNotificationStatus: () => ({ showNotification_Error: () => {} }),
        useIsBackendReady: b.stores.useStore_IsBackendReady, useWindow: () => ({ asyncCloseApp: () => {} }) };
    const module = await loadModule(new URL("../../views/app/_app_controllers/StartPythonController.jsx", import.meta.url), b.runtime, {
        "@tauri-apps/api/core": { invoke: async () => [] },
        "@store": b.stores, "@utils": utils, "@logics_common": common,
        "@useReceiveRoutes": { useReceiveRoutes: () => ({ receiveRoutes: () => {}, backendStopped: () => {} }) },
        "../../../logics/common/sidecarSession.ts": { createSidecarSessionOwner },
        "../../../logics/common/backendCommand.ts": { createCoreBackendCommand: () => s.createCommand() },
        "../../../logics/common/startupPhase.ts": startupPhase,
    });
    b.runtime.render(module.StartPythonController);
    await flush();
    s.attempts[0].spawn.reject(Error("not found"));
    await b.stores.store.backend_session.completion;
    assert.equal(b.runtime.store.get(b.stores.Atom_BackendStartupState).data, "failed");
    assert.equal(b.runtime.store.get(b.stores.Atom_IsBackendReady).data, false);
    // The failure dialog says why: here the program never started.
    assert.deepEqual(b.runtime.store.get(b.stores.Atom_BackendStartupFailure).data, { kind: "spawn", message: "not found" });
    const startup = await loadModule(new URL("./useBackendStartup.ts", import.meta.url), b.runtime, { "@store": b.stores, "./startupPhase.ts": startupPhase });
    const screen = await loadModule(new URL("../../views/app/others/startup/StartupFailedDialog.tsx", import.meta.url), b.runtime, {
        "@logics_common": common,
        "../../../../logics/common/useBackendStartup": startup,
    });
    const tree = screen.StartupFailedDialog();
    assert.equal(tree.type, "dialog");
    assert.equal(tree.props.role, "alertdialog");
    assert.equal(tree.props.open, true, "not modal: the title bar stays usable");
    assert.ok(find(tree, node => node.props.children === "common_error.backend_startup_reason_spawn"));
    assert.ok(find(tree, node => node.props.children === "common_error.backend_startup_detail"));
    assert.ok(find(tree, node => node.props.children === "common_error.backend_startup_next"));
    const button = find(tree, node => node.type === "button");
    assert.equal(button.props.children, "common_error.backend_startup_retry");
    assert.equal(button.props.autoFocus, true);
    const retry = button.props.onClick();
    button.props.onClick();
    await flush();
    assert.equal(s.attempts.length, 2);
    assert.equal(b.runtime.store.get(b.stores.Atom_BackendStartupState).data, "starting");
    s.attempts[1].spawn.resolve(s.attempts[1].child);
    await retry;
    b.runtime.unmount();
    assert.equal(s.timers.size, 0);
});

for (const initialized of [false, true]) test(`production exit ${initialized ? "after" : "before"} initialization clears readiness and keeps the main page, locked only before`, async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup(), b = await loadBridgeRoutes();
    vi.spyOn(globalThis, "setInterval").mockImplementation(s.timerTools.setInterval);
    vi.spyOn(globalThis, "clearInterval").mockImplementation(s.timerTools.clearInterval);
    const common = { useNotificationStatus: () => ({ showNotification_Error() {} }),
        useIsBackendReady: b.stores.useStore_IsBackendReady,
        useIsSoftwareUpdating: b.stores.useStore_IsSoftwareUpdating,
        useIsOpenedConfigPage: b.stores.useStore_IsOpenedConfigPage };
    const controller = await loadModule(new URL("../../views/app/_app_controllers/StartPythonController.jsx", import.meta.url), b.runtime, {
        "@tauri-apps/api/core": { invoke: async () => [] },
        "@store": b.stores, "@utils": utils, "@logics_common": common,
        "@useReceiveRoutes": { useReceiveRoutes: () => b },
        "../../../logics/common/sidecarSession.ts": { createSidecarSessionOwner },
        "../../../logics/common/backendCommand.ts": { createCoreBackendCommand: () => s.createCommand() },
        "../../../logics/common/startupPhase.ts": startupPhase,
    });
    b.runtime.render(controller.StartPythonController);
    await flush();
    const attempt = s.attempts[0];
    attempt.spawn.resolve(attempt.child);
    await b.stores.store.backend_session.completion;
    if (initialized) attempt.stdout.data(JSON.stringify({ endpoint: "/run/initialization_complete", status: 200, result: {} }));
    assert.equal(b.runtime.store.get(b.stores.Atom_IsBackendReady).data, initialized);

    const shortcuts = [], quickCalls = [], sent = [], hotRuntime = hooks(), quickRuntime = hooks();
    let receive, request;
    const hot = await loadModule(new URL("../../views/app/_app_controllers/GlobalHotKeyController.jsx", import.meta.url), hotRuntime, {
        "@logics_common": common, "@logics_configs": { useHotkeys: () => ({ currentHotkeys: { data: {} },
            registerShortcuts: () => shortcuts.push("register"), unregisterAll: () => shortcuts.push("unregister") }) },
    });
    const quick = await loadModule(new URL("../../views/app/_app_controllers/QuickChatController.jsx", import.meta.url), quickRuntime, {
        "@logics_common": common,
        "@useI18n": { useI18n: () => ({ i18n: { language: "en" } }) },
        "../../../logics/common/useMessage": { useMessage: () => ({ sendMessage: text => { sent.push(text); return true; } }) },
        "@logics_configs": { useAppearance: () => ({ currentSendMessageButtonType: { data: "enter" }, currentUiScaling: { data: 100 },
            currentSelectedFontFamily: { data: "" } }), useOthers: () => ({ currentEnableAutoClearMessageInputBox: { data: true } }) },
        "@tauri-apps/api/event": { listen: async (_, handler) => { receive = handler; return () => {}; } },
        "@tauri-apps/api/core": { invoke: async (name, args) => { quickCalls.push([name, args]); return name === "quick_chat_take" ? request : undefined; } },
    });
    hotRuntime.render(hot.GlobalHotKeyController);
    quickRuntime.render(quick.QuickChatController);
    await flush();
    attempt.events.close({ code: 1 });
    assert.equal(b.runtime.store.get(b.stores.Atom_IsBackendReady).data, false);
    assert.equal(b.runtime.store.get(b.stores.Atom_BackendStartupState).data, initialized ? "stopped" : "failed");
    assert.deepEqual(b.runtime.store.get(b.stores.Atom_BackendStartupFailure).data, initialized ? null : { kind: "exit", code: 1 });
    hotRuntime.render(hot.GlobalHotKeyController);
    quickRuntime.render(quick.QuickChatController);
    await flush();
    assert.equal(shortcuts.at(-1), "unregister");
    assert.equal(quickCalls.filter(([name]) => name === "quick_chat_configure").at(-1)[1].context.ready, false);
    request = { id: "after-exit", message: "must not send" };
    await receive();
    assert.deepEqual(sent, []);
    assert.deepEqual(quickCalls.at(-1), ["quick_chat_finish", { id: "after-exit", accepted: false }]);

    const startup = await loadModule(new URL("./useBackendStartup.ts", import.meta.url), b.runtime, { "@store": b.stores, "./startupPhase.ts": startupPhase });
    const StartupFailedDialog = () => null, StartupAnnouncer = () => null;
    const app = await loadModule(new URL("../../views/app/App.tsx", import.meta.url), b.runtime, {
        "./_app_controllers/TranscriptionConsentController": {}, "./_app_controllers/TranslationSetupController": {}, "./_app_controllers/OcrSetupController": {}, "./_app_controllers": {},
        "./_app_controllers/TelemetryNoticeController": {},
        "./_app_controllers/LocalAsrNoticeController": {},
        "./_app_controllers/VirtualMicGuideController": {},
        "./_app_controllers/FirstRunSetupController": {},
        "./_app_controllers/SwitchBlocksController": {},
        "./_app_controllers/QuickChatController": {}, "./_app_controllers/CaptionOverlayController": {}, "./_app_controllers/CompanionController": {}, "./_app_controllers/IoFlowController": {},
        "./main_page/MainPage": {}, "./config_page/ConfigPage": {},
        "./others": {}, "@logics_common": common,
        "@useI18n": { useI18n: () => ({ i18n: { language: "en" } }) },
        "../../logics/common/useBackendStartup": startup, "../../logics/common/startupPhase": startupPhase,
        "./others/startup/StartupFailedDialog": { StartupFailedDialog }, "./others/startup/StartupAnnouncer": { StartupAnnouncer },
    });
    const tree = app.App();
    // The main page is always there: locked under the failure dialog, live after a later exit.
    const contents = find(tree, node => node.type?.name === "Contents");
    assert.equal(contents.props.locked, !initialized);
    assert.equal(!!find(tree, node => node.type === StartupFailedDialog), !initialized);
    assert.equal(find(tree, node => node.type === StartupAnnouncer), null);
    assert.equal(s.attempts.length, 1);
    hotRuntime.unmount(); quickRuntime.unmount(); b.runtime.unmount();
});
