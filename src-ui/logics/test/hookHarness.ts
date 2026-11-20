import assert from "node:assert/strict";
import { HARNESS_QUERY } from "./harnessModules.ts";
import type { BabelOptions } from "@babel/standalone";
import React from "react";
import type { ReactElement } from "react";
import * as jsx from "react/jsx-runtime";
import clsx from "clsx";
import { atom, createStore } from "jotai/vanilla";
import type { Atom, PrimitiveAtom } from "jotai/vanilla";
import type { TestContext } from "vitest";

type Deps = readonly unknown[] | undefined;
type Store = ReturnType<typeof createStore>;
// One hook's memory: the dependencies it last ran with, and its value or its effect's clean-up.
export interface Slot {
    deps?: Deps;
    value?: unknown;
    cleanup?: unknown;
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

// Explicit renders exercise production handlers without a browser. Effects clean
// up on dependency changes as well as unmount, so listener churn is observable.
export function hooks() {
    const slots: (Slot | undefined)[] = [], effects: (() => void)[] = [], targets: Atom<unknown>[] = [];
    // Each atom's setter, kept as a slot's value: the one made for that atom, of its type.
    const setters = new Map<Atom<unknown>, Slot>();
    let index = 0, store: Store = createStore();
    const changed = (slot: Slot | undefined, deps: Deps) => !slot || !deps || deps.length !== slot.deps?.length ||
        deps.some((value, i) => !Object.is(value, slot.deps?.[i]));
    const memo = <T>(factory: () => T, deps: Deps): T => {
        const i = index++;
        const slot = changed(slots[i], deps) ? slots[i] = { deps, value: factory() } : slots[i];
        return held<T>(slot ?? {});
    };
    const effect = (fn: () => unknown, deps?: Deps) => {
        const i = index++;
        if (changed(slots[i], deps)) effects.push(() => {
            runCleanup(slots[i]?.cleanup);
            slots[i] = { deps, cleanup: fn() };
        });
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
        useEffect: effect, useLayoutEffect: effect,
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
        effects.splice(0).forEach(fn => { fn(); });
        return tree;
    }
    return { api, jotai, targets, get store() { return store; }, set store(value: Store) { store = value; },
        render,
        unmount: () => { for (const slot of slots) { runCleanup(slot?.cleanup); if (slot) slot.cleanup = undefined; } },
        // Drawn again from scratch, as a changed React key does: the component's own state
        // goes; the atoms' store stays.
        remount: () => {
            for (const slot of slots) runCleanup(slot?.cleanup);
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

export async function loadModule<M = Record<string, unknown>>(url: URL, runtime: HookRuntime, imports: Record<string, unknown> = {}): Promise<M> {
    // Vite builds the source into a function of require and exports (harnessModules.ts).
    const built: unknown = Reflect.get(await import(/* @vite-ignore */ `${url.href}?${HARNESS_QUERY}`), "default");
    if (typeof built !== "function") throw new TypeError(`${url.pathname} did not build into a function`);
    const dependencies: Record<string, unknown> = { react: runtime.api, "react/jsx-runtime": jsx, clsx, jotai: runtime.jotai,
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async () => true }) }, ...imports };
    const require = (name: string): unknown => {
        if (name.endsWith(".module.scss")) return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : key });
        // vanilla-extract style modules: each export is its class name.
        if (name.endsWith(".css.ts") && !(name in dependencies)) return new Proxy({}, { get: (_, key) => key === "__esModule" ? true : key });
        if (name.endsWith(".svg?react")) return () => null;
        if (name in dependencies) return dependencies[name];
        // The common tooltip around a control, unless the test hands in its own: an element named
        // "tooltip" that keeps its words (title), its side and the control it wraps, so a test reads
        // what the bubble says without a page to draw it on.
        if (/^(\.\.?\/)+(views\/)?common_components\/tooltip\/Tooltip(\.tsx)?$/.test(name)) return { Tooltip: "tooltip" };
        // While modules move from .js to .ts (ADR-010), a test may still name a dependency
        // with its old extension, or with none, as the importing module once did.
        const base = name.replace(/\.[jt]sx?$/, "");
        const alias = [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`].find(key => key in dependencies);
        if (alias !== undefined && /^\.\.?\//.test(name)) return dependencies[alias];
        throw new Error(`Unexpected dependency: ${name}`);
    };
    const exports: Record<string, unknown> = {};
    Reflect.apply(built, undefined, [require, exports]);
    return loaded<M>(exports);
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
export type TreeNode = ReactElement;

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

// The render function a forwardRef component wraps, which React 18's types leave out.
export function forwardRefRender(component: unknown): (props: unknown, ref: unknown) => TreeNode {
    const render: unknown = Reflect.get(Object(component), "render");
    if (typeof render !== "function") throw new TypeError("not a forwardRef component");
    return asComponent(render);
}

// An element's ref, which React 18's element type leaves out.
export const refOf = (node: TreeNode): unknown => Reflect.get(node, "ref");
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
