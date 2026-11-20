import assert from "node:assert/strict";
import * as usagePresetsModule from "../configs/usagePresets.ts";
import { readFile } from "node:fs/promises";
import { test, vi } from "vitest";
import type { ComponentProps } from "react";
import Babel from "@babel/standalone";
import React from "react";
import * as jsx from "react/jsx-runtime";
import clsx from "clsx";
import * as chatboxLength from "./chatboxLength.ts";
import * as voiceErrorText from "../voice/voiceErrorText.ts";
import * as featureLabel from "./featureLabel.ts";
import { nextLogView, rowsBetween } from "./messageLogView.ts";
import { speakerContinuations } from "./speakerNames.ts";
import * as switchBlocksModule from "../main/switchBlocks.ts";
import { find, findIn, held, isInitializer, isUpdater, loaded, refOf, typeScriptAware, unchecked } from "../test/hookHarness.ts";
import type { Slot, TreeNode } from "../test/hookHarness.ts";

type Deps = readonly unknown[] | undefined;

// Exercise the production JSX handlers without a WebView or a new test runtime.
// Hooks retain state across explicit renders; IPC promises are controlled by tests.
function hooks() {
    // Slot i belongs to the i-th hook: hooks run in the same order on every render.
    const slots: (Slot | undefined)[] = [], effects: (() => unknown)[] = [];
    let index = 0;
    const memo = <T,>(factory: () => T, deps: Deps): T => {
        const i = index++;
        const slot = slots[i];
        if (!slot || !deps || deps.some((v, n) => !Object.is(v, slot.deps?.[n]))) {
            slots[i] = { deps, value: factory() };
        }
        return held<T>(slots[i] ?? {});
    };
    const effect = (fn: () => unknown, deps?: Deps) => memo(() => {
        effects.push(fn);
    }, deps);
    const cleanups: unknown[] = [];
    const api = { ...React,
        useState: <S,>(initial: S | (() => S)): [S, (value: S | ((previous: S) => S)) => void] => {
            const i = index++;
            // React calls a function given to useState or to its setter instead of keeping it.
            if (!(i in slots)) slots[i] = { value: isInitializer(initial) ? initial() : initial };
            return [held<S>(slots[i] ?? {}), value => {
                slots[i] = { value: isUpdater(value) ? value(held<S>(slots[i] ?? {})) : value };
            }];
        },
        useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
        useMemo: memo, useCallback: <F,>(fn: F, deps: Deps) => memo(() => fn, deps),
        useEffect: effect, useLayoutEffect: effect,
    };
    function render<R>(component: () => R): R;
    function render<P, R>(component: (props: P) => R, props: P): R;
    function render<P, R>(component: (props?: P) => R, props?: P): R {
        index = 0;
        const tree = component(props);
        effects.splice(0).forEach(fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); });
        return tree;
    }
    // Like fn() for each clean-up an effect returned: a TypeError for one that is not a function.
    const runCleanup = (cleanup: unknown) => {
        if (typeof cleanup !== "function") throw new TypeError("An effect's clean-up is not a function");
        cleanup();
    };
    return { api, render, unmount: () => cleanups.splice(0).forEach(runCleanup) };
}
type LocalRuntime = ReturnType<typeof hooks>;

const icon = () => null;
// The module a view evaluates to: the test names its type (load<typeof import("...")>), and the
// harness hands back its exports as that type.
async function load<M>(path: string, runtime: LocalRuntime, imports: Record<string, unknown> = {}): Promise<M> {
    const url = new URL(`../../views/${path}`, import.meta.url);
    const source = await readFile(url, "utf8");
    // Views moving to TypeScript (ADR-010) lose their types first, as in hookHarness.ts.
    const { code } = Babel.transform(source, typeScriptAware(url, {
        presets: [["react", { runtime: "automatic" }]], plugins: ["transform-modules-commonjs"],
    }));
    const dependencies: Record<string, unknown> = { react: runtime.api, "react/jsx-runtime": jsx, clsx,
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) }, ...imports };
    const require = (name: string): unknown => {
        if (name.endsWith(".module.scss")) return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : key });
        if (name.endsWith(".css.ts") && !(name in dependencies)) return new Proxy({}, { get: (_, key) => key === "__esModule" ? true : key });
        if (name.endsWith(".svg?react")) return icon;
        if (name in dependencies) return dependencies[name];
        // A TypeScript view names its relative imports with their extension.
        const base = name.replace(/\.[jt]sx?$/, "");
        if (/^\.\.?\//.test(name) && base in dependencies) return dependencies[base];
        throw new Error(`Unexpected component dependency: ${name}`);
    };
    const exports: Record<string, unknown> = {};
    new Function("require", "exports", code ?? "")(require, exports);
    return loaded<M>(exports);
}

const button = (tree: unknown) => findIn(tree, node => node.type === "button");
const switchNode = (tree: unknown) => findIn(tree, node => node.props?.role === "switch");
type ActionButtonModule = typeof import("../../views/app/config_page/setting_section/setting_box/_components/action_button/ActionButton.tsx");
type ActionButtonProps = import("../../views/app/config_page/setting_section/setting_box/_components/action_button/ActionButton.tsx").ActionButtonProps;
const actionPath = "app/config_page/setting_section/setting_box/_components/action_button/ActionButton.tsx";

test("Settings pauses transcription with intent and restores it; user OFF has no pause intent", async () => {
    const runtime = hooks(), requests: [string, unknown][] = [];
    let open = true, memory: unknown;
    const state: Record<string, { data: boolean; state: string }> = {};
    const stores: Record<string, unknown> = { store: { backend_subprocess: {} } };
    for (const name of ["TranslationStatus", "TranscriptionSendStatus", "TranscriptionReceiveStatus", "OcrCaptureStatus", "ForegroundStatus"]) {
        state[name] = { data: true, state: "ok" };
        stores[`useStore_${name}`] = () => ({
            [`current${name}`]: state[name],
            [`pending${name}`]: () => {},
            [`update${name}`]: () => {},
        });
    }
    const { useMainFunction } = await load<typeof import("../main/useMainFunction.ts")>("../logics/main/useMainFunction.ts", runtime, {
        "@store": stores,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (endpoint: string, data?: unknown) => requests.push([endpoint, data]) }) },
    });
    const { ConfigPageCloseTriggerController } = await load<typeof import("../../views/app/_app_controllers/ConfigPageCloseTriggerController.tsx")>("app/_app_controllers/ConfigPageCloseTriggerController.tsx", runtime, {
        "@store": { useStore_MainFunctionsStateMemory: () => ({
            currentMainFunctionsStateMemory: { data: memory },
            updateMainFunctionsStateMemory: (value: unknown) => { memory = value; },
        }) },
        "@logics_main": { useMainFunction },
        "@logics_common": {
            useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: open } }),
            useVolume: () => ({ currentMicThresholdCheckStatus: { data: false }, currentSpeakerThresholdCheckStatus: { data: false } }),
        },
        "@logics_configs": { useHotkeys: () => ({ registerShortcuts() {}, unregisterAll() {} }) },
    });
    runtime.render(ConfigPageCloseTriggerController);
    assert.deepEqual(requests, [
        ["/set/disable/translation", undefined],
        ["/set/disable/transcription_send", { reason: "settings_pause" }],
        ["/set/disable/transcription_receive", { reason: "settings_pause" }],
    ]);
    requests.length = 0;
    open = false;
    runtime.render(ConfigPageCloseTriggerController);
    assert.deepEqual(requests, [
        ["/set/enable/translation", undefined],
        // Marked as a resume: the engine declines it for an input whose bundled
        // ASR server the user stopped while settings were open.
        ["/set/enable/transcription_send", { reason: "settings_resume" }],
        ["/set/enable/transcription_receive", { reason: "settings_resume" }],
    ]);
    requests.length = 0;
    // The user's own press on the switch carries no reason and is never declined.
    useMainFunction().setTranscriptionSend(true);
    assert.deepEqual(requests, [["/set/enable/transcription_send", undefined]]);
    requests.length = 0;
    useMainFunction().setTranscriptionSend(false);
    useMainFunction().setTranscriptionReceive(false);
    assert.deepEqual(requests, [
        ["/set/disable/transcription_send", undefined],
        ["/set/disable/transcription_receive", undefined],
    ]);
});
const deferred = () => {
    // The executor runs at once, so both are set before deferred returns.
    let resolve: (value?: unknown) => void = () => {}, reject: (reason?: unknown) => void = () => {};
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

test("action feedback precedes a slow operation and repeated presses send only once", async context => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), work = deferred();
    const { ActionButton } = await load<ActionButtonModule>(actionPath, runtime);
    let calls = 0;
    const props: ActionButtonProps = { IconComponent: icon, ClickedIconComponent: () => null, label: "Copy",
        onclickFunction: () => { calls++; return work.promise; } };
    const render = () => button(runtime.render(ActionButton, props));
    const initial = render();
    const pending = initial.props.onClick();
    await initial.props.onClick(); // Same handler, before React paints aria-disabled.
    const busy = render();
    assert.equal(calls, 1);
    assert.equal(busy.props["aria-busy"], true);
    assert.equal(busy.props["aria-disabled"], true);
    assert.equal(find(busy, node => node.type === props.ClickedIconComponent), null);
    work.resolve();
    await pending;
    const done = render();
    assert.equal(done.props["aria-busy"], false);
    assert.ok(find(done, node => node.type === props.ClickedIconComponent));
    await initial.props.onClick(); // Success-display cooldown also guards stale handlers.
    assert.equal(calls, 1);
    vi.advanceTimersByTime(1000);
    assert.equal(render().props["aria-disabled"], false);
    runtime.unmount();
});

test("a rejected action clears pending, reports the error and permits retry without success", async () => {
    const runtime = hooks(), work = deferred(), errors: unknown[] = [];
    const { ActionButton } = await load<ActionButtonModule>(actionPath, runtime);
    const props: ActionButtonProps = { IconComponent: icon, ClickedIconComponent: () => null,
        onclickFunction: () => work.promise, onErrorFunction: error => errors.push(error) };
    const render = () => button(runtime.render(ActionButton, props));
    const pending = render().props.onClick();
    const error = new Error("clipboard unavailable");
    work.reject(error);
    await pending;
    const failed = render();
    assert.equal(failed.props["aria-disabled"], false);
    assert.equal(failed.props["aria-busy"], false);
    assert.equal(find(failed, node => node.type === props.ClickedIconComponent), null);
    assert.deepEqual(errors, [error]);
    let retried = false;
    props.onclickFunction = () => { retried = true; };
    props.ClickedIconComponent = undefined;
    await render().props.onClick();
    assert.equal(retried, true);
    assert.equal(render().props["aria-disabled"], false);
    runtime.unmount();
});

test("an action settling after its settings page closes does not schedule success feedback", async context => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), work = deferred();
    const { ActionButton } = await load<ActionButtonModule>(actionPath, runtime);
    const props: ActionButtonProps = { IconComponent: icon, ClickedIconComponent: () => null, onclickFunction: () => work.promise };
    const pending = button(runtime.render(ActionButton, props)).props.onClick();
    runtime.unmount();
    work.resolve();
    await pending;
    vi.advanceTimersByTime(1000);
    assert.equal(find(runtime.render(ActionButton, props), node => node.type === props.ClickedIconComponent), null);
});

test("settings checkboxes reject pointer and keyboard repeats while retaining the confirmed value", async () => {
    const runtime = hooks();
    const { Checkbox } = await load<typeof import("../../views/common_components/checkbox/Checkbox.tsx")>("common_components/checkbox/Checkbox.tsx", runtime);
    let calls = 0;
    const props = { label: "Auto select", variable: { state: "pending", data: false }, toggleFunction: () => { calls++; } };
    const input = (tree: unknown) => findIn(tree, node => node.type === "input");
    for (const confirmed of [false, true]) {
        props.variable.data = confirmed;
        const control = input(runtime.render(Checkbox, props));
        let prevented = 0;
        control.props.onClick({ stopPropagation() {}, preventDefault() { prevented++; } });
        for (const key of [" ", "Enter"]) control.props.onKeyDown({ key, preventDefault() { prevented++; } });
        control.props.onChange();
        assert.equal(prevented, 3);
        assert.equal(control.props.checked, confirmed);
        assert.equal(control.props["aria-disabled"], true);
    }
    assert.equal(calls, 0);
    props.variable.state = "ok";
    input(runtime.render(Checkbox, props)).props.onChange();
    assert.equal(calls, 1);
    // With show_label the label is drawn beside the box and names it, instead of aria-label.
    const labelled = runtime.render(Checkbox, { ...props, show_label: true });
    assert.equal(input(labelled).props["aria-label"], undefined);
    assert.ok(find(labelled, node => node.type === "span" && node.props.children === "Auto select"));
});

test("main switches block pending repeats but TTS/RVC cancellation remains available", async () => {
    const runtime = hooks();
    const { SwitchContainer } = await load<typeof import("../../views/app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.tsx")>("app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.tsx", runtime, {
        "@store": { store: {} },
        "@logics_common": {},
        "../../../../../logics/common/useNotificationStatus": {},
        "../../../../../logics/voice/useVoice": {}, "../../../../../logics/voice/voiceActions.ts": { voiceActions: {}, voiceSwitchStates: { publish: () => {} } },
        "../../../../../logics/voice/routeState": {},
        "../../../../../logics/voice/rvcStartOptions": {},
        "../../../../../logics/common/featureLabel.ts": featureLabel,
        "../../../../../logics/voice/voiceErrorText.ts": voiceErrorText,
        "../../../../../logics/main/switchBlocks": switchBlocksModule,
        "../../../../../logics/main/useSwitchBlocks": { useSwitchBlocks: () => ({ blocks: {}, prepare() {} }) },
        "../../startupContext": { useIsStartingUp: () => false },
        "@logics_main": { useIsMainPageCompactMode: () => ({ currentIsMainPageCompactMode: { data: false } }) },
        "@logics_configs": { useUsagePresets: () => ({ currentUsagePresets: { data: ["all"] } }) },
        "../../../../../logics/configs/usagePresets.ts": usagePresetsModule,
        "../../../../common_components/toggle_switch/ToggleSwitch": { ToggleSwitch: icon },
    });
    let calls = 0;
    const props: Partial<ComponentProps<typeof SwitchContainer>> = { currentState: { data: false, state: "pending" }, SvgComponent: icon, toggleFunction: () => { calls++; } };
    const press = () => {
        // Test data: only the fields the switch reads in this test.
        const control = switchNode(runtime.render(SwitchContainer, unchecked<ComponentProps<typeof SwitchContainer>>(props)));
        control.props.onClick();
        control.props.onKeyDown({ key: "Enter", preventDefault() {} });
        assert.equal(control.props["aria-checked"], false);
        return control;
    };
    assert.equal(press().props["aria-disabled"], true);
    assert.equal(calls, 0);
    props.cancellable = true;
    assert.equal(press().props["aria-disabled"], false);
    assert.equal(calls, 2);
    props.disabled = true;
    assert.equal(press().props["aria-disabled"], true);
    assert.equal(calls, 2);
});

test("message actions keep the same context value and delegate to the latest existing send hook", async () => {
    const runtime = hooks(), sent: [number, string][] = [], edited: [number, string][] = [], typing: [number, string][] = [];
    let version = 0;
    const { MessageActionsProvider } = await load<typeof import("./MessageActions.tsx")>("../logics/common/MessageActions.tsx", runtime, {
        "./useMessage": { useMessage: () => {
            const currentVersion = version;
            return {
                sendMessage: (text: string) => sent.push([currentVersion, text]),
                updateMessageInputValue: (text: string) => edited.push([currentVersion, text]),
                startTyping: () => typing.push([currentVersion, "start"]),
                stopTyping: () => typing.push([currentVersion, "stop"]) };
        } },
    });
    const children = React.createElement("div");
    const initial = runtime.render(MessageActionsProvider, { children });
    version++;
    const next = runtime.render(MessageActionsProvider, { children });
    assert.equal(next.props.value, initial.props.value);
    assert.equal(next.props.children, initial.props.children);
    assert.deepEqual(sent, []);
    assert.deepEqual(edited, []);
    initial.props.value.sendMessage("resend");
    initial.props.value.updateMessageInputValue("edit");
    initial.props.value.startTyping();
    initial.props.value.stopTyping();
    assert.deepEqual(sent, [[1, "resend"]]);
    assert.deepEqual(edited, [[1, "edit"]]);
    assert.deepEqual(typing, [[1, "start"], [1, "stop"]]);
});

test("LogBox subscribes only to its log and resend setting; unchanged row props stay stable", async t => {
    const runtime = hooks(), subscriptions: string[] = [];
    const message: { id: string; status?: string; messages: { original: { message: string }; translations: { message: string }[] } } =
        { id: "first", messages: { original: { message: "hello" }, translations: [] } };
    let logs = [message];
    const actions = { sendMessage() {}, updateMessageInputValue() {} };
    // The speakers' names (#447): one stable function, so the rows' props stay the same.
    const naming = { speakerNames: {}, nameSpeakers() {} };
    const Virtualizer = () => null;
    const { LogBox } = await load<typeof import("../../views/app/main_page/main_section/message_container/log_box/LogBox.tsx")>("app/main_page/main_section/message_container/log_box/LogBox.tsx", runtime, {
        "virtua": { Virtualizer },
        "./message_container/MessageContainer": { MessageContainer: React.memo(icon) }, "./EmptyState": { EmptyState: () => null },
        "jotai": { useAtomValue: (atom: string) => { assert.equal(atom, "logs"); subscriptions.push(atom); return { data: logs }; } },
        "@store": { store: {}, Atom_MessageLogs: "logs" },
        "@logics_common": { useMessageActions: () => actions, nextLogView, rowsBetween, speakerContinuations,
            useSpeakerNaming: () => naming },
        "@logics_configs": { useSettingValue: (name: string) => { subscriptions.push(name); return { data: true }; } },
    });
    assert.equal(LogBox.$$typeof, Symbol.for("react.memo"));
    const listeners: unknown[][] = [];
    Reflect.set(globalThis, "document", { addEventListener: (...args: unknown[]) => listeners.push(args), removeEventListener() {} });
    t.onTestFinished(() => { Reflect.deleteProperty(globalThis, "document"); });
    const list = () => findIn(runtime.render(LogBox.type), node => node.type === Virtualizer).props;
    // virtua renders only the rows in view; build them all here.
    const rows = (): TreeNode[] => { const { data, children } = list(); return Array.from(data, children); };
    const initial = rows();
    const typed = rows();
    // Every prop is Object.is-equal, so React.memo skips the row.
    for (const key of Object.keys(initial[0].props)) assert.equal(typed[0].props[key], initial[0].props[key]);
    assert.deepEqual(subscriptions, ["logs", "ShowResendButton", "logs", "ShowResendButton"]);
    logs = [...logs, { ...message, id: "second" }];
    const after = rows();
    assert.equal(after.length, 2);
    for (const key of Object.keys(initial[0].props)) assert.equal(after[0].props[key], initial[0].props[key]);
    logs = [{ ...message, status: "ok", messages: { ...message.messages, translations: [{ message: "translated" }] } }, logs[1]];
    const confirmed = rows();
    assert.equal(confirmed[0].props.status, "ok");
    assert.equal(confirmed[0].props.messages, logs[0].messages);
    for (const key of Object.keys(after[1].props)) assert.equal(confirmed[1].props[key], after[1].props[key]);
    // At the cap the oldest row leaves on its own first, so virtua keeps the reading position.
    logs = [logs[1], { ...message, id: "third" }];
    const ids = (view: { data: Iterable<{ id: unknown }> }) => Array.from(view.data, row => row.id);
    const dropped = list();
    assert.deepEqual([ids(dropped), dropped.shift], [["second"], true]);
    list(); // React commits the drop; its layout effect then asks for the rest
    const appended = list();
    assert.deepEqual([ids(appended), appended.shift], [["second", "third"], false]);
    assert.equal(appended.keepMounted, undefined);
    assert.deepEqual(listeners.map(([type]) => type), ["selectionchange"]);
});

test("composer reads history only on explicit recall and sees the latest retained rows", async () => {
    const runtime = hooks(), edited: string[] = [], sent: string[] = [], typing: string[] = [], settingReads: string[] = [];
    let reads = 0, input = "", composing = false;
    let logs = [{ id: "older", category: "sent", messages: { original: { message: "older" } } },
        { category: "received", messages: { original: { message: "incoming" } } },
        { id: "newest", category: "sent", messages: { original: { message: "newest" } } }];
    const actions = { sendMessage: (text: string) => sent.push(text),
        startTyping: () => typing.push("start"), stopTyping: () => typing.push("stop") };
    const { MessageInputBox } = await load<typeof import("../../views/app/main_page/main_section/message_container/message_input_box/MessageInputBox.tsx")>("app/main_page/main_section/message_container/message_input_box/MessageInputBox.tsx", runtime, {
        "@store": { store: {}, Atom_MessageLogs: "logs", useStore_MessageInputValue: () => ({
            currentMessageInputValue: { data: input }, updateMessageInputValue: (text: string) => { input = text; edited.push(text); },
        }) },
        "jotai": { useStore: () => ({ get: (atom: string) => { assert.equal(atom, "logs"); reads++; return { data: logs }; } }) },
        "@logics_common": { useMessageActions: () => actions },
        "@logics_configs": { useSettingValue: (name: string) => {
            settingReads.push(name);
            return { data: name === "SendMessageButtonType" ? "show" : true };
        } },
        "@logics_main": { useMessageLogScroll: () => ({ scrollToBottom() {} }) },
        "../../../../../../logics/common/chatboxLength": chatboxLength,
        "./ChatboxLengthWarning": { CHATBOX_LENGTH_WARNING_ID: "chatbox_length_warning" },
    });
    assert.equal(MessageInputBox.$$typeof, Symbol.for("react.memo"));
    const render = () => findIn(runtime.render(MessageInputBox.type), node => node.type === "textarea");
    const key = (name: string, shiftKey = false) => render().props.onKeyDown({ key: name, keyCode: name === "Enter" ? 13 : 0,
        shiftKey, nativeEvent: { isComposing: composing }, preventDefault() {} });
    render();
    key("a");
    render().props.onChange({ currentTarget: { value: "a" } });
    assert.equal(reads, 0);
    assert.deepEqual(typing, ["stop", "start"]);
    assert.deepEqual([...new Set(settingReads)], ["EnableAutoClearMessageInputBox", "SendMessageButtonType"]);
    key("ArrowUp", true);
    assert.equal(input, "newest");
    key("ArrowUp", true);
    assert.equal(input, "older");
    key("ArrowDown", true);
    assert.equal(input, "newest");
    key("ArrowDown", true);
    assert.equal(input, "a");
    // Retention/clear and incoming captions need no composer subscription.
    logs = [{ id: "after", category: "sent", messages: { original: { message: "after cap/clear" } } }];
    key("ArrowUp", true);
    assert.equal(input, "after cap/clear");
    const readsBeforeIme = reads;
    composing = true;
    key("ArrowUp", true);
    key("Enter");
    assert.equal(reads, readsBeforeIme);
    assert.deepEqual(sent, []);
    composing = false;
    key("Enter");
    assert.deepEqual(sent, ["after cap/clear"]);
    assert.equal(input, "");
    assert.equal(reads, readsBeforeIme);
});

test("the window geometry controller keeps its listeners and only sends layout changes", async t => {
    const runtime = hooks(), listened: string[] = [], disposed: string[] = [], updates: boolean[] = [];
    let width = 870, scaling = 100;
    const listen = (name: string) => () => { listened.push(name); return Promise.resolve(() => disposed.push(name)); };
    const appWindow = { innerSize: async () => ({ width }), onResized: listen("resized"), onMoved: listen("moved") };
    const attributes = new Set<string>();
    Reflect.set(globalThis, "document", { documentElement: {
        hasAttribute: (name: string) => attributes.has(name),
        toggleAttribute: (name: string, on: boolean) => { if (on) attributes.add(name); else attributes.delete(name); },
    } });
    t.onTestFinished(() => { Reflect.deleteProperty(globalThis, "document"); });
    const { WindowGeometryController } = await load<typeof import("./useWindow.ts")>("../logics/common/useWindow.ts", runtime, {
        "@tauri-apps/api/window": {},
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython() {} }) },
        "@store": { store: { appWindow }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint: (value: boolean) => updates.push(value) }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: scaling } }) },    });
    const settle = () => new Promise(resolve => setTimeout(resolve));
    // A module-level component: re-rendering its parent must not remount it.
    for (let i = 0; i < 3; i++) runtime.render(WindowGeometryController);
    await settle();
    assert.deepEqual(listened, ["resized", "moved"]);
    assert.deepEqual(updates, []); // 870 px at 100 % is wide, as the layout already is
    width = 700; scaling = 120;
    runtime.render(WindowGeometryController);
    await settle();
    runtime.render(WindowGeometryController);
    await settle();
    assert.deepEqual(updates, [true]);
    assert.deepEqual(listened, ["resized", "moved"]);
    runtime.unmount();
    await settle();
    assert.deepEqual(disposed, ["resized", "moved"]);
});

test("while the engine starts, resizing updates the layout but does not save the window geometry", async t => {
    const runtime = hooks(), handlers: { resized?: () => void; moved?: () => void } = {}, sent: [string, unknown][] = [], updates: boolean[] = [];
    const appWindow = { innerSize: async () => ({ width: 700 }), isMinimized: async () => false,
        outerPosition: async () => ({ x: 1, y: 2 }), outerSize: async () => ({ width: 700, height: 500 }),
        onResized: (handler: () => void) => { handlers.resized = handler; return Promise.resolve(() => {}); },
        onMoved: (handler: () => void) => { handlers.moved = handler; return Promise.resolve(() => {}); } };
    const attributes = new Set<string>();
    Reflect.set(globalThis, "document", { documentElement: { hasAttribute: (name: string) => attributes.has(name),
        toggleAttribute: (name: string, on: boolean) => { if (on) attributes.add(name); else attributes.delete(name); } } });
    t.onTestFinished(() => { Reflect.deleteProperty(globalThis, "document"); });
    const { WindowGeometryController } = await load<typeof import("./useWindow.ts")>("../logics/common/useWindow.ts", runtime, {
        "@tauri-apps/api/window": {},
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (endpoint: string, data?: unknown) => sent.push([endpoint, data]) }) },
        "@store": { store: { appWindow }, useStore_IsBreakPoint: () => ({ updateIsBreakPoint: (value: boolean) => updates.push(value) }) },
        "@logics_configs": { useAppearance: () => ({ currentUiScaling: { data: 100 } }) },    });
    const settle = () => new Promise(resolve => setTimeout(resolve, 250));
    runtime.render(WindowGeometryController, { saveGeometry: false });
    await settle();
    assert.deepEqual(updates, [true], "the narrow layout applies from the first frame");
    assert.ok(handlers.resized && handlers.moved);
    handlers.resized(); handlers.moved();
    await settle();
    assert.deepEqual(sent, []);
    runtime.render(WindowGeometryController, { saveGeometry: true });
    assert.ok(handlers.moved);
    handlers.moved();
    await settle();
    assert.deepEqual(sent, [["/set/data/main_window_geometry", { x_pos: 1, y_pos: 2, width: 700, height: 500 }]]);
    runtime.unmount();
});

test("opening and closing settings keeps the same MainSection type and key mounted", async () => {
    const runtime = hooks();
    let open = false;
    const MainSection = () => null;
    const VrchatOscHint = () => null;
    const { MainPage } = await load<typeof import("../../views/app/main_page/MainPage.tsx")>("app/main_page/MainPage.tsx", runtime, {
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: open } }) },
        "./sidebar_section/SidebarSection": { SidebarSection: icon },
        "./main_section/MainSection": { MainSection },
        "./startupContext": { StartupContext: { Provider: "startup-provider" } },
        "./main_section/message_container/log_box/StartupProgress": { StartupProgress: icon },
        "./vrchatHintContext": { VrchatHintContext: { Provider: "vrchat-hint-provider" } },
        "../others/vrchat_presence/VrchatOscHint": { VrchatOscHint },
    });
    const focusFallback = { current: null };
    const first = runtime.render(MainPage, { focusFallback });
    const initial = findIn(first, node => node.type === MainSection);
    // The main window hands the empty conversation its line about VRChat; the VR panel has no such provider.
    assert.equal(findIn(first, node => node.type === "vrchat-hint-provider").props.value, VrchatOscHint);
    for (const state of [true, false]) {
        open = state;
        const page = runtime.render(MainPage, { focusFallback });
        const section = findIn(page, node => node.type === MainSection);
        assert.equal(refOf(page), focusFallback);
        assert.equal(page.props.tabIndex, -1, "quick-dialog fallback is programmatically focusable");
        assert.equal(page.props["aria-hidden"], state);
        // The packaged-app tests find the page and which one shows by these, not by hashed class names.
        assert.equal(page.props["data-main-page"], "");
        assert.equal(page.props["data-showing"], state ? "config" : "main");
        assert.equal(section.type, initial.type);
        assert.equal(section.key, initial.key);
    }
});

test("memoized log rows expose pending status and keep edit/resend explicit", async () => {
    const runtime = hooks(), sent: string[] = [], edited: string[] = [];
    const menu = () => null;
    const { MessageContainer } = await load<typeof import("../../views/app/main_page/main_section/message_container/log_box/message_container/MessageContainer.tsx")>("app/main_page/main_section/message_container/log_box/message_container/MessageContainer.tsx", runtime, {
        "@store": { store: {} },
        "./message_sub_menu_container/MessageSubMenuContainer": { MessageSubMenuContainer: menu },
        "./SpeakerNames": { speakersText: () => "", SpeakerNamesEditor: () => null },
        // A row must not subscribe to the global log/input or settings hooks.
    });
    assert.equal(MessageContainer.$$typeof, Symbol.for("react.memo"));
    type Props = ComponentProps<typeof MessageContainer.type>;
    const props: Omit<Props, "id"> = { messages: { original: { message: "hello", transliteration: [] }, translations: [] },
        status: "pending", category: "sent", created_at: "12:00", showResendButton: true,
        // Test data: stand-ins that record what the row gives them.
        sendMessage: unchecked<Props["sendMessage"]>((text: string) => sent.push(text)),
        // Test data: the same for the text put back into the composer.
        updateMessageInputValue: unchecked<Props["updateMessageInputValue"]>((text: string) => edited.push(text)) };
    // Test data: a row without an id, which this test does not read.
    const render = () => runtime.render(MessageContainer.type, unchecked<Props>(props));
    assert.ok(find(render(), node => node.props?.className === "loader"));
    assert.deepEqual(sent, []);
    const controls = findIn(render(), node => node.type === menu);
    controls.props.editFunction();
    controls.props.resendFunction();
    assert.deepEqual(edited, ["hello"]);
    assert.deepEqual(sent, ["hello"]);
    props.status = "ok";
    assert.equal(find(render(), node => node.props?.className === "loader"), null);
    props.showResendButton = false;
    assert.equal(find(render(), node => node.type === menu), null);
});
