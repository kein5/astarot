import assert from "node:assert/strict";
import { HARNESS_QUERY, HOT_DEPENDENCY } from "./harnessModules.ts";
import type { BabelOptions } from "@babel/standalone";
import React from "react";
import type { JSX, ReactElement } from "react";
import * as jsx from "react/jsx-runtime";
import clsx from "clsx";
import { atom, createStore } from "jotai/vanilla";
import * as settingsWindowModule from "../common/settingsWindow.ts";
import * as noticeScopeModule from "../common/noticeScope.ts";
import * as breakPointModule from "../common/breakPoint.ts";
import type { Atom, PrimitiveAtom } from "jotai/vanilla";
import type { TestContext } from "vitest";

type Deps = readonly unknown[] | undefined;
type Store = ReturnType<typeof createStore>;
// One hook's memory: the dependencies it last ran with, and its value or its effect's clean-up.
export interface Slot {
    deps?: Deps;
    value?: unknown;
    cleanup?: unknown;
    // An effect's slot: a layout effect's, or a passive one's.
    layout?: boolean;
}
type SetState<S> = (value: S | ((previous: S) => S)) => void;

// A slot holds what its hook put there. Hooks run in the same order on every render (React's
// rule, which the views keep), so slot i always belongs to the same hook and holds its type. This
// overload is the one place that says so.
export function held<T>(slot: Slot): T;
export function held(slot: Slot): unknown {
    return slot.value;
}

// React calls a function given to useState or to its setter instead of keeping it.
export function isUpdater<S>(value: S | ((previous: S) => S)): value is (previous: S) => S;
export function isUpdater(value: unknown): boolean {
    return typeof value === "function";
}
export function isInitializer<S>(value: S | (() => S)): value is () => S;
export function isInitializer(value: unknown): boolean {
    return typeof value === "function";
}

// Like `cleanup?.()`: nothing for null or undefined, a TypeError for any other value that is not
// a function.
const runCleanup = (cleanup: unknown) => {
    if (cleanup === undefined || cleanup === null) return;
    if (typeof cleanup !== "function") throw new TypeError("An effect's clean-up is not a function");
    cleanup();
};

// An effect waiting for the end of a render: its slot, and what to run.
interface PendingEffect {
    index: number;
    deps: Deps;
    run: () => unknown;
}

// Explicit renders exercise production handlers without a browser. Effects clean
// up on dependency changes as well as unmount, so listener churn is observable. As in React, a
// render's layout effects (useLayoutEffect) run before its passive ones (useEffect); for each
// kind, the clean-ups of the effects that run again come first, then the effects, each in the
// order the component calls them. Unmounting cleans up the layout effects before the passive ones.
export function hooks() {
    const slots: (Slot | undefined)[] = [], layoutEffects: PendingEffect[] = [], passiveEffects: PendingEffect[] = [];
    const targets: Atom<unknown>[] = [];
    // Each atom's setter, kept as a slot's value: the one made for that atom, of its type.
    const setters = new Map<Atom<unknown>, Slot>();
    let index = 0, store: Store = createStore();
    const changed = (slot: Slot | undefined, deps: Deps) => !slot || !deps || deps.length !== slot.deps?.length ||
        deps.some((value, i) => !Object.is(value, slot.deps?.[i]));
    const memo = <T>(factory: () => T, deps: Deps): T => {
        const i = index++;
        if (changed(slots[i], deps)) slots[i] = { deps, value: factory() };
        const slot = slots[i];
        return held<T>(slot ?? {});
    };
    const effect = (queue: PendingEffect[]) => (run: () => unknown, deps?: Deps) => {
        const i = index++;
        if (changed(slots[i], deps)) queue.push({ index: i, deps, run });
    };
    const runEffects = (queue: PendingEffect[], layout: boolean) => {
        const pending = queue.splice(0);
        for (const { index: i } of pending) runCleanup(slots[i]?.cleanup);
        for (const { index: i, deps, run } of pending) slots[i] = { deps, cleanup: run(), layout };
    };
    // Every effect's clean-up, the layout effects' first.
    const cleanUp = () => {
        for (const layout of [true, false]) {
            for (const slot of slots) {
                if (!slot || (slot.layout ?? false) !== layout) continue;
                runCleanup(slot.cleanup);
                slot.cleanup = undefined;
            }
        }
    };
    const api = { ...React,
        useState: <S>(initial: S | (() => S)): [S, SetState<S>] => {
            const i = index++;
            if (!(i in slots)) slots[i] = { value: isInitializer(initial) ? initial() : initial };
            // The setter finds its slot when it is called, as slots[i] did: after a remount it writes to
            // the slot drawn again, and before that it stops with a TypeError.
            return [held<S>(slots[i] ?? {}), value => {
                const slot = slots[i];
                if (!slot) throw new TypeError(`No hook slot ${i}`);
                slot.value = isUpdater(value) ? value(held<S>(slot)) : value;
            }];
        },
        useRef: <T>(initial: T) => memo(() => ({ current: initial }), []),
        useId: () => memo(() => `test-${index}`, []),
        useMemo: memo, useCallback: <F>(fn: F, deps: Deps) => memo(() => fn, deps),
        useEffect: effect(passiveEffects), useLayoutEffect: effect(layoutEffects),
    };
    const jotai = {
        atom: <T>(initial: T): PrimitiveAtom<T> => { const target = atom(initial); targets.push(target); return target; },
        useStore: () => store,
        useAtom: <T>(target: PrimitiveAtom<T>): [T, (value: T) => void] => {
            if (!setters.has(target)) setters.set(target, { value: (value: T) => store.set(target, value) });
            return [store.get(target), held<(value: T) => void>(setters.get(target) ?? {})];
        },
    };
    // Draws a component, or runs a hook, once: as React would for one render of it.
    function render<R>(component: () => R): R;
    function render<P, R>(component: (props: P) => R, props: P, attach?: (tree: R) => void): R;
    function render<P, R>(component: (props?: P) => R, props?: P, attach: (tree: R) => void = () => {}): R {
        index = 0;
        const tree = component(props);
        attach(tree);
        runEffects(layoutEffects, true);
        runEffects(passiveEffects, false);
        return tree;
    }
    return { api, jotai, targets, get store() { return store; }, set store(value: Store) { store = value; },
        render,
        unmount: cleanUp,
        // Drawn again from scratch, as a changed React key does: the component's own state
        // goes; the atoms' store stays.
        remount: () => {
            cleanUp();
            slots.length = 0;
        },
    };
}
export type HookRuntime = ReturnType<typeof hooks>;

// Sources moving to TypeScript (ADR-010) lose their types first; the JSX and module
// transforms then run as for JavaScript.
export function typeScriptAware(url: URL | string, options: BabelOptions): BabelOptions {
    const name = String(url);
    if (!/\.tsx?$/.test(name)) return options;
    return { ...options, filename: name.endsWith(".tsx") ? "module.tsx" : "module.ts",
        presets: [...options.presets ?? [], ["typescript", { onlyRemoveTypeImports: false }]] };
}

// The module a source evaluates to. The test names the source's own module type
// (loadModule<typeof import("./Foo.tsx")>): the harness runs that source with the dependencies the
// test hands it, and the source's exports keep their declared types. This overload is the one
// place that says so; nothing checks it while the module runs.
export function loaded<M>(exports: Record<string, unknown>): M;
export function loaded(exports: Record<string, unknown>): unknown {
    return exports;
}

// The kit's parts (views/kit) as a screen draws them, unless the test hands in its own. The kit's
// looks are vanilla-extract recipes, which only the app's build can make, so each stand-in draws
// the element the part draws, with the part's data-slot and defaults, and keeps the look it was
// asked for as data attributes (data-tone, data-size): a test reads which look a control asked
// for, and the class a screen added for its place, as it reads every other class (hookHarness.test.ts
// holds the stand-ins to the kit's defaults).
export const kitStandIns = {
    Button: ({ tone = "plain", size = "regular", type = "button", ...rest }: Record<string, unknown>) =>
        jsx.jsx("button", { type, "data-slot": "button", "data-tone": tone, "data-size": size, ...rest }),
    // The kit's field marks a wrong value with aria-invalid and an address with the monospaced font.
    TextField: ({ invalid = false, mono = false, type = "text", ...rest }: Record<string, unknown>) =>
        jsx.jsx("input", { type, "data-slot": "input", "aria-invalid": invalid || undefined, "data-mono": mono, ...rest }),
    // The kit's switch is Radix's: a <button role="switch"> whose aria-checked and data-state follow checked.
    Switch: ({ checked = false, ...rest }: Record<string, unknown>) =>
        jsx.jsx("button", { type: "button", role: "switch", "aria-checked": checked, "data-state": checked ? "checked" : "unchecked",
            "data-slot": "switch", ...rest }),
    // The kit's select is a native <select> named data-slot="native-select"; aria-invalid only while the value is wrong.
    Select: ({ invalid = false, ...rest }: Record<string, unknown>) =>
        jsx.jsx("select", { "data-slot": "native-select", "aria-invalid": invalid || undefined, ...rest }),
    SelectOption: (props: Record<string, unknown>) => jsx.jsx("option", { "data-slot": "native-select-option", ...props }),
    SelectOptGroup: (props: Record<string, unknown>) => jsx.jsx("optgroup", { "data-slot": "native-select-optgroup", ...props }),
    // The kit's toggle is Radix's: a <button> whose aria-pressed and data-state follow pressed; the
    // accent tone and the regular size unless asked.
    Toggle: ({ pressed = false, tone = "accent", size = "regular", ...rest }: Record<string, unknown>) =>
        jsx.jsx("button", { type: "button", "aria-pressed": pressed, "data-state": pressed ? "on" : "off", "data-slot": "toggle",
            "data-tone": tone, "data-size": size, ...rest }),
    ToggleGroup: (props: Record<string, unknown>) => jsx.jsx("div", { role: "group", "data-slot": "toggle-group", ...props }),
    ToggleGroupItem: (props: Record<string, unknown>) => jsx.jsx("button", { type: "button", "data-slot": "toggle-group-item", ...props }),
    // The kit's popover: its parts in place, the content drawn whether open or not, so a test reads it.
    Popover: ({ children }: Record<string, unknown>) => children,
    PopoverTrigger: (props: Record<string, unknown>) => jsx.jsx("button", { type: "button", "data-slot": "popover-trigger", ...props }),
    PopoverAnchor: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "popover-anchor", ...props }),
    PopoverContent: ({ portal: _portal, inset: _inset, ...rest }: Record<string, unknown>) =>
        jsx.jsx("div", { "data-slot": "popover-content", ...rest }),
    // The kit's progress bar is the system's <progress> named data-slot="progress"; no value, no amount (indeterminate).
    Progress: (props: Record<string, unknown>) => jsx.jsx("progress", { "data-slot": "progress", ...props }),
    // The kit's Item list: a <ul> of <li> rows, each with the look it asked for (data-variant,
    // data-size); a mark drawn for a state is hidden from screen readers, as its words say it.
    ItemGroup: ({ variant = "default", size = "default", ...rest }: Record<string, unknown>) =>
        jsx.jsx("ul", { "data-slot": "item-group", "data-variant": variant, "data-size": size, ...rest }),
    Item: ({ variant = "default", size = "default", ...rest }: Record<string, unknown>) =>
        jsx.jsx("li", { "data-slot": "item", "data-variant": variant, "data-size": size, ...rest }),
    ItemMedia: ({ state, ...rest }: Record<string, unknown>) =>
        jsx.jsx("div", { "data-slot": "item-media", "data-state": state, "aria-hidden": state ? "true" : undefined, ...rest }),
    ItemContent: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "item-content", ...props }),
    ItemTitle: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "item-title", ...props }),
    ItemDescription: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "item-description", ...props }),
    ItemActions: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "item-actions", ...props }),
    // The kit's card: a <div>, or an <li> when it is one item of a list; the one in use asks for the active look.
    Card: ({ as, active = false, ...rest }: Record<string, unknown>) =>
        jsx.jsx(as === "li" ? "li" : "div", { "data-slot": "card", "data-active": active, ...rest }),
    CardHeader: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "card-header", ...props }),
    CardTitle: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "card-title", ...props }),
    CardDescription: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "card-description", ...props }),
    CardContent: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "card-content", ...props }),
    CardFooter: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "card-footer", ...props }),
    // The kit's badge: a <span> with its words, a neutral outline unless it asks for another look.
    Badge: ({ tone = "neutral", variant = "outline", mark, ...rest }: Record<string, unknown>) =>
        jsx.jsx("span", { "data-slot": "badge", "data-tone": tone, "data-variant": variant, "data-mark": mark, ...rest }),
    // The kit's confirmation inside a row: the root draws only what it holds; the trigger is a
    // Button in the row's look; the content a named group; the way back a plain Button that takes
    // the focus; the removal a danger Button.
    InlineConfirm: ({ children }: Record<string, unknown>) => children,
    InlineConfirmTrigger: ({ tone = "plain", size = "regular", type = "button", ...rest }: Record<string, unknown>) =>
        jsx.jsx("button", { type, "data-slot": "button", "data-tone": tone, "data-size": size, ...rest }),
    InlineConfirmContent: (props: Record<string, unknown>) => jsx.jsx("div", { role: "group", "data-slot": "inline-confirm-content", ...props }),
    InlineConfirmDescription: (props: Record<string, unknown>) => jsx.jsx("p", { "data-slot": "inline-confirm-description", ...props }),
    InlineConfirmCancel: ({ size = "regular", type = "button", ...rest }: Record<string, unknown>) =>
        jsx.jsx("button", { type, autoFocus: true, "data-slot": "button", "data-tone": "plain", "data-size": size, ...rest }),
    InlineConfirmAction: ({ size = "regular", type = "button", ...rest }: Record<string, unknown>) =>
        jsx.jsx("button", { type, "data-slot": "button", "data-tone": "danger", "data-size": size, ...rest }),
    // The kit's textarea is a <textarea> named data-slot="textarea", marked as the text field is, in a form's shape unless it fills its
    // screen, with a frame of its own unless it sits in its screen's frame.
    Textarea: ({ invalid = false, mono = false, fill = false, inFrame = false, ...rest }: Record<string, unknown>) =>
        jsx.jsx("textarea", { "data-slot": "textarea", "aria-invalid": invalid || undefined, "data-mono": mono, "data-fill": fill,
            "data-in-frame": inFrame, ...rest }),
    // The kit's choice card: a <label> round a native radio, what the card shows and the choice's name.
    ChoiceCard: ({ title, children, className, ...input }: Record<string, unknown>) =>
        jsx.jsxs("label", { "data-slot": "field-label", className, children: [
            jsx.jsx("input", { "data-slot": "radio-group-item", ...input, type: "radio" }), children,
            jsx.jsx("span", { "data-slot": "field-title", children: title })] }),
    // The kit's dialog is a <dialog> named data-slot="dialog-content"; open and onOpenChange are the
    // owner's, read by a test from the element the screen draws, and do not reach the <dialog>.
    Dialog: ({ open: _open, onOpenChange: _onOpenChange, ...rest }: Record<string, unknown>) =>
        jsx.jsx("dialog", { "data-slot": "dialog-content", ...rest }),
    DialogHeader: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "dialog-header", ...props }),
    DialogTitle: (props: Record<string, unknown>) => jsx.jsx("h2", { "data-slot": "dialog-title", ...props }),
    DialogDescription: (props: Record<string, unknown>) => jsx.jsx("p", { "data-slot": "dialog-description", ...props }),
    DialogFooter: (props: Record<string, unknown>) => jsx.jsx("div", { "data-slot": "dialog-footer", ...props }),
};

// A module as the harness builds it: a function of require and exports (harnessModules.ts).
const buildModule = async (url: URL): Promise<(...args: unknown[]) => unknown> => {
    const built: unknown = Reflect.get(await import(/* @vite-ignore */ `${url.href}?${HARNESS_QUERY}`), "default");
    if (typeof built !== "function") throw new TypeError(`${url.pathname} did not build into a function`);
    return built as (...args: unknown[]) => unknown;
};
const run = (built: (...args: unknown[]) => unknown, require: (name: string) => unknown) => {
    const exports: Record<string, unknown> = {};
    Reflect.apply(built, undefined, [require, exports]);
    return exports;
};

// The settings openers every window shares (#1236), unless the test hands in its own. Outside the
// app the settings open in-page, so the real modules are used: settingsWindow.ts and noticeScope.ts
// as they are, and useOpenSettings with its showSetting built here on the test's own stand-ins (its
// @store, and a revealSetting or useOcrSetup it gave under any path), so a test of a module that
// opens the settings sees the tab, the page and the setting as before.
const settingsOpeners = (async () => ({
    useOpenSettings: await buildModule(new URL("../common/useOpenSettings.ts", import.meta.url)),
    useIsOpenedConfigPage: await buildModule(new URL("../common/useIsOpenedConfigPage.ts", import.meta.url)),
    showSetting: await buildModule(new URL("../common/showSetting.ts", import.meta.url)),
}))();
const named = (name: string, module: string) => new RegExp(`(^|/)${module}(\\.[jt]sx?)?$`).test(name);
const sharedModule = (name: string, dependencies: Record<string, unknown>,
    openers: Awaited<typeof settingsOpeners>): unknown => {
    if (named(name, "settingsWindow")) return settingsWindowModule;
    if (named(name, "noticeScope")) return noticeScopeModule;
    if (named(name, "breakPoint")) return breakPointModule;
    if (!named(name, "useOpenSettings") && !named(name, "showSetting")) return undefined;
    // A stand-in the test gave for a module of that name, wherever it imported it from.
    const given = (module: string) => Object.entries(dependencies).find(([key]) => named(key, module))?.[1];
    const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? { ...value } : {};
    const require = (dependency: string): unknown => {
        // The test's @store; a test that does not look at the settings' tab gives none.
        if (dependency === "@store") return { useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: () => {} }),
            ...record(dependencies["@store"]) };
        if (named(dependency, "settingsWindow")) return settingsWindowModule;
        if (named(dependency, "useIsOpenedConfigPage")) {
            // The test's own, when it gave one in @logics_common; else the real one over its @store.
            const common = record(dependencies["@logics_common"]).useIsOpenedConfigPage;
            if (typeof common !== "function") return run(openers.useIsOpenedConfigPage, require);
            return { useIsOpenedConfigPage: () => {
                const hook = record(common());
                return { ...hook, setIsOpenedConfigPage: hook.setIsOpenedConfigPage ?? hook.updateIsOpenedConfigPage };
            } };
        }
        if (named(dependency, "showSetting")) return given("showSetting") ?? run(openers.showSetting, require);
        if (named(dependency, "revealSetting")) return { revealSetting: () => {}, ...record(given("revealSetting")) };
        if (named(dependency, "useOcrSetup")) return { OCR_MODELS_SETTING_ID: "ocr_models", focusOcrModels: () => {}, ...record(given("useOcrSetup")) };
        throw new Error(`Unexpected dependency: ${dependency}`);
    };
    return run(named(name, "useOpenSettings") ? openers.useOpenSettings : openers.showSetting, require);
};

export async function loadModule<M = Record<string, unknown>>(url: URL, runtime: HookRuntime, imports: Record<string, unknown> = {}): Promise<M> {
    // Vite builds the source into a function of require and exports (harnessModules.ts).
    const built = await buildModule(url);
    const openers = await settingsOpeners;
    const dependencies: Record<string, unknown> = { react: runtime.api, "react/jsx-runtime": jsx, clsx, jotai: runtime.jotai,
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async () => true }) }, [HOT_DEPENDENCY]: undefined, ...imports };
    const require = (name: string): unknown => {
        // vanilla-extract style modules: each export is its class name.
        if (name.endsWith(".css.ts") && !(name in dependencies)) return new Proxy({}, { get: (_, key) => key === "__esModule" ? true : key });
        if (name.endsWith(".svg?react")) return () => null;
        if (name in dependencies) return dependencies[name];
        // The common tooltip around a control, unless the test hands in its own: an element named
        // "tooltip" that keeps its words (title), its side and the control it wraps, so a test reads
        // what the bubble says without a page to draw it on.
        if (/^(\.\.?\/)+(views\/)?common_components\/tooltip\/Tooltip(\.tsx)?$/.test(name)) return { Tooltip: "tooltip" };
        // The kit, by its index (views/kit/index.ts): the stand-ins above.
        if (/^(\.\.\/)+(views\/)?kit\/index\.ts$/.test(name)) return kitStandIns;
        // While modules move from .js to .ts (ADR-010), a test may still name a dependency
        // with its old extension, or with none, as the importing module once did.
        const base = name.replace(/\.[jt]sx?$/, "");
        const alias = [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`].find(key => key in dependencies);
        if (alias !== undefined && /^\.\.?\//.test(name)) return dependencies[alias];
        const shared = /^\.\.?\//.test(name) ? sharedModule(name, dependencies, openers) : undefined;
        if (shared !== undefined) return shared;
        throw new Error(`Unexpected dependency: ${name}`);
    };
    return loaded<M>(run(built, require));
}

// A value a test gives the code under test without the declared type: test data with only the
// fields the code reads, or a value of the wrong shape given on purpose to see how the code copes.
// The test says which beside the call. This overload is the one place that declares such values;
// tests use it instead of casts.
export function unchecked<T>(value: unknown): T;
export function unchecked(value: unknown): unknown {
    return value;
}

// A rendered tree, as React types it: an element's props are whatever its component was given.
// React 18's ReactElement said so by default; React 19 says it on JSX.Element, the type of what a
// component draws, so the props come from there and the type of the element stays as before.
export type TreeNode = ReactElement<JSX.Element["props"]>;

// Every object in a rendered tree is an element: React.Children.toArray keeps only elements among
// the objects it is given. The search below reads the objects it meets as elements, as it always
// did; this overload is the one place that says so.
function asNode(value: object): TreeNode;
function asNode(value: object): object {
    return value;
}

export function find(tree: unknown, predicate: (node: TreeNode) => boolean): TreeNode | null {
    if (!tree || typeof tree !== "object") return null;
    const node = asNode(tree);
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
        const found = find(child, predicate);
        if (found) return found;
    }
    return null;
}

// The node the predicate picks, or the test fails there with an AssertionError. A test that read
// a node it did not find stopped with a TypeError at the same place before.
export function findIn(tree: unknown, predicate: (node: TreeNode) => boolean, what = "node"): TreeNode {
    const node = find(tree, predicate);
    assert.ok(node, `the tree holds no ${what}`);
    return node;
}

// Every node of a rendered tree, in the order find visits them.
export function nodesIn(tree: unknown): TreeNode[] {
    const nodes: TreeNode[] = [];
    find(tree, node => { nodes.push(node); return false; });
    return nodes;
}

// An object of a rendered tree as the element it is (asNode), or null for text, numbers and the
// like.
export function treeNode(value: unknown): TreeNode | null {
    return value && typeof value === "object" ? asNode(value) : null;
}

// The name of the function component an element draws, or null for an element of a tag.
export function componentName(node: TreeNode): string | null {
    return typeof node.type === "function" ? node.type.name : null;
}

// A component a test draws itself: the type of an element of the code under test that is one of
// its own function components, or a component the module exports under a name the test picks.
// What such a component takes and draws is what the test gives it and reads back: this overload
// is the one place that says so.
export type DrawnComponent = (props?: unknown) => TreeNode;
function asComponent(value: unknown): DrawnComponent;
function asComponent(value: unknown): unknown {
    return value;
}
export function componentOf(node: TreeNode): DrawnComponent {
    if (typeof node.type !== "function") throw new TypeError(`${String(node.type)} is not a function component`);
    return asComponent(node.type);
}
export function componentNamed(module: object, name: string): DrawnComponent {
    const component: unknown = Reflect.get(module, name);
    if (typeof component !== "function") throw new TypeError(`${name} is not a function`);
    return asComponent(component);
}
// Draws an element of the code's own components as React would: its type called with its props.
export const draw = (node: TreeNode, props: unknown = node.props) => componentOf(node)(props);
// The same, drawn by a runtime of the harness, so its hooks run there.
export const drawWith = (runtime: HookRuntime, node: TreeNode, props: unknown = node.props) => runtime.render(componentOf(node), props);

// An element's ref. React 19 passes it among the props; reading element.ref warns that it is
// going away.
export const refOf = (node: TreeNode): unknown => fieldOf(node.props, "ref");
// Puts the value where React would put the element it draws: into its ref object, or through its
// ref function. An element without a ref stops with a TypeError, as setting .current on it did.
export function setRef(node: TreeNode, value: unknown) {
    const ref = refOf(node);
    if (typeof ref === "function") ref(value);
    else if (ref && typeof ref === "object") Reflect.set(ref, "current", value);
    else throw new TypeError("the element has no ref");
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
// value?.[key]?.[...] for an unknown value: undefined wherever a level is missing.
export function fieldOf(value: unknown, ...keys: string[]): unknown {
    let current = value;
    for (const key of keys) {
        if ((typeof current !== "object" && typeof current !== "function") || current === null) return undefined;
        current = Reflect.get(current, key);
    }
    return current;
}

// A fake timer's handle. The fakes number their timers, as the browser does; the declared handle
// type is Node's or the code's own. This overload is the one place that says so.
export function timerHandle<T = ReturnType<typeof setTimeout>>(id: number): T;
export function timerHandle(id: number): unknown {
    return id;
}
// The number of a fake timer's handle.
export function timerNumber(handle: unknown): number {
    if (typeof handle !== "number") throw new TypeError("not a fake timer's handle");
    return handle;
}
// A fake for the global setTimeout or setInterval, which spyOn's mockImplementation takes as the
// global's own (overloaded) type. The fakes take a callback and a delay and return a number.
type TimerFake = (callback: () => void, delay?: number) => unknown;
export function asTimerFunction<K extends "setTimeout" | "setInterval">(_name: K, fake: TimerFake): (typeof globalThis)[K];
export function asTimerFunction(_name: string, fake: TimerFake): unknown {
    return fake;
}

type Listener = (event: unknown) => unknown;

export function eventTarget() {
    const listeners = new Map<string, Set<Listener>>(), added: [string, Listener][] = [], removed: [string, Listener][] = [];
    return { added, removed,
        addEventListener: (type: string, fn: Listener) => {
            added.push([type, fn]);
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)?.add(fn);
        },
        removeEventListener: (type: string, fn: Listener) => { removed.push([type, fn]); listeners.get(type)?.delete(fn); },
        dispatch: (type: string, event?: unknown) => { for (const fn of listeners.get(type) ?? []) fn(event); },
    };
}

const globalsByTest = new WeakMap<TestContext, Map<string, PropertyDescriptor | undefined>>();
export function stubGlobals(context: TestContext, values: Record<string, unknown>) {
    let originals = globalsByTest.get(context);
    if (!originals) {
        const saved = new Map<string, PropertyDescriptor | undefined>();
        originals = saved;
        globalsByTest.set(context, saved);
        context.onTestFinished(() => {
            for (const [key, descriptor] of saved) {
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
        });
    }
    for (const [key, value] of Object.entries(values)) {
        if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
}
