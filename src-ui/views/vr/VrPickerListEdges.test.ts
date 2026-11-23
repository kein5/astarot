import assert from "node:assert/strict";
import React from "react";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentNamed, find, hooks, loadModule, refOf, setRef, stubGlobals, treeNode } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import type { VrPickerNavigation } from "./VrPickerList.tsx";

// The VR picker list at its edges: where it measures its start, how it first scrolls to the choice
// in use, which rows a long list keeps drawn, how a focus waits for its row, and Tab in a long
// list. A small page stands in: the list's scroll box is drawn at half size on the screen (400 px
// of list in 200 px), at 100 px from the top, with a header above the list. VrPickerList.test.ts
// covers long lists of fonts and languages.

type Option = { id: string; disabled?: boolean };
const optionsOf = (count: number, disabled: (index: number) => boolean = () => false): Option[] =>
    Array.from({ length: count }, (_, index) => ({ id: `option-${index}`, disabled: disabled(index) }));

// A stand-in for a choice's button.
interface Fake { index: number; hidden: boolean; top: number; focused: unknown[]; focus: (options?: unknown) => void; closest: (selector: string) => unknown; dataset: { vrPickerIndex: string } }

async function picker(context: TestContext) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const frames = new Map<number, () => void>(), observers: { callback: () => void; observed: unknown[] }[] = [];
    let frameId = 0;
    stubGlobals(context, {
        requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
        getComputedStyle: (element: Fake) => ({ visibility: element.hidden ? "hidden" : "visible" }),
        ResizeObserver: class {
            callback: () => void;
            observed: unknown[] = [];
            constructor(callback: () => void) { this.callback = callback; observers.push(this); }
            observe(target: unknown) { this.observed.push(target); }
            disconnect() {}
        },
    });
    const module = await loadModule<typeof import("./VrPickerList.tsx")>(new URL("./VrPickerList.tsx", import.meta.url), runtime, { virtua: { Virtualizer: "virtualizer" } });
    const List = componentNamed(module, "VrPickerList");
    const scroll = { scrollTop: 30, clientHeight: 400, height: 200, getBoundingClientRect: () => ({ top: 100, height: scroll.height }) };
    const header = { previousElementSibling: null };
    const page = { containerTop: 160, mountedRows: [0, 1] };
    const container = { previousElementSibling: header, getBoundingClientRect: () => ({ top: page.containerTop }),
        contains: (element: unknown) => [...fakes.values()].includes(element as Fake) };
    const scrolled: unknown[][] = [];
    const handle = { scrollToIndex: (...args: unknown[]) => { scrolled.push(args); } };
    const fakes = new Map<number, Fake>();
    const fakeFor = (index: number) => {
        const fake: Fake = fakes.get(index) ?? { index, hidden: false, top: 0, focused: [], dataset: { vrPickerIndex: String(index) },
            focus: (options?: unknown) => { fake.focused.push(options); }, closest: (selector: string) => selector === "[data-vr-picker-index]" ? fake : null };
        fakes.set(index, fake);
        return fake;
    };
    const navigationRef: { current: VrPickerNavigation | null } = { current: null };
    let attached: TreeNode[] = [], tree: TreeNode | undefined, props: Record<string, unknown> = {};
    const render = (next: Record<string, unknown> = {}) => {
        props = { ...props, ...next };
        tree = runtime.render(List, { scrollRef: { current: scroll }, navigationRef, children: (option: Option) =>
            React.createElement("button", { key: option.id, type: "button", disabled: option.disabled }), ...props }, root => {
            setRef(root, container);
            const virtual = find(root, node => node.type === "virtualizer");
            if (virtual) setRef(virtual, handle);
            const rows: unknown[] = virtual ? page.mountedRows.filter(row => row < virtual.props.data.length).map(row => virtual.props.children(virtual.props.data[row], row))
                : React.Children.toArray(root.props.children);
            const buttons = rows.flatMap(row => React.Children.toArray(treeNode(row)?.props.children).map(treeNode)).filter(node => node !== null);
            // As React does: the refs of buttons no longer drawn are cleared, then the drawn ones set.
            for (const node of attached) if (!buttons.some(button => refOf(button) === refOf(node))) setRef(node, null);
            for (const button of buttons) setRef(button, fakeFor(button.props["data-vr-picker-index"]));
            attached = buttons;
        });
        return tree;
    };
    const microtasks = () => new Promise<void>(resolve => queueMicrotask(resolve));
    const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => { callback(); }); };
    // Drawn, measured, drawn with the measure, and first positioned.
    const open = async (next: Record<string, unknown>) => { render(next); render(); await microtasks(); return render(); };
    const now = () => { assert.ok(tree); return tree; };
    return { runtime, scroll, page, frames, observers, scrolled, header, navigationRef, render, open, microtasks, frame,
        fake: (index: number) => { const found = fakes.get(index); assert.ok(found, `no button ${index}`); return found; },
        virtual: () => find(now(), node => node.type === "virtualizer"),
        get tree() { return now(); },
        // The page changes size: the observer measures again.
        resized: () => { observers.at(-1)?.callback(); return render(); },
    };
}
type Picker = Awaited<ReturnType<typeof picker>>;
const navigation = (h: Picker) => { assert.ok(h.navigationRef.current); return h.navigationRef.current; };

test("the list measures where it starts in the scroll box's own pixels, and watches the box and what is above it", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(60), virtualized: true });
    // 60 px below the box's top on a screen at half size is 120 px of list, under 30 px of scroll.
    assert.equal(h.virtual()?.props.startMargin, 150);
    assert.deepEqual(h.observers.at(-1)?.observed, [h.scroll, h.header]);
});

test("a scroll box that is not laid out is not measured, and the long list waits for it", async context => {
    const h = await picker(context);
    h.scroll.height = 0;
    await h.open({ options: optionsOf(60), virtualized: true });
    assert.equal(h.virtual(), null);
});

test("fifty choices are drawn lazily; forty-nine are drawn whole", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(50) });
    assert.ok(h.virtual());
    const short = await picker(context);
    await short.open({ options: optionsOf(49) });
    assert.equal(short.virtual(), null);
});

test("a long list is first scrolled to the choice in use, under the header, once", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(60), virtualized: true, columns: 2, initialIndex: 9, stickyHeader: true });
    assert.deepEqual(h.scrolled, [[4, { align: "start", offset: -150, smooth: false }]]);
    // The page changes size later: the list does not jump back to the choice.
    h.page.containerTop = 180;
    h.resized();
    h.render();
    await h.microtasks();
    // The first scroll put the box's own scroll back to the top: 80 px on the screen is 160 px of list.
    assert.equal(h.virtual()?.props.startMargin, 160);
    assert.equal(h.scrolled.length, 1);
});

test("a start that moves before the first scroll is the one the first scroll uses", async context => {
    const h = await picker(context);
    h.render({ options: optionsOf(60), virtualized: true, initialIndex: 3, stickyHeader: true });
    h.render();
    h.page.containerTop = 180;
    h.resized();
    h.render();
    await h.microtasks();
    assert.deepEqual(h.scrolled, [[3, { align: "start", offset: -190, smooth: false }]]);
});

test("no choice in use, or one past the end, scrolls nothing and takes no focus", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(60), virtualized: true, initialIndex: -1 });
    assert.deepEqual(h.scrolled, []);
    navigation(h).scrollToIndex(60, { focus: true });
    navigation(h).scrollToIndex(-1, { focus: true });
    h.render();
    assert.deepEqual([h.scrolled, h.frames.size], [[], 0]);
});

test("a short list scrolls its own box to a choice, under the header when it has one", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(4), initialIndex: -1 });
    h.fake(2);
    // The button is 150 px below the box's top on the screen: 300 px of list.
    h.scroll.getBoundingClientRect = () => ({ top: 100, height: 200 });
    Object.assign(h.fake(2), { getBoundingClientRect: () => ({ top: 250 }) });
    navigation(h).scrollToIndex(2);
    // Opening put the box at its top; the button is then 300 px of list down.
    assert.equal(h.scroll.scrollTop, 300);
    const sticky = await picker(context);
    await sticky.open({ options: optionsOf(4), initialIndex: -1, stickyHeader: true });
    Object.assign(sticky.fake(2), { getBoundingClientRect: () => ({ top: 250 }) });
    navigation(sticky).scrollToIndex(2);
    assert.equal(sticky.scroll.scrollTop, 300 - 150);
});

test("a short list draws its rows in the given columns, the last row without the gap below it", async context => {
    const h = await picker(context);
    const tree = await h.open({ options: optionsOf(5), columns: 2 });
    const rows: TreeNode[] = tree.props.children;
    assert.deepEqual(rows.map(row => [row.key, row.props.style]), [
        ["0", { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", paddingBottom: undefined }],
        ["1", { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", paddingBottom: undefined }],
        ["2", { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", paddingBottom: 0 }],
    ]);
    // New choices: new rows.
    const fewer: TreeNode[] = h.render({ options: optionsOf(2) }).props.children;
    assert.equal(fewer.length, 1);
});

test("a long list keeps its first and last choices that can be chosen drawn, for Tab to reach", async context => {
    const h = await picker(context);
    // Choices 0 and 1 and 58 and 59 are disabled: the edges are 2 and 57, in rows 1 and 28.
    await h.open({ options: optionsOf(60, index => index < 2 || index > 57), virtualized: true, columns: 2,
        isDisabled: (option: Option) => option.disabled === true });
    assert.deepEqual(h.virtual()?.props.keepMounted, [1, 28]);
    // New choices: new edges.
    h.render({ options: optionsOf(60) });
    assert.deepEqual(h.virtual()?.props.keepMounted, [0, 29]);
    // Nothing can be chosen: no edge is kept.
    h.render({ options: optionsOf(60, () => true) });
    assert.deepEqual(h.virtual()?.props.keepMounted, []);
});

test("the focused choice's row stays drawn until the focus leaves the list", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(60), virtualized: true });
    const list = () => h.tree;
    h.page.mountedRows = [0, 1, 30];
    h.render();
    list().props.onFocusCapture({ target: h.fake(30) });
    assert.deepEqual(h.render() && h.virtual()?.props.keepMounted, [0, 59, 30]);
    // Within the list: still kept.
    list().props.onBlurCapture({ currentTarget: { contains: (element: unknown) => element === h.fake(0) }, relatedTarget: h.fake(0) });
    assert.deepEqual(h.render() && h.virtual()?.props.keepMounted, [0, 59, 30]);
    list().props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null });
    assert.deepEqual(h.render() && h.virtual()?.props.keepMounted, [0, 59]);
    // A focus that is not on a choice keeps nothing more.
    list().props.onFocusCapture({ target: { closest: () => null } });
    assert.deepEqual(h.render() && h.virtual()?.props.keepMounted, [0, 59]);
});

test("a focus asked for waits for its row to be measured, and is given without scrolling", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(60), virtualized: true });
    h.page.mountedRows = [0, 1, 20];
    h.render();
    h.fake(20).hidden = true;
    navigation(h).scrollToIndex(20, { focus: true });
    h.render();
    // virtua measures twice before the frame: still one frame.
    h.virtual()?.props.onResize();
    h.virtual()?.props.onResize();
    assert.equal(h.frames.size, 1);
    h.frame();
    assert.deepEqual(h.fake(20).focused, [], "not while the row is hidden");
    h.render();
    h.fake(20).hidden = false;
    h.virtual()?.props.onResize();
    h.frame();
    assert.deepEqual(h.fake(20).focused, [{ preventScroll: true }]);
});

test("a row that was drawn and then scrolled away is not focused until it is drawn again", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(60), virtualized: true });
    h.page.mountedRows = [0, 1, 20];
    h.render();
    const away = h.fake(20);
    h.page.mountedRows = [0, 1];
    h.render();
    navigation(h).scrollToIndex(20, { focus: true });
    h.render();
    h.frame();
    assert.deepEqual(away.focused, []);
    h.page.mountedRows = [0, 1, 20];
    h.render();
    h.virtual()?.props.onResize();
    h.frame();
    assert.deepEqual(away.focused, [{ preventScroll: true }]);
});

// A Tab key press on a choice, and whether the list took it.
function tab(h: Picker, index: number, keys: Record<string, unknown> = {}) {
    let prevented = false;
    h.tree.props.onKeyDown({ key: "Tab", target: h.fake(index), preventDefault: () => { prevented = true; }, defaultPrevented: false, ...keys });
    return prevented;
}

test("Tab in a long list moves to the next choice that can be chosen, Shift+Tab to the one before", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(60, index => index === 1), virtualized: true, isDisabled: (option: Option) => option.disabled === true });
    h.page.mountedRows = [0, 1, 2, 59];
    h.render();
    h.scrolled.length = 0;
    assert.equal(tab(h, 0), true);
    assert.deepEqual(h.scrolled.map(([row]) => row), [2], "past the disabled choice");
    assert.equal(tab(h, 2, { shiftKey: true }), true);
    assert.deepEqual(h.scrolled.map(([row]) => row), [2, 0]);
    // At either end, Tab leaves the list as the browser moves it.
    assert.equal(tab(h, 59), false);
    assert.equal(tab(h, 0, { shiftKey: true }), false);
    // With a modifier, or already handled, or not Tab: the list leaves it alone.
    for (const keys of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }, { key: "ArrowDown" }]) {
        assert.equal(tab(h, 0, keys), false, JSON.stringify(keys));
    }
    assert.equal(h.scrolled.length, 2);
});

test("Tab in a short list is the browser's", async context => {
    const h = await picker(context);
    await h.open({ options: optionsOf(4) });
    assert.equal(tab(h, 0), false);
});
