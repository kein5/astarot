import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { eventTarget, find, findIn, hooks, loadModule, nodesIn, setRef, stubGlobals, treeNode } from "../../../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../../../logics/test/hookHarness.ts";

// A settings dropdown (_DropdownMenu.tsx), a select-only combobox: what it shows, how the pointer
// and the keys open it, move in it and choose, where it opens, and what closes it. Which dropdown
// is open is kept in a stand-in of the store; the window and the document are stand-ins whose
// listeners the test calls; the root and the list are given boxes as the page would have them.

const t = (key: string) => key;
const list = { a: "Apple", b: "Banana", c: "Cherry" };

// The dropdowns a test drew, closed together when it ends, before the stand-in window goes.
const pagesByTest = new WeakMap<TestContext, HookRuntime[]>();
function closeWithTest(context: TestContext, runtime: HookRuntime) {
    const pages = pagesByTest.get(context);
    if (pages) { pages.push(runtime); return; }
    const opened = [runtime];
    pagesByTest.set(context, opened);
    context.onTestFinished(() => { for (const page of opened) page.unmount(); });
}

async function dropdown(context: TestContext, given: Record<string, unknown> = {}, place: { top?: number; bottom?: number; menu?: number | null } = {}) {
    const runtime = hooks(), chosen: unknown[] = [], scrolled: unknown[][] = [];
    closeWithTest(context, runtime);
    const win = { ...eventTarget(), innerHeight: 800 };
    const doc = eventTarget();
    stubGlobals(context, { window: win, document: doc });
    const store = { opened: "" as unknown, updates: [] as unknown[], openedLists: 0 };
    const module = await loadModule<typeof import("./_DropdownMenu.tsx")>(new URL("./_DropdownMenu.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@store": { useStore_IsOpenedDropdownMenu: () => ({ currentIsOpenedDropdownMenu: { data: store.opened },
            updateIsOpenedDropdownMenu: (value: unknown) => { store.updates.push(value); store.opened = value; } }) },
    });
    let props: Record<string, unknown> = { dropdown_id: "fruit", list, selected_id: "b", state: "ok", label: "Fruit",
        selectFunction: (selection: unknown) => { chosen.push(selection); }, openListFunction: () => { store.openedLists++; }, ...given };
    const box = { top: place.top ?? 100, bottom: place.bottom ?? 130 };
    const container = { getBoundingClientRect: () => box, contains: (target: unknown) => target === "inside" };
    const content = { offsetHeight: place.menu ?? 200,
        children: Object.keys(list).map((_, index) => ({ scrollIntoView: (options: unknown) => { scrolled.push([index, options]); } })) };
    // Draws the dropdown with its boxes in place before the effects run, as React would.
    const draw = (next: Record<string, unknown> = {}): TreeNode => {
        props = { ...props, ...next };
        const tree = runtime.render(module._DropdownMenu, { dropdown_id: "fruit", selectFunction() {}, ...props }, drawn => {
            const root = treeNode(drawn);
            assert.ok(root);
            setRef(root, container);
            if (place.menu !== null) setRef(findIn(root, node => node.props?.role === "listbox"), content);
        });
        const node = treeNode(tree);
        assert.ok(node);
        return node;
    };
    const toggle = (tree: TreeNode = draw()) => findIn(tree, node => node.props?.role === "combobox");
    const options = (tree: TreeNode = draw()) => nodesIn(tree).filter(node => node.props?.role === "option");
    const press = (key: string) => { let prevented = 0; toggle().props.onKeyDown({ key, preventDefault: () => { prevented++; } }); return prevented; };
    return { store, chosen, scrolled, win, doc, draw, toggle, options, press };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
const wrapperOf = (tree: TreeNode) => findIn(tree, node => classesOf(node).includes("dropdown_content_wrapper"));

test("closed, it is a combobox named by its labels that shows the chosen choice by its words", async context => {
    const d = await dropdown(context, { secondary_label: "(mic)", "aria-describedby": "why" });
    const tree = d.draw();
    const box = d.toggle(tree).props;
    const listbox = findIn(tree, node => node.props?.role === "listbox");
    assert.deepEqual([box.role, box.tabIndex, box["aria-label"], box["aria-describedby"], box["aria-haspopup"], box["aria-expanded"], box["aria-controls"], box["aria-disabled"],
        box["aria-activedescendant"]], ["combobox", 0, "Fruit (mic)", "why", "listbox", false, listbox.props.id, undefined, undefined]);
    assert.equal(textOf(findIn(d.toggle(tree), node => node.type === "p")), "Banana");
    assert.equal(textOf(d.options(tree)), "AppleBananaCherry");
    assert.deepEqual(classesOf(wrapperOf(tree)).includes("is_opened"), false);
    // Labels that are not text do not name it; a choice the list does not hold shows its id.
    assert.equal(d.toggle(d.draw({ label: 5, secondary_label: undefined })).props["aria-label"], undefined);
    assert.equal(textOf(findIn(d.toggle(d.draw({ selected_id: "kiwi" })), node => node.type === "p")), "kiwi");
    assert.equal(textOf(findIn(d.toggle(d.draw({ selected_id: 7, list: { 7: "Seven" } })), node => node.type === "p")), "Seven", "an id as a number finds its choice");
    // Not loaded yet: no words and no choices.
    const failed = d.draw({ state: "error", selected_id: "b", list });
    assert.equal(textOf(findIn(d.toggle(failed), node => node.type === "p")), "");
    assert.deepEqual(d.options(failed), []);
});

test("while it loads it says so, and neither the pointer nor the keys open it, as when it is turned off", async context => {
    const d = await dropdown(context, { state: "pending" });
    let tree = d.draw();
    const box = d.toggle(tree).props;
    assert.deepEqual([box.tabIndex, box["aria-disabled"]], [-1, true]);
    assert.equal(textOf(findIn(d.toggle(tree), node => node.type === "p")), "common.loading");
    assert.ok(find(d.toggle(tree), node => node.type === "span" && classesOf(node).includes("loader")));
    assert.ok(classesOf(d.toggle(tree)).includes("is_pending"));
    box.onClick();
    assert.deepEqual([d.press("Enter"), d.store.updates, d.store.openedLists], [0, [], 0]);
    tree = d.draw({ state: "ok", is_disabled: true });
    assert.deepEqual([d.toggle(tree).props.tabIndex, d.toggle(tree).props["aria-disabled"]], [-1, true]);
    assert.ok(classesOf(d.toggle(tree)).includes("is_disabled"));
    assert.ok(classesOf(wrapperOf(tree)).includes("is_disabled"));
    d.toggle(tree).props.onClick();
    assert.deepEqual([d.press("ArrowDown"), d.store.updates], [0, []]);
    tree = d.draw({ is_disabled: false });
    assert.deepEqual([classesOf(d.toggle(tree)).includes("is_pending"), classesOf(d.toggle(tree)).includes("is_disabled"), find(d.toggle(tree), node => classesOf(node).includes("loader"))],
        [false, false, null]);
});

test("a click opens it, asking for the list first, and closes it again; only one dropdown is open at a time", async context => {
    const d = await dropdown(context);
    d.toggle().props.onClick();
    assert.deepEqual([d.store.updates, d.store.openedLists], [["fruit"], 1]);
    let tree = d.draw();
    assert.deepEqual([d.toggle(tree).props["aria-expanded"], classesOf(wrapperOf(tree)).includes("is_opened")], [true, true]);
    assert.ok(classesOf(findIn(d.toggle(tree), node => classesOf(node).includes("arrow_left_svg"))).includes("is_opened"));
    d.toggle(tree).props.onClick();
    assert.deepEqual(d.store.updates, ["fruit", ""]);
    // Another dropdown open: this one shows closed.
    d.store.opened = "other";
    tree = d.draw();
    assert.equal(d.toggle(tree).props["aria-expanded"], false);
    const plain = await dropdown(context, { openListFunction: undefined });
    plain.toggle().props.onClick();
    assert.deepEqual(plain.store.updates, ["fruit"]);
});

test("Enter, Space or an arrow opens it; other keys do nothing while it is closed", async context => {
    for (const key of ["Enter", " ", "ArrowDown", "ArrowUp"]) {
        const d = await dropdown(context);
        assert.deepEqual([d.press(key), d.store.updates], [1, ["fruit"]], JSON.stringify(key));
    }
    const d = await dropdown(context);
    assert.deepEqual([d.press("Home"), d.press("a"), d.store.updates], [0, 0, []]);
});

test("open, the keys move from the chosen choice to the ends and choose; Tab closes", async context => {
    const d = await dropdown(context);
    d.store.opened = "fruit";
    let tree = d.draw();
    tree = d.draw();
    const active = () => d.toggle().props["aria-activedescendant"];
    const listId = findIn(tree, node => node.props?.role === "listbox").props.id;
    assert.equal(active(), `${listId}-1`, "starting on the chosen one");
    assert.deepEqual(d.options().map(option => [option.props.id, option.props["aria-selected"], classesOf(option).includes("is_selected"), classesOf(option).includes("is_active")]),
        [[`${listId}-0`, false, false, false], [`${listId}-1`, true, true, true], [`${listId}-2`, false, false, false]]);
    assert.deepEqual(d.scrolled, [[1, { block: "nearest" }]], "the highlighted choice is scrolled into view");
    assert.equal(d.press("ArrowDown"), 1);
    assert.equal(active(), `${listId}-2`);
    d.press("ArrowDown");
    assert.equal(active(), `${listId}-2`, "no further than the last");
    d.press("Home");
    assert.equal(active(), `${listId}-0`);
    d.press("ArrowUp");
    assert.equal(active(), `${listId}-0`, "no further than the first");
    d.press("End");
    assert.equal(active(), `${listId}-2`);
    d.press("ArrowUp");
    assert.equal(active(), `${listId}-1`);
    assert.deepEqual(d.scrolled.map(entry => entry[0]), [1, 2, 0, 2, 1]);
    assert.equal(d.press("Enter"), 1);
    assert.deepEqual([d.chosen, d.store.updates.at(-1)], [[{ dropdown_id: "fruit", selected_id: "b" }], ""]);
    d.store.opened = "fruit";
    d.draw();
    d.press("End");
    d.press(" ");
    assert.deepEqual(d.chosen.at(-1), { dropdown_id: "fruit", selected_id: "c" });
    d.store.opened = "fruit";
    d.draw();
    const beforeTab = d.store.updates.length;
    assert.deepEqual([d.press("Tab"), d.store.updates.slice(beforeTab)], [0, [""]]);
    d.store.opened = "fruit";
    d.draw();
    const before = d.store.updates.length;
    assert.equal(d.press("x"), 0);
    assert.equal(d.store.updates.length, before, "other keys do nothing");
    // Closed again, nothing is highlighted.
    d.store.opened = "";
    d.draw();
    assert.equal(d.draw() && active(), undefined);
});

test("closed, nothing is highlighted and the list waits below; opened later, the chosen one is highlighted once the list shows, and none stays highlighted after it closes", async context => {
    const d = await dropdown(context);
    const highlighted = (tree: TreeNode) => d.options(tree).map(option => classesOf(option).includes("is_active"));
    let tree = d.draw();
    assert.deepEqual(highlighted(tree), [false, false, false]);
    assert.deepEqual([classesOf(wrapperOf(tree)).includes("open_below"), classesOf(wrapperOf(tree)).includes("open_above")], [true, false]);
    assert.deepEqual(highlighted(d.draw()), [false, false, false], "nor once its effects have run");
    // Opened: the first drawing, before its effects, names no highlighted choice yet.
    d.store.opened = "fruit";
    tree = d.draw();
    assert.equal(d.toggle(tree).props["aria-activedescendant"], undefined);
    tree = d.draw();
    const listId = findIn(tree, node => node.props?.role === "listbox").props.id;
    assert.deepEqual([d.toggle(tree).props["aria-activedescendant"], highlighted(tree)], [`${listId}-1`, [false, true, false]]);
    // Closed: neither the first drawing nor the ones after name or mark a choice.
    d.store.opened = "";
    tree = d.draw();
    assert.equal(d.toggle(tree).props["aria-activedescendant"], undefined);
    assert.deepEqual(highlighted(d.draw()), [false, false, false]);
});

test("a choice not in the list starts on the first, and an empty list has nothing to choose", async context => {
    const d = await dropdown(context, { selected_id: "kiwi" });
    d.store.opened = "fruit";
    d.draw();
    const listId = findIn(d.draw(), node => node.props?.role === "listbox").props.id;
    assert.equal(d.toggle().props["aria-activedescendant"], `${listId}-0`);
    const empty = await dropdown(context, { list: [] });
    empty.store.opened = "fruit";
    empty.draw();
    empty.draw();
    assert.deepEqual(empty.options(), []);
    empty.press("Enter");
    assert.deepEqual(empty.chosen, []);
    const none = await dropdown(context, { list: undefined });
    assert.deepEqual(none.options(), []);
});

test("a click on a choice chooses it and closes the list", async context => {
    const d = await dropdown(context);
    d.store.opened = "fruit";
    d.options()[2].props.onClick();
    assert.deepEqual([d.chosen, d.store.updates], [[{ dropdown_id: "fruit", selected_id: "c" }], [""]]);
});

test("it opens above when there is not room below and more room above, and checks again when the window is resized", async context => {
    const wrapper = async (place: { top?: number; bottom?: number; menu?: number | null }) => {
        const d = await dropdown(context, {}, place);
        d.store.opened = "fruit";
        d.draw();
        return { d, classes: classesOf(wrapperOf(d.draw())) };
    };
    const below = await wrapper({ top: 100, bottom: 130 });
    assert.deepEqual([below.classes.includes("open_below"), below.classes.includes("open_above")], [true, false]);
    const above = await wrapper({ top: 650, bottom: 680 });
    assert.deepEqual([above.classes.includes("open_above"), above.classes.includes("open_below")], [true, false]);
    // Not enough room either way: it opens where there is more, and below when there is as much.
    assert.ok((await wrapper({ top: 300, bottom: 680, menu: 400 })).classes.includes("open_above"), "120 below, 300 above");
    assert.ok((await wrapper({ top: 100, bottom: 700, menu: 400 })).classes.includes("open_below"), "100 below, 100 above");
    assert.ok((await wrapper({ top: 650, bottom: 680, menu: 100 })).classes.includes("open_below"), "a short list fits below");
    assert.ok((await wrapper({ top: 570, bottom: 600, menu: 200 })).classes.includes("open_below"), "a list exactly as high as the room below fits there");
    assert.ok((await wrapper({ top: 650, bottom: 680, menu: null })).classes.includes("open_above"), "a list not measured yet counts as 200 high");
    // The window grows: there is room below now. (Each dropdown drawn above has a window of its own.)
    const { d } = await wrapper({ top: 650, bottom: 680 });
    assert.ok(classesOf(wrapperOf(d.draw())).includes("open_above"));
    d.win.innerHeight = 2000;
    d.win.dispatch("resize");
    assert.ok(classesOf(wrapperOf(d.draw())).includes("open_below"));
    assert.deepEqual(d.win.added.map(([type]) => type), ["resize"]);
    d.store.opened = "";
    d.draw();
    assert.deepEqual(d.win.removed.map(([type]) => type), ["resize"]);
});

test("a press outside it or Escape closes the open list; a press inside does not", async context => {
    const d = await dropdown(context);
    d.draw();
    assert.equal(d.doc.added.length, 0, "nothing to close while it is closed");
    d.store.opened = "fruit";
    d.draw();
    assert.deepEqual(d.doc.added.map(([type]) => type), ["pointerdown", "keydown"]);
    d.doc.dispatch("pointerdown", { target: "inside" });
    d.doc.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(d.store.updates, []);
    d.doc.dispatch("pointerdown", { target: "outside" });
    assert.deepEqual(d.store.updates, [""]);
    d.store.opened = "fruit";
    d.doc.dispatch("keydown", { key: "Escape" });
    assert.deepEqual(d.store.updates, ["", ""]);
    d.store.opened = "";
    d.draw();
    assert.deepEqual(d.doc.removed.map(([type]) => type), ["pointerdown", "keydown"]);
});
