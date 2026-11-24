import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, vi } from "vitest";
import { hooks, loadModule } from "../../../test/hookHarness.ts";
import { HOT_DEPENDENCY } from "../../../test/harnessModules.ts";
import type { HookRuntime } from "../../../test/hookHarness.ts";
import { localeAt, readLocale } from "../../../test/locales.ts";

// The stand-ins' shared state (made in setup below), as the tests script and read it.
type Handler = (event: { payload: unknown }) => void;
interface StubState {
    ready: boolean;
    settings: boolean;
    updating: boolean;
    actions: string[];
    notices: unknown[][];
    warnings: unknown[][];
    registered: Map<string, (event: { state: string }) => unknown>;
    removed: string[];
    // What was written: the endpoint and the hotkeys.
    writes: [string, Record<string, string[] | null>][];
    // What the app was asked: the command and its arguments (the bind's keys, the quick chat's token).
    calls: [string, CommandArgs | undefined][];
    // What the global shortcut plugin was asked, in order: "register Control+Q", "unregisterAll".
    plugin: string[];
    // The hotkey store and the notifications, in order: "pending", "notification closed", "saved",
    // and each endpoint written to or read from.
    events: string[];
    handlers: Set<Handler>;
    lostHandlers: Set<Handler>;
    notRestoredHandlers: Set<Handler>;
    removals: number;
    cleanups: (() => void)[];
    disposers: ((data: unknown) => void)[];
    hotkeys: Record<string, string[] | null>;
    runtime?: HookRuntime;
    // What the scripted calls wait for or answer.
    platformGate?: unknown;
    registerGate?: unknown;
    unregisterGate?: unknown;
    listenGate?: Promise<unknown> | null;
    writeGate?: unknown;
    bind?: (args: unknown) => unknown;
    minimized?: boolean;
    // isMinimized cannot read the window's state.
    minimizedUnknown?: boolean;
    minimizeFails?: boolean;
    unminimizeFails?: boolean;
    unregisterFails?: boolean;
    restoreFails?: boolean;
    platformFails?: boolean;
    showFails?: boolean;
    // The keys the plugin cannot register, as another application holds them.
    refused?: string[];
    // The portal event whose listener cannot be added.
    listenFails?: string;
    focusChanged?: (event: { payload: boolean }) => void;
}
interface CommandArgs {
    shortcuts?: Record<string, string[] | null>;
    activationToken?: string | null;
}
// What the bind answers for one action (Assigned in portal_shortcuts.rs).
interface Assigned {
    shown: string;
    applied: boolean | null;
}
interface StubStore {
    text_area_ref: { current: { focus: () => void } };
    appWindow?: Record<string, (...args: never[]) => unknown>;
    backend_session?: string;
}

// The words a key stands for, as the tests read them: the key, and the values put into it. A
// value left out, or a key that went missing, shows in the text.
const t = (key: string, values?: Record<string, unknown>) => values === undefined ? key
    : `${key}(${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(", ")})`;
const english = readLocale("en");

const deferred = () => {
    // Set by the promise below before the object is made.
    let resolve: (value?: unknown) => void = () => {}, reject: (reason?: unknown) => void = () => {};
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

async function setup() {
    // The production hook, loaded with only React, atoms and native APIs replaced; no plugin,
    // portal, browser or application is started.
    const state: StubState = { ready: true, settings: false, updating: false, actions: [], notices: [],
        registered: new Map(), removed: [], writes: [], calls: [], plugin: [], events: [],
        handlers: new Set(), lostHandlers: new Set(), notRestoredHandlers: new Set(),
        warnings: [], removals: 0, cleanups: [], disposers: [], hotkeys: { open_quick_chat: ["Ctrl", "Q"] } };
    // Vite's hot module replacement: what a module instance leaves for the next one.
    const hot = { data: {}, dispose: (callback: (data: unknown) => void) => state.disposers.push(callback) };
    // With a runtime (owner below) the hook runs inside a drawing; without one it runs once, outside
    // any: a ref is a plain object, and an effect runs at once and keeps its clean-up.
    const react = {
        // biome-ignore lint/correctness/useHookAtTopLevel: the stand-in passes the hook on only while the harness draws.
        useRef: <T>(value: T) => state.runtime ? state.runtime.api.useRef(value) : { current: value },
        useEffect: (callback: () => unknown, deps?: unknown[]) => {
            // biome-ignore lint/correctness/useHookAtTopLevel: the stand-in passes the hook on only while the harness draws.
            if (state.runtime) return state.runtime.api.useEffect(callback, deps);
            const cleanup = callback();
            state.cleanups.push(typeof cleanup === "function" ? () => { cleanup(); } : () => {});
        },
    };
    const store: StubStore = { text_area_ref: { current: { focus: () => state.actions.push("focus-input") } }, appWindow: {
        isMinimized: async () => { if (state.minimizedUnknown) throw new Error("window"); return state.minimized ?? false; },
        minimize: async () => { if (state.minimizeFails) throw new Error("window"); state.actions.push("minimize"); },
        unminimize: async () => { if (state.unminimizeFails) throw new Error("window"); state.actions.push("unminimize"); },
        setFocus: async () => { state.actions.push("set-focus"); },
        onFocusChanged: (callback: (event: { payload: boolean }) => void) => { state.focusChanged = callback; return () => {}; },
    } };
    const invoke = async (command: string, args?: CommandArgs) => {
        state.calls.push([command, args]);
        if (command === "quick_chat_shortcut_platform") {
            if (state.platformFails) throw "platform_unknown";
            return state.platformGate ?? "wayland";
        }
        if (command === "portal_shortcuts_bind") return state.bind?.(args) ?? {};
        if (command === "quick_chat_show") {
            if (state.showFails) throw "show_failed";
            state.actions.push("quick-chat");
        }
        if (command === "main_window_restore") {
            if (state.restoreFails) throw "restore_failed";
            state.actions.push("restore");
        }
    };
    // The portal's events by name, kept apart so the counts below are those of the key presses. An
    // event the app does not send is refused, as no listener would ever hear it.
    const events: Record<string, Set<Handler>> = { "portal-shortcut": state.handlers,
        "portal-shortcuts-lost": state.lostHandlers, "portal-shortcuts-not-restored": state.notRestoredHandlers };
    const listen = async (name: string, callback: Handler) => {
        if (!Object.hasOwn(events, name)) throw new Error(`The app sends no event named "${name}"`);
        const handlers = events[name];
        handlers.add(callback);
        try {
            await state.listenGate;
            if (state.listenFails === name) throw "listen_failed";
        } catch (error) {
            // A listener that could not be added hears nothing.
            handlers.delete(callback);
            throw error;
        }
        return () => { handlers.delete(callback); if (handlers === state.handlers) state.removals++; };
    };
    const imports = {
        react,
        jotai: { getDefaultStore: () => ({ get: (atom: string) => ({ data: Reflect.get(state, atom) }) }) },
        "@store": { store, Atom_IsOpenedConfigPage: "settings", Atom_IsBackendReady: "ready", Atom_IsSoftwareUpdating: "updating", Atom_Hotkeys: "hotkeys",
            useStore_Hotkeys: () => ({ currentHotkeys: { data: state.hotkeys },
                updateHotkeys: (value: Record<string, string[] | null>) => { state.hotkeys = value; },
                pendingHotkeys: () => { state.events.push("pending"); } }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string, hotkeys: Record<string, string[] | null>) => {
            state.events.push(endpoint);
            if (hotkeys === undefined) return true;
            state.writes.push([endpoint, hotkeys]);
            return state.writeGate ?? true;
        } }) },
        "@logics_common": { useNotificationStatus: () => ({
            showNotification_SaveSuccess: () => { state.events.push("saved"); }, closeNotification: () => { state.events.push("notification closed"); },
            showNotification_Error: (...args: unknown[]) => state.notices.push(args), showNotification_Warning: (...args: unknown[]) => state.warnings.push(args) }) },
        "@logics_main": { useMainFunction: () => ({ toggleTranslation: () => state.actions.push("translation"),
            toggleTranscriptionSend: () => state.actions.push("send"), toggleTranscriptionReceive: () => state.actions.push("receive") }) },
        "@tauri-apps/plugin-global-shortcut": {
            register: async (key: string, callback: (event: { state: string }) => unknown) => {
                state.plugin.push(`register ${key}`);
                await state.registerGate;
                if (state.refused?.includes(key)) throw new Error(`${key} is held by another application`);
                state.registered.set(key, callback);
            },
            unregister: async (key: string) => { state.plugin.push(`unregister ${key}`); state.removed.push(key); state.registered.delete(key); },
            unregisterAll: async () => {
                state.plugin.push("unregisterAll");
                await state.unregisterGate;
                if (state.unregisterFails) throw new Error("plugin");
                state.removed.push(...state.registered.keys());
                state.registered.clear();
            },
        },
        "@tauri-apps/api/core": { invoke },
        "@tauri-apps/api/event": { listen },
        "@useI18n": { useI18n: () => ({ t, i18n: { exists: (key: string) => localeAt(english, key) !== undefined } }) },
        "../../../voice/voiceActions.ts": { voiceActions: Object.fromEntries(["stop", "toggleMute", "toggleTts", "toggleRvc"].map(name => [name, () => state.actions.push(name)])) },
        [HOT_DEPENDENCY]: hot,
    };
    // Each load runs the module's top level again: a new instance, as hot module replacement makes.
    const importHook = async () => (await loadModule<typeof import("./useHotkeys.ts")>(new URL("./useHotkeys.ts", import.meta.url), hooks(), imports)).useHotkeys;
    // Without the React stand-in the hook runs once, here; owner() gives it one and runs it there.
    const load = async () => (await importHook())();
    return { state, store, load, importHook, dispose: (index: number) => state.disposers[index](hot.data),
        emit: () => { for (const callback of state.handlers) callback({ payload: { id: "open_quick_chat" } }); },
        // A key press the portal forwards, with the desktop's activation token when it gives one.
        press: (id: string, activation_token?: string) => { for (const callback of state.handlers) callback({ payload: { id, activation_token } }); },
        lost: () => { for (const callback of state.lostHandlers) callback({ payload: null }); },
        notRestored: () => { for (const callback of state.notRestoredHandlers) callback({ payload: null }); } };
}

for (const boundary of ["platform", "unregister", "listen", "bind"] as const) {
    test(`pause during ${boundary} await prevents a late registration from enabling shortcuts`, async () => {
        const subject = await setup(), gate = deferred();
        const { state } = subject;
        if (boundary === "bind") state.bind = () => gate.promise;
        else state[`${boundary}Gate` as const] = gate.promise;
        const hook = await subject.load();
        const registration = hook.registerShortcuts();
        await flush();
        // Explicit pause invalidates this registration even if no atom changed.
        const paused = state.plugin.length;
        const pause = hook.unregisterAll();
        gate.resolve(boundary === "platform" ? "wayland" : {});
        await Promise.all([registration, pause]);
        subject.emit();
        assert.deepEqual(state.actions, []);
        if (boundary !== "bind") assert.equal(state.calls.filter(([cmd]) => cmd === "portal_shortcuts_bind").length, 0);
        // The dropped registration asks nothing more: the plugin hears only the pause, and the
        // portal is listened to only by a registration that had got that far.
        assert.deepEqual(state.plugin.slice(paused), ["unregisterAll"]);
        assert.equal(state.handlers.size, boundary === "listen" || boundary === "bind" ? 1 : 0);
    });
}

// The same on the other platforms, where the plugin binds the keys itself.
for (const boundary of ["platform", "queue", "unregister", "register"] as const) {
    test(`a native registration dropped during its ${boundary} step registers no further key`, async () => {
        const subject = await setup(), gate = deferred();
        const { state } = subject;
        state.platformGate = boundary === "platform" ? gate.promise : "native";
        state.hotkeys = { open_quick_chat: ["Ctrl", "Q"], toggle_translation: ["Ctrl", "T"] };
        const hook = await subject.load();
        let earlier: Promise<void> | undefined;
        if (boundary === "queue") {
            // An earlier registration still clears the plugin, so this one waits in line behind it.
            state.unregisterGate = gate.promise;
            earlier = hook.registerShortcuts();
            await flush();
        } else if (boundary === "unregister") state.unregisterGate = gate.promise;
        else if (boundary === "register") state.registerGate = gate.promise;
        const registration = hook.registerShortcuts();
        await flush();
        const paused = state.plugin.length;
        const pause = hook.unregisterAll();
        gate.resolve(boundary === "platform" ? "native" : undefined);
        await Promise.all([earlier, registration, pause]);
        assert.deepEqual(state.plugin.slice(paused), ["unregisterAll"]);
        assert.equal(state.registered.size, 0);
    });
}

test("a registration asked for while the shortcuts are off asks nothing of the app or the plugin", async () => {
    const subject = await setup(), { state } = subject;
    state.settings = true;
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.plugin, []);
});

test("a press that arrives before the desktop has answered the bind does nothing", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    state.bind = () => gate.promise;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    subject.emit();
    assert.deepEqual(state.actions, []);
    gate.resolve({});
    await registration;
    subject.emit();
    assert.deepEqual(state.actions, ["quick-chat"]);
});

test("registering again keeps one listener for each portal event", async () => {
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    await hook.unregisterAll();
    await hook.registerShortcuts();
    await hook.registerShortcuts();
    assert.deepEqual([state.handlers.size, state.lostHandlers.size, state.notRestoredHandlers.size], [1, 1, 1]);
    subject.emit();
    assert.deepEqual(state.actions, ["quick-chat"]);
});

test("a newer registration drops one still waiting for the desktop", async () => {
    const subject = await setup(), old = deferred(), { state } = subject;
    state.bind = () => old.promise;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    state.bind = () => ({});
    await hook.registerShortcuts();
    old.resolve({ open_quick_chat: { shown: "Ctrl+Alt+Q", applied: false } });
    await registration;
    assert.deepEqual(state.notices, []);
    subject.emit();
    assert.deepEqual(state.actions, ["quick-chat"]);
});

for (const [atom, value] of [["settings", true], ["ready", false], ["updating", true]] satisfies ["settings" | "ready" | "updating", boolean][]) {
    test(`current ${atom} state is rechecked after bind without waiting for controller effects`, async () => {
        const subject = await setup(), gate = deferred();
        subject.state.bind = () => gate.promise;
        const hook = await subject.load(), registration = hook.registerShortcuts();
        await flush();
        subject.state[atom] = value;
        gate.resolve({});
        await registration;
        subject.emit();
        assert.deepEqual(subject.state.actions, []);
    });
}

test("a shortcut the desktop cannot take is told with its own message, in both languages (#563)", async () => {
    const subject = await setup();
    // The portal refuses a key it has no name for, and with it the whole bind.
    subject.state.bind = () => Promise.reject("portal_shortcut_invalid");
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual(subject.state.notices, [["quick_chat.portal_errors.portal_shortcut_invalid", { hide_duration: 8000 }]]);
    // The stand-in knows the keys of the English locale; the message is in both locale files.
    for (const language of ["en", "ja"]) {
        assert.equal(typeof localeAt(readLocale(language), "quick_chat.portal_errors.portal_shortcut_invalid"), "string", language);
    }
});

test("unmount removes the handler and late bind cannot dispatch or report a stale error", async () => {
    const subject = await setup(), gate = deferred();
    subject.state.bind = () => gate.promise;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    subject.state.cleanups[0]();
    assert.equal(subject.state.handlers.size, 0);
    gate.reject("portal_cancelled");
    await registration;
    subject.emit();
    assert.deepEqual(subject.state.actions, []);
    assert.deepEqual(subject.state.notices, []);
    assert.equal(subject.state.removals, 1);
});

test("unmount before listen resolves still calls the eventual unlisten", async () => {
    const subject = await setup(), gate = deferred();
    subject.state.listenGate = gate.promise;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    subject.state.cleanups[0]();
    subject.emit();
    assert.deepEqual(subject.state.actions, []);
    gate.resolve();
    await registration;
    assert.equal(subject.state.handlers.size, 0);
    assert.equal(subject.state.removals, 1);
    assert.equal(subject.state.calls.filter(([cmd]) => cmd === "portal_shortcuts_bind").length, 0);
});

test("two module instances dispatch only once after HMR disposal", async () => {
    const subject = await setup();
    const first = await subject.load();
    await first.registerShortcuts();
    subject.dispose(0);
    const second = await subject.load();
    await second.registerShortcuts();
    subject.emit();
    assert.deepEqual(subject.state.actions, ["quick-chat"]);
    assert.equal(subject.state.handlers.size, 1);
    assert.equal(subject.state.removals, 1);
    // Old component cleanup must not remove the new module's listener.
    subject.state.cleanups[0]();
    assert.equal(subject.state.handlers.size, 1);
});

test("HMR disposes a pending listen without removing the replacement handler", async () => {
    const subject = await setup(), gate = deferred();
    subject.state.listenGate = gate.promise;
    const first = await subject.load(), registration = first.registerShortcuts();
    await flush();
    subject.dispose(0);
    subject.state.listenGate = null;
    const second = await subject.load();
    await second.registerShortcuts();
    gate.resolve();
    await registration;
    subject.emit();
    assert.deepEqual(subject.state.actions, ["quick-chat"]);
    assert.equal(subject.state.handlers.size, 1);
});

test("newer registration wins when old completion arrives last", async () => {
    const subject = await setup(), old = deferred();
    subject.state.bind = () => old.promise;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    await hook.unregisterAll();
    subject.state.bind = () => ({});
    await hook.registerShortcuts();
    old.resolve({ open_quick_chat: { applied: false, shown: "old" } });
    await registration;
    subject.emit();
    assert.deepEqual(subject.state.actions, ["quick-chat"]);
    assert.deepEqual(subject.state.notices, []);
});

test("failed listen can be retried deliberately", async () => {
    const subject = await setup();
    subject.state.listenGate = Promise.reject("portal_unavailable");
    // Observe the fake rejection before the hook gets to the listener await.
    subject.state.listenGate.catch(() => {});
    const hook = await subject.load();
    await hook.registerShortcuts();
    subject.state.listenGate = null;
    await hook.registerShortcuts();
    subject.emit();
    assert.deepEqual(subject.state.actions, ["quick-chat"]);
});

test("VR window command checks the injected calling window before any mutation or await", async () => {
    const source = await readFile(new URL("../../../../../src-tauri/src/lib.rs", import.meta.url), "utf8");
    const command = source.slice(source.indexOf("async fn set_vr_panel_window("), source.indexOf("use font_kit"));
    assert.match(command, /window: tauri::WebviewWindow/);
    assert.match(command, /\{\s*if window\.label\(\) != "main" \{\s*return Err\("vr_panel_forbidden"\.into\(\)\);\s*\}\s*let _guard = VR_PANEL_LOCK\.lock\(\)\.await;/);
});

async function owner(platform = "native") {
    const subject = await setup(), runtime = hooks();
    subject.state.runtime = runtime;
    subject.state.platformGate = platform;
    const useHotkeys = await subject.importHook();
    let latest: ReturnType<typeof useHotkeys> | undefined;
    const { GlobalHotKeyController } = await loadModule<typeof import("../../../../views/app/_app_controllers/GlobalHotKeyController.tsx")>(new URL("../../../../views/app/_app_controllers/GlobalHotKeyController.tsx", import.meta.url), runtime, {
        "@logics_configs": { useHotkeys: () => { latest = useHotkeys(); return latest; } },
        "@logics_common": {
            useIsBackendReady: () => ({ currentIsBackendReady: { data: subject.state.ready } }),
            useIsSoftwareUpdating: () => ({ currentIsSoftwareUpdating: { data: subject.state.updating } }),
            useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: subject.state.settings } }),
        },
    });
    return { ...subject, runtime, render: async () => { runtime.render(GlobalHotKeyController); await flush(); },
        // The hook's answer from the last draw; there is one once the controller has drawn.
        hook: () => { assert.ok(latest); return latest; } };
}

for (const [action, oldKeys, newKeys] of [
    ["open_quick_chat", ["Ctrl", "Q"], ["Ctrl", "W"]],
    ["toggle_transcription_send", ["Ctrl", "M"], ["Ctrl", "N"]],
    ["toggle_transcription_send", ["Ctrl", "M"], null],
] satisfies [string, string[], string[] | null][]) test(`close before ${action} ${newKeys ? "replacement" : "deletion"} acknowledgement reconciles native bindings`, async () => {
    const subject = await owner();
    subject.state.hotkeys = { [action]: oldKeys };
    await subject.render();
    const oldShortcut = `Control+${oldKeys[1]}`;
    assert.deepEqual([...subject.state.registered.keys()], [oldShortcut]);
    const oldCallback = subject.state.registered.get(oldShortcut);
    assert.ok(oldCallback);
    subject.state.settings = true;
    await subject.render();
    await subject.hook().setHotkeys({ [action]: newKeys });
    const written = subject.state.writes.at(-1);
    assert.ok(written);
    const acknowledged = written[1];
    subject.state.settings = false;
    await subject.render();
    assert.deepEqual([...subject.state.registered.keys()], [oldShortcut]);
    subject.hook().setSuccessHotkeys(acknowledged);
    await subject.render();
    assert.deepEqual([...subject.state.registered.keys()], newKeys ? [`Control+${newKeys[1]}`] : []);
    assert.ok(subject.state.removed.includes(oldShortcut));
    await oldCallback({ state: action === "open_quick_chat" ? "Released" : "Pressed" });
    assert.deepEqual(subject.state.actions, []);
    if (newKeys) {
        const callback = subject.state.registered.get(`Control+${newKeys[1]}`);
        assert.ok(callback);
        await callback({ state: action === "open_quick_chat" ? "Released" : "Pressed" });
        assert.deepEqual(subject.state.actions, [action === "open_quick_chat" ? "quick-chat" : "send"]);
    }
    subject.runtime.unmount();
    await flush();
    assert.equal(subject.state.registered.size, 0);
});

test("a Space stored by older recordings as \" \" registers as Control+Space", async () => {
    const subject = await owner();
    subject.state.hotkeys = { open_quick_chat: ["Ctrl", " "] };
    await subject.render();
    assert.deepEqual([...subject.state.registered.keys()], ["Control+Space"]);
    subject.runtime.unmount();
    await flush();
});

test("a symbol or digit stored by older recordings as what Shift typed registers as its key (#563)", async () => {
    const subject = await owner();
    // Before 2026-11-18 a symbol was stored as the character Shift typed, which the registrar does
    // not read; digits were before 2026-11-07. With Shift in the chord, each is read as its key.
    subject.state.hotkeys = { open_quick_chat: ["Ctrl", "Shift", "?"], send_message_button: ["Ctrl", "Shift", "!"] };
    await subject.render();
    assert.deepEqual([...subject.state.registered.keys()].sort(), ["Control+Shift+/", "Control+Shift+1"]);
    subject.runtime.unmount();
    await flush();
});

test("without Shift in the chord, a stored character is passed on as it is", async () => {
    const subject = await owner();
    // Without Shift in the chord, the stored character is not reread: "Ctrl+?" was never typed with
    // Shift, so it is passed on as stored.
    subject.state.hotkeys = { open_quick_chat: ["Ctrl", "Shift", "/"], send_message_button: ["Ctrl", "?"] };
    await subject.render();
    assert.ok(subject.state.registered.has("Control+Shift+/"));
    assert.ok(!subject.state.registered.has("Control+/"));
    subject.runtime.unmount();
    await flush();
});

test("an old native register completing after a new acknowledgement is released before the new binding", async () => {
    const subject = await owner(), gate = deferred();
    subject.state.registerGate = gate.promise;
    await subject.render();
    subject.hook().setSuccessHotkeys({ open_quick_chat: ["Ctrl", "W"] });
    await subject.render();
    gate.resolve();
    await flush();
    assert.deepEqual([...subject.state.registered.keys()], ["Control+W"]);
    assert.ok(subject.state.removed.includes("Control+Q"));
    subject.runtime.unmount();
    await flush();
});

test("portal reconciliation observes acknowledged content and does not rebind on identical data", async () => {
    const subject = await owner("wayland");
    await subject.render();
    subject.state.settings = true;
    await subject.render();
    subject.state.settings = false;
    await subject.render();
    subject.hook().setSuccessHotkeys({ open_quick_chat: ["Ctrl", "W"] });
    await subject.render();
    const binds = () => subject.state.calls.filter(([name]) => name === "portal_shortcuts_bind");
    assert.deepEqual(binds().at(-1)?.[1]?.shortcuts, { open_quick_chat: ["Ctrl", "W"] });
    const count = binds().length;
    subject.hook().setSuccessHotkeys({ open_quick_chat: ["Ctrl", "W"] });
    await subject.render();
    assert.equal(binds().length, count);
    subject.emit();
    assert.deepEqual(subject.state.actions, ["quick-chat"]);
    subject.state.settings = true;
    await subject.render();
    subject.emit();
    assert.deepEqual(subject.state.actions, ["quick-chat"]);
    subject.runtime.unmount();
});

test("Settings close controller leaves registration to its single owner", async () => {
    const source = await readFile(new URL("../../../../views/app/_app_controllers/ConfigPageCloseTriggerController.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /useHotkeys|registerShortcuts|unregisterAll/);
});

for (const deletion of [false, true]) test(`overlapping hotkey ${deletion ? "deletion" : "assignment"} sends only the edited actions`, async () => {
    const subject = await setup(), gate = deferred();
    subject.state.platformGate = "native";
    subject.state.hotkeys = { toggle_translation: null, toggle_transcription_send: ["Ctrl", "M"] };
    subject.state.registerGate = gate.promise;
    const hook = await subject.load();
    const first = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    const second = hook.setHotkeys({ toggle_transcription_send: deletion ? null : ["Ctrl", "N"] });
    gate.resolve();
    await Promise.all([first, second]);
    const final = Object.assign({}, ...subject.state.writes.map(([, value]) => value));
    assert.deepEqual(final, { toggle_translation: ["Ctrl", "T"], toggle_transcription_send: deletion ? null : ["Ctrl", "N"] });
    assert.ok(subject.state.writes.every(([, value]) => Object.keys(value).length === 1));
});

for (const boundary of ["preflight", "acknowledgement"]) test(`pending shortcut at ${boundary} cannot be assigned to a second action`, async () => {
    const subject = await setup(), gate = deferred();
    subject.state.platformGate = "native";
    subject.state.hotkeys = { toggle_translation: null, toggle_transcription_send: null };
    if (boundary === "preflight") subject.state.registerGate = gate.promise;
    else subject.state.writeGate = gate.promise;
    const hook = await subject.load();
    const first = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    const second = hook.setHotkeys({ toggle_transcription_send: ["Ctrl", "T"] });
    await flush();
    gate.resolve(true);
    assert.equal(await second, false);
    await first;
    assert.equal(subject.state.writes.length, 1);
});

test("preflight rechecks the latest acknowledged content before saving", async () => {
    const subject = await setup(), gate = deferred();
    subject.state.platformGate = "native";
    subject.state.hotkeys = { toggle_translation: null, toggle_transcription_send: null };
    subject.state.registerGate = gate.promise;
    const hook = await subject.load();
    const edit = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    hook.setSuccessHotkeys({ toggle_translation: null, toggle_transcription_send: ["Ctrl", "T"] });
    gate.resolve();
    assert.equal(await edit, false);
    assert.deepEqual(subject.state.writes, []);
});

test("a newer edit of the same action supersedes its pending preflight", async () => {
    const subject = await setup(), gate = deferred();
    subject.state.platformGate = "native";
    subject.state.hotkeys = { toggle_translation: null };
    subject.state.registerGate = gate.promise;
    const hook = await subject.load();
    const first = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    const second = hook.setHotkeys({ toggle_translation: ["Ctrl", "N"] });
    gate.resolve();
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(subject.state.writes, [["/set/data/hotkeys", { toggle_translation: ["Ctrl", "N"] }]]);
});

test("a sent edit stays reserved until its acknowledgement even if the same action is edited again", async () => {
    const subject = await setup(), gate = deferred();
    subject.state.platformGate = "native";
    subject.state.hotkeys = { toggle_translation: null, toggle_transcription_send: null };
    subject.state.writeGate = gate.promise;
    const hook = await subject.load();
    const first = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "N"] }), false);
    assert.equal(await hook.setHotkeys({ toggle_transcription_send: ["Ctrl", "T"] }), false);
    gate.resolve(true);
    await first;
    assert.equal(subject.state.writes.length, 1);
});

test("on Wayland the visibility hotkey restores the window it minimized", async () => {
    const subject = await setup();
    const { state } = subject;
    state.hotkeys = { toggle_vrct_visibility: ["Ctrl", "H"] };
    const hook = await subject.load();
    await hook.registerShortcuts();
    await flush();
    const press = async () => { for (const callback of state.handlers) callback({ payload: { id: "toggle_vrct_visibility" } }); await flush(); await flush(); };
    await press();
    assert.deepEqual(state.actions, ["minimize"]);
    // A minimized window loses the focus, which says nothing about whether it is shown.
    assert.ok(state.focusChanged);
    state.focusChanged({ payload: false });
    // Wayland never reports a window as minimized; the second press must still bring it back.
    await press();
    assert.deepEqual(state.actions, ["minimize", "restore", "focus-input"]);
    await press();
    assert.deepEqual(state.actions, ["minimize", "restore", "focus-input", "minimize"]);
    // The user brought the window back by hand: the next press minimizes again.
    state.focusChanged({ payload: true });
    await press();
    assert.deepEqual(state.actions, ["minimize", "restore", "focus-input", "minimize", "minimize"]);
});

test("elsewhere the visibility hotkey asks the window whether it is minimized", async () => {
    const subject = await setup();
    const { state } = subject;
    state.platformGate = "native";
    state.hotkeys = { toggle_vrct_visibility: ["Ctrl", "H"] };
    const hook = await subject.load();
    await hook.registerShortcuts();
    await flush();
    const [[, press]] = [...state.registered];
    await press({ state: "Pressed" });
    await flush();
    state.minimized = true;
    await press({ state: "Pressed" });
    await flush();
    assert.deepEqual(state.actions, ["minimize", "unminimize", "set-focus", "focus-input"]);
    assert.ok(!state.calls.some(([command]) => command === "main_window_restore"));
    // The window's own answer is enough here: its focus is not watched.
    assert.equal(state.focusChanged, undefined);
});

// #465: a failure no caller catches is told, not only logged.
test("a registration that fails before any key is bound says no hotkey works", async () => {
    const subject = await setup();
    const { state } = subject;
    state.platformGate = "native";
    state.unregisterFails = true;
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.equal(state.registered.size, 0);
    assert.deepEqual(state.notices, [["config_page.hotkeys.error_failed_to_register_all", { hide_duration: 10000 }]]);
});

test("on Wayland a window the hotkey cannot restore is told, and the next press tries again", async () => {
    const subject = await setup();
    const { state } = subject;
    state.hotkeys = { toggle_vrct_visibility: ["Ctrl", "H"] };
    const hook = await subject.load();
    await hook.registerShortcuts();
    await flush();
    const press = async () => { for (const callback of state.handlers) callback({ payload: { id: "toggle_vrct_visibility" } }); await flush(); await flush(); };
    await press();
    state.restoreFails = true;
    await press();
    assert.deepEqual(state.actions, ["minimize"]);
    assert.deepEqual(state.notices.map(([message]) => message), ["config_page.hotkeys.error_window_restore_failed"]);
    state.restoreFails = false;
    await press();
    assert.deepEqual(state.actions, ["minimize", "restore", "focus-input"]);
});

test("elsewhere a window the hotkey cannot restore is told", async () => {
    const subject = await setup();
    const { state } = subject;
    state.platformGate = "native";
    state.hotkeys = { toggle_vrct_visibility: ["Ctrl", "H"] };
    const hook = await subject.load();
    await hook.registerShortcuts();
    await flush();
    const [[, press]] = [...state.registered];
    state.minimized = true;
    state.unminimizeFails = true;
    await press({ state: "Pressed" });
    await flush();
    assert.deepEqual(state.actions, []);
    assert.deepEqual(state.notices.map(([message]) => message), ["config_page.hotkeys.error_window_restore_failed"]);
});

test("the voice hotkeys press the controls the main window published", async () => {
    const subject = await setup();
    const { state } = subject;
    state.hotkeys = { stop_voice: ["Ctrl", "1"], toggle_voice_mute: ["Ctrl", "2"], toggle_tts: ["Ctrl", "3"], toggle_rvc: ["Ctrl", "4"] };
    const hook = await subject.load();
    await hook.registerShortcuts();
    await flush();
    const bound = state.calls.find(([command]) => command === "portal_shortcuts_bind")?.[1];
    assert.ok(bound);
    assert.deepEqual(Object.keys(bound.shortcuts ?? {}),
        ["stop_voice", "toggle_voice_mute", "toggle_tts", "toggle_rvc"]);
    for (const id of ["stop_voice", "toggle_voice_mute", "toggle_tts", "toggle_rvc"]) {
        for (const callback of state.handlers) callback({ payload: { id } });
        await flush();
    }
    assert.deepEqual(state.actions, ["stop", "toggleMute", "toggleTts", "toggleRvc"]);
});

test("a portal that goes away is said and the keys are bound again once; a second loss soon after is left to the user", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1_000_000 });
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    const binds = () => state.calls.filter(([cmd]) => cmd === "portal_shortcuts_bind").length;
    assert.equal(binds(), 1);
    subject.lost();
    assert.deepEqual(state.warnings, [["quick_chat.portal_lost_reconnecting", { hide_duration: 8000 }]]);
    assert.equal(binds(), 1, "not at once: a restarted portal needs a moment");
    vi.advanceTimersByTime(3000);
    await flush(); await flush(); await flush();
    assert.equal(binds(), 2);
    subject.emit();
    assert.deepEqual(state.actions, ["quick-chat"], "the keys work again");
    // Lost again within a minute: no second automatic bind, the user is told what to do.
    vi.advanceTimersByTime(10000);
    subject.lost();
    vi.advanceTimersByTime(3000);
    await flush(); await flush();
    assert.equal(binds(), 2);
    assert.deepEqual(state.notices, [["quick_chat.portal_lost", { hide_duration: 10000 }]]);
});

test("a failed bind whose previous keys could not be bound again says no hotkey works, once", async () => {
    // #561: Rust answers the failed bind, then says the keys in force before it are gone too.
    const subject = await setup(), { state } = subject;
    state.bind = () => { throw "portal_cancelled"; };
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual(state.notices, [["quick_chat.portal_errors.portal_cancelled", { hide_duration: 8000 }]]);
    subject.notRestored();
    subject.notRestored();
    assert.deepEqual(state.notices, [["quick_chat.portal_errors.portal_cancelled", { hide_duration: 8000 }],
        ["quick_chat.portal_not_restored", { hide_duration: 10000 }]]);
});

// #1051: a failed bind leaves the keys in force before it, which Rust binds again
// (Restore::Restored). The desktop sends their presses, and they do what they are for, as they
// did before: GNOME 51 when its dialog is cancelled, KDE Plasma 6.8 when it is left to time out.
for (const code of ["portal_cancelled", "portal_timeout"]) {
    test(`after a failed bind (${code}), a press of a key the desktop has again does what it is for`, async () => {
        const subject = await setup(), gate = deferred(), { state } = subject;
        state.bind = () => gate.promise;
        const hook = await subject.load(), registration = hook.registerShortcuts();
        await flush();
        // While the desktop has not answered, the keys stay paused.
        subject.emit();
        assert.deepEqual(state.actions, []);
        gate.reject(code);
        await registration;
        assert.deepEqual(state.notices, [[`quick_chat.portal_errors.${code}`, { hide_duration: 8000 }]]);
        subject.emit();
        assert.deepEqual(state.actions, ["quick-chat"]);
    });
}

test("a failed bind of a registration that was paused meanwhile leaves the keys paused", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    state.bind = () => gate.promise;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    // Settings open while the desktop asks; the registration that comes when they close decides.
    const pause = hook.unregisterAll();
    gate.reject("portal_cancelled");
    await Promise.all([registration, pause]);
    subject.emit();
    assert.deepEqual(state.actions, []);
    assert.deepEqual(state.notices, []);
});

test("a report of keys not bound again after the shortcuts were paused says nothing", async () => {
    const subject = await setup(), { state } = subject;
    state.bind = () => { throw "portal_cancelled"; };
    const hook = await subject.load();
    await hook.registerShortcuts();
    await hook.unregisterAll();
    subject.notRestored();
    assert.deepEqual(state.notices.map(([message]) => message), ["quick_chat.portal_errors.portal_cancelled"]);
});

test("a portal lost while the shortcuts are paused waits for the next bind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1_000_000 });
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    await hook.unregisterAll();
    subject.lost();
    vi.advanceTimersByTime(5000);
    await flush();
    assert.deepEqual(state.warnings, []);
    assert.equal(state.calls.filter(([cmd]) => cmd === "portal_shortcuts_bind").length, 1);
});

test("a reconnect that is pending when the shortcuts pause is dropped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1_000_000 });
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    subject.lost();
    await hook.unregisterAll();
    vi.advanceTimersByTime(5000);
    await flush();
    assert.equal(state.calls.filter(([cmd]) => cmd === "portal_shortcuts_bind").length, 1);
});

test("a portal lost a full minute after the last reconnect is bound again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1_000_000 });
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    subject.lost();
    vi.advanceTimersByTime(3000);
    await flush(); await flush(); await flush();
    // The last reconnect counts from the loss that started it.
    vi.advanceTimersByTime(60000 - 3000);
    subject.lost();
    assert.equal(state.warnings.length, 2);
    assert.deepEqual(state.notices, []);
});

test("with no key set, the desktop is asked to bind nothing", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { open_quick_chat: null, toggle_translation: null };
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual(state.calls.map(([command]) => command), ["quick_chat_shortcut_platform"]);
    assert.equal(state.handlers.size, 0);
});

const binds = (state: StubState) => state.calls.filter(([command]) => command === "portal_shortcuts_bind").map(([, args]) => args?.shortcuts);

test("clearing the last key releases the keys the desktop holds, and a loss after that asks for nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1_000_000 });
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    // The hook reads the hotkeys it was drawn with; the cleared key is acknowledged in place.
    state.hotkeys.open_quick_chat = null;
    await hook.registerShortcuts();
    assert.deepEqual(binds(state), [{ open_quick_chat: ["Ctrl", "Q"] }, {}]);
    // No key is bound now, so there is nothing to bind again.
    subject.lost();
    vi.advanceTimersByTime(5000);
    await flush();
    assert.deepEqual(state.warnings, []);
    assert.equal(binds(state).length, 2);
});

test("after a hot reload with every key cleared, the keys the old module bound are released", async () => {
    const subject = await setup(), { state } = subject;
    const first = await subject.load();
    await first.registerShortcuts();
    subject.dispose(0);
    state.hotkeys = { open_quick_chat: null };
    const second = await subject.load();
    await second.registerShortcuts();
    assert.deepEqual(binds(state), [{ open_quick_chat: ["Ctrl", "Q"] }, {}]);
});

test("a key the desktop did not take is told with the key asked for and the key in force", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { open_quick_chat: ["Ctrl", "Q"], toggle_vrct_visibility: ["Ctrl", "H"], stop_voice: ["Ctrl", "1"], toggle_tts: ["Ctrl", "3"] };
    // The desktop kept another key for the first two; it took the third, and cannot say for the fourth.
    state.bind = (): Record<string, Assigned> => ({
        open_quick_chat: { shown: "Ctrl+Alt+Q", applied: false },
        toggle_vrct_visibility: { shown: "", applied: false },
        stop_voice: { shown: "Ctrl+1", applied: true },
        toggle_tts: { shown: "Ctrl+3", applied: null },
    });
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual(state.notices, [
        ["quick_chat.portal_key_kept(action_name=quick_chat.label, wanted=Ctrl + Q, hotkey=Ctrl+Alt+Q)", { hide_duration: 10000 }],
        // No key in force: a dash stands for it.
        ["quick_chat.portal_key_kept(action_name=config_page.hotkeys.toggle_vrct_visibility.label, wanted=Ctrl + H, hotkey=-)", { hide_duration: 10000 }],
    ]);
});

test("a portal event that cannot be listened to stops the bind and is told with its code", async () => {
    const subject = await setup(), { state } = subject;
    state.listenFails = "portal-shortcuts-lost";
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual(binds(state), []);
    // The listeners that were added are removed again.
    assert.deepEqual([state.handlers.size, state.lostHandlers.size, state.notRestoredHandlers.size], [0, 0, 0]);
    // The app has no words of its own for this code: the general message carries it.
    assert.deepEqual(state.notices, [["quick_chat.portal_failed(code=listen_failed)", { hide_duration: 8000 }]]);
});

test("a listen that fails after its owner left keeps the listener of the owner after it", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    const useHotkeys = await subject.importHook();
    const first = useHotkeys();
    state.listenGate = gate.promise;
    const dropped = first.registerShortcuts();
    await flush();
    state.cleanups[0]();
    state.listenGate = null;
    const second = useHotkeys();
    await second.registerShortcuts();
    gate.reject("portal_unavailable");
    await dropped;
    // The next registration of the new owner listens with what it has.
    await second.registerShortcuts();
    assert.equal(state.handlers.size, 1);
    subject.emit();
    assert.deepEqual(state.actions, ["quick-chat"]);
    assert.deepEqual(state.notices, []);
});

test("a press heard while the listener of an owner that left is still being added runs once", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    const useHotkeys = await subject.importHook();
    const first = useHotkeys();
    state.listenGate = gate.promise;
    const dropped = first.registerShortcuts();
    await flush();
    state.cleanups[0]();
    state.listenGate = null;
    const second = useHotkeys();
    await second.registerShortcuts();
    // Both listeners hear the press until the first one is added and removed again.
    assert.equal(state.handlers.size, 2);
    subject.emit();
    assert.deepEqual(state.actions, ["quick-chat"]);
    gate.resolve();
    await dropped;
    assert.equal(state.handlers.size, 1);
});

test("the quick chat opens with the activation token the desktop gave the press", async () => {
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    subject.press("open_quick_chat", "token-1");
    subject.press("open_quick_chat");
    await flush();
    assert.deepEqual(state.calls.filter(([command]) => command === "quick_chat_show").map(([, args]) => args),
        [{ activationToken: "token-1" }, { activationToken: null }]);
});

test("a quick chat that cannot be opened is told", async () => {
    const subject = await setup(), { state } = subject;
    state.showFails = true;
    const hook = await subject.load();
    await hook.openQuickChat();
    assert.deepEqual(state.notices, [["quick_chat.open_failed"]]);
});

test("the main window's switches run from their hotkeys, and an action the app does not know does nothing", async () => {
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    await hook.registerShortcuts();
    for (const id of ["toggle_translation", "toggle_transcription_send", "toggle_transcription_receive", "send_message_button"]) subject.press(id);
    await flush();
    assert.deepEqual(state.actions, ["translation", "send", "receive"]);
});

test("another user of the hook leaving keeps the keys the controller registered", async () => {
    const subject = await setup(), { state } = subject;
    const useHotkeys = await subject.importHook();
    const controller = useHotkeys();
    // The settings page reads the same hotkeys and registers nothing.
    useHotkeys();
    await controller.registerShortcuts();
    state.cleanups[1]();
    subject.emit();
    assert.deepEqual(state.actions, ["quick-chat"]);
    assert.equal(state.handlers.size, 1);
});

for (const gone of ["has unmounted", "belongs to a module hot reload replaced"]) {
    test(`a hook that ${gone} asks nothing when told to register`, async () => {
        const subject = await setup(), { state } = subject;
        const hook = await subject.load();
        if (gone === "has unmounted") state.cleanups[0]();
        else subject.dispose(0);
        await hook.registerShortcuts();
        assert.deepEqual(state.calls, []);
        assert.equal(state.handlers.size, 0);
    });
}

test("the quick chat key acts when it is released and the other keys when they are pressed", async () => {
    const subject = await setup(), { state } = subject;
    state.platformGate = "native";
    state.hotkeys = { open_quick_chat: ["Ctrl", "Q"], toggle_translation: ["Ctrl", "T"] };
    const hook = await subject.load();
    await hook.registerShortcuts();
    const quickChat = state.registered.get("Control+Q"), translation = state.registered.get("Control+T");
    assert.ok(quickChat && translation);
    await quickChat({ state: "Pressed" });
    assert.deepEqual(state.actions, []);
    await quickChat({ state: "Released" });
    await translation({ state: "Pressed" });
    await translation({ state: "Released" });
    assert.deepEqual(state.actions, ["quick-chat", "translation"]);
});

test("keys other applications hold at launch are told with their actions, and the rest are bound", async () => {
    const subject = await setup(), { state } = subject;
    state.platformGate = "native";
    // What each action is called in the messages.
    const labels = {
        open_quick_chat: "quick_chat.label",
        toggle_vrct_visibility: "config_page.hotkeys.toggle_vrct_visibility.label",
        toggle_translation: "config_page.hotkeys.toggle_translation.label(translation=main_page.translation)",
        toggle_transcription_send: "config_page.hotkeys.toggle_transcription_send.label(transcription_send=main_page.transcription_send)",
        toggle_transcription_receive: "config_page.hotkeys.toggle_transcription_receive.label(transcription_receive=main_page.transcription_receive)",
        stop_voice: "config_page.hotkeys.stop_voice.label",
        toggle_voice_mute: "config_page.hotkeys.toggle_voice_mute.label",
        toggle_tts: "config_page.hotkeys.toggle_voice_switch.label(name=main_page.tts)",
        toggle_rvc: "config_page.hotkeys.toggle_voice_switch.label(name=main_page.rvc)",
    };
    // Each action on its own digit, all held elsewhere; one more key is free.
    state.hotkeys = Object.fromEntries(Object.keys(labels).map((action, i) => [action, ["Ctrl", "Alt", String(i + 1)]]));
    state.hotkeys.send_message_button = ["Ctrl", "Enter"];
    state.refused = Object.keys(labels).map((_, i) => `Control+Alt+${i + 1}`);
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual(state.notices, Object.values(labels).map((label, i) => [
        `config_page.hotkeys.error_failed_to_register_at_launch(action_name=${label}, hotkey=Ctrl + Alt + ${i + 1})`, { hide_duration: 8000 }]));
    assert.deepEqual([...state.registered.keys()], ["Control+Enter"]);
});

test("a key refused after the registration was dropped is not told", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    state.platformGate = "native";
    state.registerGate = gate.promise;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    state.settings = true;
    gate.reject(new Error("held by another application"));
    await registration;
    assert.deepEqual(state.notices, []);
});

test("a plugin that cannot clear its keys after the registration was dropped is not told", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    state.platformGate = "native";
    state.unregisterGate = gate.promise;
    state.unregisterFails = true;
    const hook = await subject.load(), registration = hook.registerShortcuts();
    await flush();
    state.settings = true;
    gate.resolve();
    await registration;
    assert.deepEqual(state.notices, []);
});

// The native visibility hotkey, pressed once.
async function pressVisibility(subject: Awaited<ReturnType<typeof setup>>) {
    const { state } = subject;
    state.platformGate = "native";
    state.hotkeys = { toggle_vrct_visibility: ["Ctrl", "H"] };
    const hook = await subject.load();
    await hook.registerShortcuts();
    const press = state.registered.get("Control+H");
    assert.ok(press);
    await press({ state: "Pressed" });
}

test("a window whose state cannot be read is taken as shown and minimized by the press", async () => {
    const subject = await setup();
    subject.state.minimizedUnknown = true;
    await pressVisibility(subject);
    assert.deepEqual(subject.state.actions, ["minimize"]);
});

for (const cause of ["the window refuses", "there is no window"]) {
    test(`a window the hotkey cannot minimize is told when ${cause}`, async () => {
        const subject = await setup();
        if (cause === "the window refuses") subject.state.minimizeFails = true;
        else subject.store.appWindow = undefined;
        await pressVisibility(subject);
        assert.deepEqual(subject.state.actions, []);
        assert.deepEqual(subject.state.notices, [["config_page.hotkeys.error_window_minimize_failed"]]);
    });
}

test("every symbol stored as what Shift typed registers as its key, and Meta registers as Super", async () => {
    const subject = await setup(), { state } = subject;
    state.platformGate = "native";
    // What Shift types on a US layout, and the key it is typed with.
    const typed: [string, string][] = [["~", "`"], ["!", "1"], ["@", "2"], ["#", "3"], ["$", "4"], ["%", "5"], ["^", "6"],
        ["&", "7"], ["*", "8"], ["(", "9"], [")", "0"], ["_", "-"], ["+", "="], ["{", "["], ["}", "]"], ["|", "\\"],
        [":", ";"], ["\"", "'"], ["<", ","], [">", "."], ["?", "/"]];
    state.hotkeys = Object.fromEntries(typed.map(([symbol], i) => [`action_${i}`, ["Ctrl", "Shift", symbol]]));
    state.hotkeys.open_quick_chat = ["Meta", "Alt", "K"];
    const hook = await subject.load();
    await hook.registerShortcuts();
    assert.deepEqual([...state.registered.keys()], [...typed.map(([, key]) => `Control+Shift+${key}`), "Super+Alt+K"]);
});

test("a key another action has is refused at once, naming the action being edited and the key", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { open_quick_chat: ["Ctrl", "Q"], toggle_translation: null };
    const hook = await subject.load();
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "Q"] }), false);
    assert.deepEqual(state.notices, [[
        "config_page.hotkeys.error_in_use(action_name=config_page.hotkeys.toggle_translation.label(translation=main_page.translation), hotkey=Ctrl + Q)"]]);
    // Nothing is asked of the app or the plugin, and nothing is written.
    assert.deepEqual(state.calls, []);
    assert.deepEqual(state.plugin, []);
    assert.deepEqual(state.writes, []);
});

test("a key another action was given while the platform was asked is refused before it is tried", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    state.platformGate = gate.promise;
    state.hotkeys = { toggle_translation: null, toggle_transcription_send: null };
    const hook = await subject.load();
    const edit = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    hook.setSuccessHotkeys({ toggle_translation: null, toggle_transcription_send: ["Ctrl", "T"] });
    gate.resolve("native");
    assert.equal(await edit, false);
    assert.equal(state.notices.length, 1);
    assert.deepEqual(state.plugin, []);
});

test("on Wayland a key is saved without a trial in the plugin, which cannot hold keys there", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { toggle_translation: null };
    // The plugin grabs no key on native Wayland: a trial there would refuse every key.
    state.refused = ["Control+T"];
    const hook = await subject.load();
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] }), true);
    assert.deepEqual(state.plugin, []);
    assert.deepEqual(state.writes, [["/set/data/hotkeys", { toggle_translation: ["Ctrl", "T"] }]]);
});

test("an edit replaced while it waits for the plugin does not try its key", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    state.platformGate = "native";
    state.hotkeys = { toggle_translation: null };
    // A registration is clearing the plugin, so the trials wait in line behind it.
    state.unregisterGate = gate.promise;
    const hook = await subject.load();
    const registration = hook.registerShortcuts();
    await flush();
    const first = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    const second = hook.setHotkeys({ toggle_translation: ["Ctrl", "N"] });
    gate.resolve();
    assert.equal(await first, false);
    assert.equal(await second, true);
    await registration;
    assert.deepEqual(state.plugin, ["unregisterAll", "register Control+N", "unregister Control+N"]);
});

test("a key the plugin cannot take is refused as in use elsewhere", async () => {
    const subject = await setup(), { state } = subject;
    state.platformGate = "native";
    state.hotkeys = { toggle_translation: null };
    state.refused = ["Control+T"];
    const hook = await subject.load();
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] }), false);
    assert.deepEqual(state.notices, [[
        "config_page.hotkeys.error_in_use(action_name=config_page.hotkeys.toggle_translation.label(translation=main_page.translation), hotkey=Ctrl + T)"]]);
    assert.deepEqual(state.writes, []);
});

test("a refusal that arrives after the page closed is not told", async () => {
    const subject = await setup(), gate = deferred(), { state } = subject;
    state.platformGate = "native";
    state.hotkeys = { toggle_translation: null };
    state.registerGate = gate.promise;
    const hook = await subject.load();
    const edit = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
    await flush();
    state.cleanups[0]();
    gate.reject(new Error("held by another application"));
    assert.equal(await edit, false);
    assert.deepEqual(state.notices, []);
});

for (const change of ["hot reload replaces the module", "the page closes", "the backend restarts", "the action is saved from elsewhere"]) {
    test(`an edit waiting for the plugin is not saved when ${change}`, async () => {
        const subject = await setup(), gate = deferred(), { state, store } = subject;
        state.platformGate = "native";
        state.hotkeys = { toggle_translation: null };
        state.registerGate = gate.promise;
        store.backend_session = "first";
        const hook = await subject.load();
        const edit = hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] });
        await flush();
        if (change === "hot reload replaces the module") subject.dispose(0);
        else if (change === "the page closes") state.cleanups[0]();
        else if (change === "the backend restarts") store.backend_session = "second";
        else hook.setSuccessHotkeys({ toggle_translation: ["Ctrl", "Y"] });
        gate.resolve();
        assert.equal(await edit, false);
        assert.deepEqual(state.writes, []);
    });
}

test("a key is written after the hotkeys are marked pending and the last notice is closed", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { toggle_translation: null };
    const hook = await subject.load();
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] }), true);
    assert.deepEqual(state.events, ["pending", "notification closed", "/set/data/hotkeys"]);
});

for (const [write, answer, saved] of [
    ["sent with no reply of its own", true, true],
    ["that could not be sent", false, false],
    ["answered with status 200", { endpoint: "/set/data/hotkeys", status: 200, result: { toggle_translation: ["Ctrl", "T"] } }, true],
    ["answered with status 400", { endpoint: "/set/data/hotkeys", status: 400, result: "invalid" }, false],
] satisfies [string, unknown, boolean][]) {
    test(`a key write ${write} is ${saved ? "" : "not "}taken as saved`, async () => {
        const subject = await setup(), { state } = subject;
        state.hotkeys = { toggle_translation: null };
        state.writeGate = answer;
        const hook = await subject.load();
        assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] }), saved);
    });
}

test("an action whose save was answered can be edited again", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { toggle_translation: null };
    const hook = await subject.load();
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] }), true);
    hook.setSuccessHotkeys({ toggle_translation: ["Ctrl", "T"] });
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "N"] }), true);
    assert.equal(state.writes.length, 2);
});

test("a platform that cannot be told refuses the quick chat key, and is asked again next time", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { open_quick_chat: null };
    state.platformFails = true;
    const hook = await subject.load();
    assert.equal(await hook.setHotkeys({ open_quick_chat: ["Ctrl", "Q"] }), false);
    assert.deepEqual(state.notices, [["quick_chat.platform_unknown"]]);
    assert.deepEqual(state.writes, []);
    state.platformFails = false;
    assert.equal(await hook.setHotkeys({ open_quick_chat: ["Ctrl", "Q"] }), true);
    assert.equal(state.calls.filter(([command]) => command === "quick_chat_shortcut_platform").length, 2);
});

test("a platform that cannot be told still lets other keys be saved once the plugin takes them", async () => {
    const subject = await setup(), { state } = subject;
    state.hotkeys = { toggle_translation: null };
    state.platformFails = true;
    const hook = await subject.load();
    assert.equal(await hook.setHotkeys({ toggle_translation: ["Ctrl", "T"] }), true);
    assert.deepEqual(state.notices, [["quick_chat.platform_unknown"]]);
    assert.deepEqual(state.plugin, ["register Control+T", "unregister Control+T"]);
});

test("asking for the hotkeys marks them pending and asks the backend", async () => {
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    hook.getHotkeys();
    assert.deepEqual(state.events, ["pending", "/get/data/hotkeys"]);
});

test("an acknowledged save is kept without raising the saved notice", async () => {
    const subject = await setup(), { state } = subject;
    const hook = await subject.load();
    hook.setSuccessHotkeys({ open_quick_chat: ["Ctrl", "W"] });
    assert.deepEqual(state.hotkeys, { open_quick_chat: ["Ctrl", "W"] });
    assert.deepEqual(state.events, []);
});
