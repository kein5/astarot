import assert from "node:assert/strict";
import * as featureLabel from "../../logics/common/featureLabel.ts";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import React from "react";
import type { RefObject } from "react";
import { hooks, loadModule, find, stubGlobals, eventTarget, unchecked, findIn, nodesIn, componentName, componentNamed, draw, fieldOf, setRef } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as languageNames from "../../logics/common/languageNames.ts";
import type { LanguageEntry } from "../../logics/common/languageNames.ts";
import { languageCodes } from "../../logics/common/languageCodes.ts";
import { languageJumpGroups } from "../../logics/common/languageJumpGroups.ts";
import { trackVrPointerHover } from "./vrPanelHover.ts";
import type { VrPointerHover } from "./vrPanelHover.ts";
import type { VrPickerNavigation } from "./VrPickerList.tsx";

const fonts = Array.from({ length: 743 }, (_, index) => ({ id: `font-${index}`, label: `Font ${index}` }));
type Font = (typeof fonts)[number];
const languages = Object.entries(languageCodes).flatMap(([language, countries]) =>
    Object.keys(countries).map(country => ({ language, country })));
// Every node of a rendered tree that the predicate picks.
const all = (tree: unknown, predicate: (node: TreeNode) => boolean): TreeNode[] => nodesIn(tree).filter(predicate);
// Like `cleanup?.()`: nothing for null or undefined, a TypeError for any other value that is not a function.
const runCleanup = (cleanup: unknown) => {
    if (cleanup === undefined || cleanup === null) return;
    if (typeof cleanup !== "function") throw new TypeError("An effect's clean-up is not a function");
    cleanup();
};

// The element that stands in for one option button, as the picker reads it.
interface FakeNode {
    element: TreeNode;
    hidden?: boolean;
    dataset: { vrPickerIndex: string };
    closest: (selector: string) => unknown;
    matches: (selector: string) => boolean;
    focus: () => void;
    getBoundingClientRect: () => { top: number; bottom: number };
    setAttribute?: (name: string) => void;
    removeAttribute?: (name: string) => void;
}
// The props the test draws the picker with: its fake scroll container and refs stand in for elements.
interface PickerProps {
    [key: string]: unknown;
    scrollRef: { current: unknown };
    navigationRef: { current: VrPickerNavigation | null };
    columns?: number;
}
interface Layout {
    height?: number;
    margin?: number;
    scale?: number;
}

// Like the LogBox harness, exercise production JSX with a lazy Virtualizer
// stub. This models a 320px viewport, 80px rows and virtua's default 200px
// buffer, not WebView layout/performance. No browser/app is started.
async function pickerHarness(context: TestContext, { height = 320, margin = 89, scale = 1 }: Layout = {}) {
    const runtime = hooks(), calls: [number, { offset: number; [key: string]: unknown }][] = [], landed: number[] = [];
    const observers: { callback: unknown; observed: unknown[]; disconnected?: boolean }[] = [], nodes = new Map<number, FakeNode>(), frames = new Map<number, () => void>();
    // Replay effect cleanup/setup with state and refs intact, as StrictMode
    // does. Keep this local to the picker harness; other hook tests need no replay.
    const layoutEffects = new Map<number, { setup: () => unknown; cleanup: unknown }>(), useLayoutEffect = runtime.api.useLayoutEffect;
    let layoutIndex = 0;
    runtime.api.useLayoutEffect = (setup, deps) => {
        const index = layoutIndex++;
        useLayoutEffect(() => {
            const effect = { setup, cleanup: setup() };
            layoutEffects.set(index, effect);
            return () => { runCleanup(effect.cleanup); layoutEffects.delete(index); };
        }, deps);
    };
    let sequence = 0;
    let tree: TreeNode | undefined, rowTrees: unknown[] = [], virtualProps: TreeNode["props"] | undefined, props: PickerProps | undefined, measures = 0;
    const scroll: { scrollTop: number; clientHeight: number; getBoundingClientRect: () => object; querySelector?: () => { focus(): void } } = {
        scrollTop: 0, clientHeight: height,
        getBoundingClientRect: () => ({ top: 0, bottom: height * scale, height: height * scale }) };
    const header = { previousElementSibling: null };
    const container = { previousElementSibling: header,
        getBoundingClientRect: () => { measures++; return { top: (margin - scroll.scrollTop) * scale }; } };
    const document: { activeElement: unknown; elementFromPoint?: () => unknown } = { activeElement: { closest: () => null } };
    stubGlobals(context, { document,
        getComputedStyle: (node: { hidden?: boolean }) => ({ visibility: node.hidden ? "hidden" : "visible" }),
        requestAnimationFrame: (callback: () => void) => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        ResizeObserver: class {
        callback: unknown;
        observed: unknown[] = [];
        disconnected?: boolean;
        constructor(callback: unknown) { this.callback = callback; observers.push(this); }
        observe(element: unknown) { this.observed.push(element); }
        disconnect() { this.disconnected = true; }
    } });
    // virtua 0.53.5 queues attachment for scrollRef. A scroll awaits the
    // current deferred; cleanup resolves it false and creates the next one.
    const deferred = () => {
        // The executor runs at once, so resolve is set before deferred returns.
        let resolve: (attached: boolean) => void = () => {};
        const promise = new Promise<boolean>(done => { resolve = done; });
        return { promise, resolve };
    };
    let attachment = deferred(), virtualMounted = false, virtualNode: TreeNode | undefined;
    const mountVirtualizer = () => {
        virtualMounted = true;
        assert.ok(virtualNode);
        setRef(virtualNode, handle);
        queueMicrotask(() => { assert.ok(props); if (props.scrollRef.current) attachment.resolve(true); });
    };
    const cleanupVirtualizer = () => {
        if (!virtualMounted) return;
        attachment.resolve(false);
        attachment = deferred();
        virtualMounted = false;
        assert.ok(virtualNode);
        setRef(virtualNode, null);
    };
    const handle = { scrollToIndex: async (index: number, options: { offset: number; [key: string]: unknown }) => {
        calls.push([index, options]);
        if (!await attachment.promise) return;
        const total = virtualProps.data.length * virtualProps.itemSize;
        scroll.scrollTop = Math.max(0, Math.min(total + margin - height, margin + index * virtualProps.itemSize + options.offset));
        landed.push(index);
    } };
    const Virtualizer = () => null;
    const module = await loadModule<typeof import("./VrPickerList.tsx")>(new URL("./VrPickerList.tsx", import.meta.url), runtime, { virtua: { Virtualizer } });
    // The picker is generic over its options; the test draws it with its fake scroll container.
    const drawPicker = componentNamed(module, "VrPickerList");
    const navigationRef: { current: VrPickerNavigation | null } = { current: null }, scrollRef: { current: unknown } = { current: scroll };
    const render = (next: Record<string, unknown> | undefined = props) => {
        props = { scrollRef, navigationRef, ...next };
        props.scrollRef.current = scroll;
        layoutIndex = 0;
        tree = runtime.render(drawPicker, props, root => {
            setRef(root, container);
            const virtual = find(root, node => node.type === Virtualizer);
            if (virtual) {
                virtualProps = virtual.props;
                virtualNode = virtual;
                if (!virtualMounted) mountVirtualizer();
                const { data, itemSize, bufferSize = 200, keepMounted = [] } = virtual.props;
                const from = Math.max(0, Math.floor((scroll.scrollTop - margin - bufferSize) / itemSize));
                const to = Math.min(data.length - 1, Math.floor((scroll.scrollTop + height - margin + bufferSize) / itemSize));
                const indices = new Set<number>(keepMounted);
                for (let i = from; i <= to; i++) indices.add(i);
                rowTrees = [...indices].sort((a, b) => a - b).map(index => virtual.props.children(data[index], index));
            } else {
                cleanupVirtualizer();
                virtualProps = undefined;
                rowTrees = React.Children.toArray(root.props.children);
            }
            const rendered = rowTrees.flatMap(row => all(row, node => node.type === "button"));
            for (const node of nodes.values()) setRef(node.element, null);
            const old = new Map(nodes);
            nodes.clear();
            for (const element of rendered) {
                const index = element.props["data-vr-picker-index"];
                const node: FakeNode = old.get(index) ?? { element, dataset: { vrPickerIndex: String(index) },
                    closest: selector => selector === "[data-vr-picker-index]" ? node : selector === ".picker_scroll" ? scroll : null,
                    matches: selector => selector === ":disabled" && !!node.element.props.disabled,
                    focus: () => {
                        if (node.element.props.disabled || node.hidden) return;
                        document.activeElement = node;
                        root.props.onFocusCapture({ target: node });
                    },
                    getBoundingClientRect: () => {
                        assert.ok(props);
                        const top = (margin + Math.floor(index / (props.columns ?? 1)) * 80 - scroll.scrollTop) * scale;
                        return { top, bottom: top + 72 * scale };
                    },
                };
                node.element = element;
                nodes.set(index, node);
                setRef(element, node);
            }
        });
        return tree;
    };
    const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => { callback(); }); };
    const microtasks = () => new Promise<void>(resolve => queueMicrotask(resolve));
    const settle = async (next?: Record<string, unknown>) => {
        render(next); await microtasks(); frame();
        render(); await microtasks(); frame();
        render(); await microtasks();
    };
    const replayMountEffects = ({ picker = true }: { picker?: boolean } = {}) => {
        cleanupVirtualizer();
        if (picker) layoutEffects.forEach(effect => { runCleanup(effect.cleanup); });
        mountVirtualizer();
        if (picker) layoutEffects.forEach(effect => { effect.cleanup = effect.setup(); });
    };
    const unmount = runtime.unmount;
    runtime.unmount = () => {
        cleanupVirtualizer();
        unmount();
        if (props) props.scrollRef.current = null;
    };
    context.onTestFinished(() => runtime.unmount());
    return { ...module, runtime, render, settle, replayMountEffects, microtasks, landed, frame, frames, navigationRef, scrollRef, scroll, calls, nodes, observers, document,
        // An option button the test goes on to use: it must be mounted.
        node: (index: number) => { const node = nodes.get(index); assert.ok(node); return node; },
        // The picker's navigation, which it sets once it is drawn.
        navigation: () => { assert.ok(navigationRef.current); return navigationRef.current; },
        get tree() { assert.ok(tree); return tree; }, get virtualProps() { return virtualProps; },
        get rowCount() { return rowTrees.length; }, get measures() { return measures; },
    };
}
type Picker = Awaited<ReturnType<typeof pickerHarness>>;

async function fontPicker(context: TestContext, selected_id = "font-0", layout?: Layout) {
    const h = await pickerHarness(context, layout), picked: string[] = [];
    const { Picker } = await loadModule<typeof import("./VrSettingsRows.tsx")>(new URL("./VrSettingsRows.tsx", import.meta.url), hooks(), {
        "./VrPickerList": { VrPickerList: h.VrPickerList },
    });
    // Test data: the picker's props without onBack, which nothing here calls, and the fake scroll container.
    const tree = Picker(unchecked<Parameters<typeof Picker>[0]>({ title: "Fonts", back_label: "Back", options: fonts, selected_id,
        scrollRef: unchecked<RefObject<HTMLElement | null>>(h.scrollRef), onPick: (value: string) => picked.push(value) }));
    await h.settle(findIn(tree, node => node.type === h.VrPickerList).props);
    return { h, picked };
}

for (const picker of [false, true]) {
    test(`initial font positioning survives StrictMode ${picker ? "whole-picker" : "Virtualizer-only"} effect replay`, async context => {
        const h = await pickerHarness(context);
        h.render({ options: fonts.slice(0, 316), initialIndex: 287, stickyHeader: true,
            children: (option: Font) => React.createElement("button", { key: option.id }, option.label) });
        h.render(); // The measured prefix mounts virtua and runs the init effect.
        h.replayMountEffects({ picker }); // Cleanup precedes both attachment microtasks.
        await h.settle();
        assert.equal(h.scroll.scrollTop, 22960, "selected font lands below the sticky header");
        assert.ok(h.nodes.has(287));
        assert.equal(h.calls.length, 1, "only one initial positioning request per open");
        assert.deepEqual(h.landed, [287]);
        h.scroll.scrollTop = 1024;
        await h.settle();
        assert.equal(h.scroll.scrollTop, 1024, "unrelated renders do not restore the initial position");
        assert.equal(h.calls.length, 1);
        // Real input occurs after the commit and its microtasks. Both operations
        // must scroll through the current attachment rather than a disposed one.
        h.navigation().scrollToIndex(290, { focus: true });
        await h.settle();
        assert.equal(h.scroll.scrollTop, 23200);
        h.tree.props.onKeyDown({ key: "Tab", target: h.nodes.get(290), preventDefault() {} });
        await h.settle();
        assert.equal(h.scroll.scrollTop, 23280);
        assert.equal(h.document.activeElement, h.nodes.get(291));
        assert.deepEqual(h.landed, [287, 290, 291]);
    });
}

test("closing before initial positioning cancels its microtask", async context => {
    const h = await pickerHarness(context);
    h.render({ options: fonts, initialIndex: 287, stickyHeader: true,
        children: (option: Font) => React.createElement("button", { key: option.id }, option.label) });
    h.render();
    h.runtime.unmount();
    h.scroll.scrollTop = 4096; // The old scroll container may already be reused.
    await h.microtasks();
    assert.equal(h.scroll.scrollTop, 4096);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.landed, []);
});

test("743 fonts create bounded lazy rows; a far selected font scrolls on open and retains its value", async context => {
    const { h, picked } = await fontPicker(context, "font-700", { scale: 0.5 });
    assert.equal(h.virtualProps.data.length, 743);
    assert.ok(h.nodes.size <= 14);
    assert.deepEqual(h.calls, [[700, { align: "start", offset: -89, smooth: false }]]);
    const selected = h.node(700).element;
    assert.equal(selected.props["aria-pressed"], true);
    assert.match(selected.props.className, /is_selected/);
    assert.equal(h.node(700).getBoundingClientRect().top, 89 * 0.5);
    selected.props.onClick();
    assert.deepEqual(picked, ["font-700"]);
    const measurements = h.measures;
    h.render();
    assert.equal(h.measures, measurements, "unrelated renders do not measure or restart scrolling");
    assert.equal(h.calls.length, 1);
    assert.equal(h.observers.length, 1);
    h.runtime.unmount();
    assert.ok(h.observers.every(observer => observer.disconnected));
    context.annotate(`743 fonts, selected index 700, viewport 320px, row pitch 80px, buffer 200px: 743 -> ${h.nodes.size} option buttons (${h.rowCount} rows), including keyboard endpoints; simulated layout.`);
});

test("short lists render all options and scroll the selected entry without scrolling the window", async context => {
    const h = await pickerHarness(context, { scale: 0.5 });
    const options = fonts.slice(0, 12), selected: string[] = [];
    await h.settle({ options, initialIndex: 10, stickyHeader: true,
        children: (option: Font) => React.createElement("button", { key: option.id, onClick: () => selected.push(option.id) }, option.label) });
    assert.equal(h.virtualProps, undefined);
    assert.equal(h.nodes.size, 12);
    assert.equal(h.scroll.scrollTop, 800);
    h.node(10).element.props.onClick();
    assert.deepEqual(selected, ["font-10"]);
});

test("Tab crosses unmounted rows, skips disabled entries and retains a focused row during scroll", async context => {
    const { h } = await fontPicker(context);
    h.node(0).focus();
    h.scroll.scrollTop = 40000;
    h.render();
    assert.ok(h.nodes.has(0));
    assert.ok(!h.nodes.has(1));
    let prevented = 0;
    h.tree.props.onKeyDown({ key: "Tab", target: h.nodes.get(0), preventDefault: () => prevented++ });
    await h.settle();
    assert.equal(h.document.activeElement, h.nodes.get(1));
    assert.equal(prevented, 1);
    assert.equal(h.calls.at(-1)?.[0], 1);
    h.tree.props.onKeyDown({ key: "Tab", shiftKey: true, target: h.nodes.get(1), preventDefault: () => prevented++ });
    await h.settle();
    assert.equal(h.document.activeElement, h.nodes.get(0));
    h.tree.props.onKeyDown({ key: "Tab", shiftKey: true, target: h.nodes.get(0), preventDefault: () => prevented++ });
    assert.equal(prevented, 2, "native Shift+Tab leaves the first option");
    h.navigation().scrollToIndex(700, { focus: true });
    await h.settle();
    h.scroll.scrollTop = 0;
    h.render();
    assert.ok(h.nodes.has(700), "focused option survives scroll away");
    assert.ok(h.nodes.size <= 14);
});

async function languageWindow(context: TestContext, h: Picker, locale = "en") {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), sorts: unknown[] = [], filters: unknown[] = [], picked: unknown[] = [];
    const ok = <T>(data: T) => ({ state: "ok", data });
    const source = languages[0];
    const target = languages.find(entry => entry.language === "Japanese");
    const settings = {
        currentSelectedPresetTabNumber: ok("1"),
        currentSelectedYourLanguages: ok<Record<number, Record<number, LanguageEntry | undefined>>>({ 1: { 1: source } }),
        currentSelectedTargetLanguages: ok({ 1: { 1: { ...target, enable: true } } }),
        currentSelectedTranslationEngines: ok({ 1: "engine" }),
        currentTranslationEngines: ok([{ id: "engine", label: "Engine", is_available: true }]),
        currentSelectableLanguageList: ok(languages), currentLanguageMutation: ok({ inFlight: null, isResyncing: false }),
        setSelectedYourLanguages: (entry: unknown) => { picked.push(entry); return "request-1"; },
        setTargetLanguagesInOrder: (entries: unknown) => { picked.push(entries); return "request-2"; },
    };
    const i18n = { language: locale };
    const { VrLanguageWindow } = await loadModule<typeof import("./VrLanguageWindow.tsx")>(new URL("./VrLanguageWindow.tsx", import.meta.url), runtime, {
        "./VrWindow": { VrWindow: () => null },
        "./VrPickerList": { VrPickerList: h.VrPickerList, VR_PICKER_WINDOW_THRESHOLD: h.VR_PICKER_WINDOW_THRESHOLD },
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n }) },
        "@logics_main": { useLanguageSettings: () => settings },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: false } }) },
        "../../logics/main/languageMutations": { LANGUAGE_RESPONSE_WAIT_MS: 30000 },
        "../../logics/common/languageJumpGroups.ts": { languageJumpGroups },
        "../../logics/common/languageNames.ts": { ...languageNames, createLanguageNames: (locale: string) => {
            const names = languageNames.createLanguageNames(locale);
            return { ...names, sorted: (entries: Iterable<LanguageEntry>) => { sorts.push(entries); return names.sorted(entries); },
                matches: (entry: LanguageEntry | null | undefined, query: unknown) => { filters.push(query); return names.matches(entry, query); } };
        } },
    });
    let tree: unknown;
    // Test data: the window's props without onClose, which nothing here calls.
    const windowProps = unchecked<Parameters<typeof VrLanguageWindow>[0]>({});
    const render = () => {
        tree = runtime.render(VrLanguageWindow, windowProps, root => {
            const scroll = find(root, node => node.props.className === "picker_scroll");
            if (scroll) setRef(scroll, h.scroll);
        });
        return tree;
    };
    render();
    const open = (kind = "source") => {
        findIn(tree, node => node.type === "button" && node.props.className.split(" ").includes(kind)).props.onClick();
        render();
        findIn(tree, node => node.type === "button" && node.props.className.includes("all_languages")).props.onClick();
        render();
    };
    context.onTestFinished(() => runtime.unmount());
    return { render, open, settings, sorts, filters, picked, i18n, source,
        get tree() { return tree; }, get list() { return findIn(tree, node => node.type === h.VrPickerList); } };
}

test("the full language grid mounts bounded pairs and group jumps use the filtered option index", async context => {
    const h = await pickerHarness(context, { margin: 38 });
    const w = await languageWindow(context, h);
    w.open();
    await h.settle(w.list.props);
    assert.equal(w.list.props.options.length, 135);
    assert.equal(h.virtualProps.data.length, 68);
    assert.ok(h.nodes.size <= 28);
    context.annotate(`135 full language choices (languageCodes.js, English), selected first entry, viewport 320px, heading 38px, row pitch 80px, buffer 200px: 135 buttons / 68 rows -> ${h.nodes.size} buttons / ${h.rowCount} rows, including keyboard endpoints; simulated layout.`);
    const expected = w.list.props.options.findIndex((entry: LanguageEntry) => entry.language === "Japanese");
    const jump = findIn(w.tree, node => node.props["data-vr-language-jump"] === "J");
    const choices = w.list.props.options;
    const jGroup = languageJumpGroups(choices.map((entry: LanguageEntry) => languageNames.createLanguageNames("en").name(entry).language), "en").find(group => group.id === "J");
    assert.ok(jGroup);
    const groupIndex = jGroup.index;
    assert.equal(groupIndex, expected);
    assert.ok(!h.nodes.has(groupIndex));
    jump.props.onClick();
    await h.settle();
    assert.equal(h.calls.at(-1)?.[0], Math.floor(groupIndex / 2));
    assert.equal(h.document.activeElement, h.nodes.get(groupIndex));
    h.node(groupIndex).element.props.onClick();
    assert.strictEqual(w.picked[0], choices[groupIndex], "existing language setter receives the original entry");
    w.render();
    await h.settle(w.list.props);
    assert.equal(h.node(groupIndex).element.props["aria-disabled"], true);
    h.node(groupIndex).element.props.onClick();
    assert.equal(w.picked.length, 1, "pending choices cannot send another mutation");
});

test("initial language positioning and group jumps use the surviving StrictMode attachment", async context => {
    const h = await pickerHarness(context, { margin: 38 }), w = await languageWindow(context, h);
    const selected = languages.find(entry => entry.language === "Japanese");
    w.settings.currentSelectedYourLanguages = { state: "ok", data: { 1: { 1: selected } } };
    w.render();
    w.open();
    h.render(w.list.props);
    h.render();
    h.replayMountEffects();
    await h.settle();
    const index = w.list.props.options.indexOf(selected);
    assert.ok(h.scroll.scrollTop > 0);
    assert.ok(h.nodes.has(index));
    assert.equal(h.node(index).getBoundingClientRect().top, 0);
    assert.equal(h.calls.length, 1);
    assert.equal(h.landed.length, 1);
    findIn(w.tree, node => node.props["data-vr-language-jump"] === "A").props.onClick();
    await h.settle();
    assert.equal(h.scroll.scrollTop, 38);
    assert.equal(h.document.activeElement, h.nodes.get(0));
    assert.equal(h.landed.length, 2);
});

test("search keeps lazy windowing, sorts only when its inputs change, and uses original identities", async context => {
    const h = await pickerHarness(context, { margin: 38 });
    const w = await languageWindow(context, h);
    w.open();
    await h.settle(w.list.props);
    const initialSorts = w.sorts.length, initialFilters = w.filters.length, choices = w.list.props.options;
    w.settings.currentSelectedTranslationEngines.state = "pending";
    w.render();
    assert.strictEqual(w.list.props.options, choices);
    assert.equal(w.sorts.length, initialSorts);
    assert.equal(w.filters.length, initialFilters);
    w.settings.currentSelectedTranslationEngines.state = "ok";
    w.render();
    const oldKey = w.list.key;
    findIn(w.tree, node => node.type === "input").props.onChange({ target: { value: "Arabic" } });
    w.render();
    assert.notEqual(w.list.key, oldKey, "new filter resets virtual measurements and focus indices");
    assert.equal(w.sorts.length, initialSorts, "search filters the memoized sort");
    assert.equal(w.list.props.virtualized, true);
    assert.ok(w.list.props.options.length > 0 && w.list.props.options.length < 50);
    assert.ok(w.list.props.options.every((entry: LanguageEntry) => entry.language === "Arabic"));
    // React remounts this keyed list on a filter change.
    h.runtime.unmount();
    const filtered = await pickerHarness(context, { margin: 38 });
    await filtered.settle(w.list.props);
    assert.ok(filtered.virtualProps);
    assert.ok(filtered.nodes.size < w.list.props.options.length);
    assert.equal(w.list.props.initialIndex, -1);
    const first = w.list.props.options[0];
    const input = findIn(w.tree, node => node.type === "input");
    input.props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true } });
    assert.equal(w.picked.length, 0);
    input.props.onKeyDown({ key: "Enter", preventDefault() {} });
    assert.strictEqual(w.picked[0], first);
    assert.ok(languages.includes(first));
    w.i18n.language = "ja";
    w.render();
    assert.equal(w.sorts.length, initialSorts + 1);
    w.settings.currentSelectableLanguageList = { state: "ok", data: languages.slice(0, 60) };
    w.render();
    assert.equal(w.sorts.length, initialSorts + 2);
});

test("a language code typed in the VR filter lists that language first, and Enter picks it", async context => {
    const h = await pickerHarness(context, { margin: 38 });
    const w = await languageWindow(context, h);
    w.open();
    await h.settle(w.list.props);
    findIn(w.tree, node => node.type === "input").props.onChange({ target: { value: "ja" } });
    w.render();
    // Azerbaijani's name also contains "ja" and comes first by name.
    assert.ok(w.list.props.options.some((entry: LanguageEntry) => entry.language === "Azerbaijani"));
    assert.equal(w.list.props.options[0].language, "Japanese");
    findIn(w.tree, node => node.type === "input").props.onKeyDown({ key: "Enter", preventDefault() {} });
    // The source language's setter was given the language's entry.
    assert.equal(fieldOf(w.picked[0], "language"), "Japanese");
});

test("grid jumps to disabled selections keep focus; Tab skips disabled options and preserves columns", async context => {
    const h = await pickerHarness(context, { margin: 38 });
    const options = fonts.slice(0, 100), isDisabled = (option: Font) => Number(option.id.slice(5)) % 2 === 0;
    await h.settle({ options, columns: 2, isDisabled,
        children: (option: Font) => React.createElement("button", { key: option.id, disabled: isDisabled(option) }, option.label) });
    h.node(1).focus();
    h.navigation().scrollToIndex(70, { focus: true });
    await h.settle();
    assert.equal(h.calls.at(-1)?.[0], 35);
    assert.equal(h.document.activeElement, h.nodes.get(1));
    h.tree.props.onKeyDown({ key: "Tab", target: h.nodes.get(1), preventDefault() {} });
    await h.settle();
    assert.equal(h.calls.at(-1)?.[0], 1, "option 3 is in grid row 1");
    assert.equal(h.document.activeElement, h.nodes.get(3));
});

test("jump focus waits for virtua measurement without an idle retry loop and cancels on close", async context => {
    const { h } = await fontPicker(context);
    h.navigation().scrollToIndex(700, { focus: true });
    h.render();
    h.node(700).hidden = true;
    h.frame();
    assert.notEqual(h.document.activeElement, h.nodes.get(700));
    assert.equal(h.frames.size, 0, "hidden rows do not start a polling loop");
    h.node(700).hidden = false;
    h.virtualProps.onResize();
    h.frame();
    h.render();
    assert.equal(h.document.activeElement, h.nodes.get(700));
    h.virtualProps.onResize();
    assert.equal(h.frames.size, 0, "ordinary measurements do not schedule focus work");
    h.navigation().scrollToIndex(500, { focus: true });
    h.render();
    assert.equal(h.frames.size, 1);
    h.runtime.unmount();
    assert.equal(h.frames.size, 0);
    assert.equal(h.navigationRef.current, null);
});

test("font selection reaches the existing appearance setter and closes the settings picker", async context => {
    const h = await pickerHarness(context), runtime = hooks(), picked: string[] = [];
    const rows = await loadModule<typeof import("./VrSettingsRows.tsx")>(new URL("./VrSettingsRows.tsx", import.meta.url), hooks(), {
        "./VrPickerList": { VrPickerList: h.VrPickerList },
    });
    const { VrSettingsWindow } = await loadModule<typeof import("./VrSettingsWindow.tsx")>(new URL("./VrSettingsWindow.tsx", import.meta.url), runtime, {
        "../../logics/common/languageNames.ts": languageNames,
        "../../logics/common/featureLabel.ts": featureLabel,
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: true } }) },
        "@logics_configs": { useAppearance: () => ({ currentUiLanguage: { data: "en" },
            currentSelectedFontFamily: { state: "ok", data: "font-700" }, setSelectedFontFamily: (value: string) => picked.push(value) }), useOthers: () => ({}) },
        "@store": { useStore_SelectableFontFamilyList: () => ({ currentSelectableFontFamilyList: {
            state: "ok", data: Object.fromEntries(fonts.map(option => [option.id, option.label])),
        } }) },
        "@ui_configs": { ui_configs: { selectable_ui_languages: [] } },
        "./VrWindow": { VrWindow: () => null }, "./VrSettingsRows": rows, "./VrHandIcon": { VrHandIcon: () => null },
        "../app/config_page/setting_section/setting_box/_components/compute_device/computeDeviceOptions": {},
        "../../logics/configs/cloudTranscription": {}, "../../logics/configs/ctranslate2License": {},
    });
    h.scroll.querySelector = () => ({ focus() {} });
    // Test data: the window's props without onClose, which nothing here calls.
    const windowProps = unchecked<Parameters<typeof VrSettingsWindow>[0]>({});
    const render = () => runtime.render(VrSettingsWindow, windowProps, root => {
        const picker = find(root, node => node.props["data-vr-settings-list"] === "picker");
        if (picker) setRef(picker, h.scroll);
    });
    let tree = render();
    findIn(tree, node => node.type === "button" && find(node, child => child.props?.text === "config_page.side_menu_labels.appearance") !== null).props.onClick();
    tree = render();
    const category = findIn(tree, node => componentName(node) === "Category");
    const appearance = draw(category);
    const controls = draw(appearance);
    findIn(controls, node => node.type === rows.SelectRow && node.props.label === "config_page.appearance.font_family.label").props.onOpen();
    tree = render();
    const picker = findIn(tree, node => node.type === rows.Picker);
    await h.settle(findIn(rows.Picker(picker.props), node => node.type === h.VrPickerList).props);
    h.node(701).element.props.onClick();
    assert.deepEqual(picked, ["font-701"]);
    assert.equal(find(render(), node => node.type === rows.Picker), null);
    runtime.unmount();
});

test("search with no matches renders no options and cannot select; clearing restores the full list", async context => {
    const h = await pickerHarness(context), w = await languageWindow(context, h);
    w.open();
    findIn(w.tree, node => node.type === "input").props.onChange({ target: { value: "no-such-language" } });
    w.render();
    await h.settle(w.list.props);
    assert.ok(h.virtualProps);
    assert.equal(h.nodes.size, 0);
    assert.ok(findIn(w.tree, node => node.props.children === "main_page.language_selector.no_results"));
    const input = findIn(w.tree, node => node.type === "input");
    input.props.onKeyDown({ key: "Enter" });
    assert.equal(w.picked.length, 0);
    input.props.onChange({ target: { value: "" } });
    w.render();
    assert.equal(w.list.props.options.length, 135);
    assert.equal(w.list.props.initialIndex, -1, "clearing search returns to the top instead of the selected row");
});

test("a selected language far down the list is revealed, disabled and labelled on opening", async context => {
    const h = await pickerHarness(context, { margin: 38 }), w = await languageWindow(context, h, "ja");
    const selected = languages.find(entry => entry.language === "Japanese");
    w.settings.currentSelectedYourLanguages = { state: "ok", data: { 1: { 1: selected } } };
    w.render();
    w.open();
    await h.settle(w.list.props);
    const index = w.list.props.options.indexOf(selected);
    assert.ok(index > 50);
    assert.equal(h.calls.at(-1)?.[0], Math.floor(index / 2));
    const button = h.node(index).element;
    assert.equal(button.props.disabled, true);
    assert.equal(button.props["aria-pressed"], true);
    assert.match(button.props["aria-label"], /日本語/);
    button.props.onClick();
    assert.equal(w.picked.length, 0);
    const group = languageJumpGroups(w.list.props.options.map((entry: LanguageEntry) => languageNames.createLanguageNames("ja").name(entry).language), "ja").find(group => group.id === "ハ");
    assert.ok(group);
    findIn(w.tree, node => node.props["data-vr-language-jump"] === "ハ").props.onClick();
    await h.settle();
    assert.equal(h.calls.at(-1)?.[0], Math.floor(group.index / 2));
});

test("adding a target preserves the existing ordered setter payload", async context => {
    const h = await pickerHarness(context), w = await languageWindow(context, h);
    w.open("add");
    await h.settle(w.list.props);
    const entry = w.list.props.options[0];
    h.node(0).element.props.onClick();
    assert.equal(w.picked.length, 1);
    // The target languages' setter was given the ordered entries.
    const payload = w.picked[0];
    assert.ok(Array.isArray(payload), "the setter was given a list");
    assert.equal(payload.length, 2);
    assert.strictEqual(payload[0], w.settings.currentSelectedTargetLanguages.data[1][1]);
    assert.strictEqual(payload[1], entry);
});

test("stationary hover follows virtual rows mounting and unmounting, coalescing scroll and layout", async context => {
    let hover: VrPointerHover | undefined;
    context.onTestFinished(() => hover?.dispose());
    const { h } = await fontPicker(context), writes: unknown[][] = [], mutations: ((records: unknown[]) => void)[] = [];
    const root = { ...eventTarget(), contains: (node: FakeNode) => [...h.nodes.values()].includes(node), querySelectorAll: () => [] };
    stubGlobals(context, { window: eventTarget(), MutationObserver: class {
        constructor(callback: (records: unknown[]) => void) { mutations.push(callback); }
        observe() {}
        disconnect() {}
    } });
    let hit: FakeNode | undefined;
    h.document.elementFromPoint = () => hit;
    const asTarget = (node: FakeNode) => {
        node.closest = selector => selector === "button, [data-vr-hoverable]" ? node : null;
        node.setAttribute = name => writes.push([node, "set", name]);
        node.removeAttribute = name => writes.push([node, "remove", name]);
        return node;
    };
    // Test data: the root holds only what the tracker uses of an element.
    hover = trackVrPointerHover(unchecked<HTMLElement>(root));
    hit = asTarget(h.node(1));
    const original = hit;
    hover.setPointer({ x: 100, y: 200 });
    h.frame();
    h.scroll.scrollTop = 40000;
    h.render();
    assert.ok(![...h.nodes.values()].includes(original));
    hit = asTarget(h.node(500));
    root.dispatch("scroll");
    mutations[0]([{ type: "childList" }]);
    assert.equal(h.frames.size, 1);
    h.frame();
    assert.deepEqual(writes, [[original, "set", "data-vr-hover"], [original, "remove", "data-vr-hover"], [hit, "set", "data-vr-hover"]]);
    mutations[0]([{ type: "childList" }]);
    h.frame();
    assert.equal(writes.length, 3);
    assert.equal(h.frames.size, 0);
});
