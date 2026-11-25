import assert from "node:assert/strict";
import { test } from "vitest";
import { findIn, hooks, kitStandIns, loadModule, nodesIn, treeNode } from "../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../logics/test/hookHarness.ts";
import type { MultiDropdownEntry } from "./DropdownMenu.tsx";

// The select field of the settings rows (DropdownMenu.tsx): the kit's Select, a native <select>
// (D-14, decided 2026-11-25). The system draws the open list and gives the keys; the row says
// what the field holds, what it is named by, what it reports, and how it waits for the backend.

const list = { a: "Apple", b: "Banana", c: "Cherry" };

async function field(given: Record<string, unknown> = {}) {
    const chosen: unknown[] = [];
    const runtime = hooks();
    const module = await loadModule<typeof import("./DropdownMenu.tsx")>(new URL("./DropdownMenu.tsx", import.meta.url), runtime);
    const draw = (next: Record<string, unknown> = {}) => {
        const props = { dropdown_id: "fruit", list, selected_id: "b", state: "ok", label: "Fruit",
            selectFunction: (selection: unknown) => { chosen.push(selection); }, ...given, ...next };
        const node = treeNode(runtime.render(module.DropdownMenu, props));
        assert.ok(node);
        return node;
    };
    const select = (tree: TreeNode = draw()) => findIn(tree, node => node.type === kitStandIns.Select);
    const options = (tree: TreeNode = draw()) => nodesIn(select(tree)).filter(node => node.type === kitStandIns.SelectOption)
        .map(option => ({ value: option.props.value, words: option.props.children, disabled: option.props.disabled, hidden: option.props.hidden }));
    return { chosen, draw, select, options, module, runtime };
}

// An event as the handlers read it: whether it was held back.
const event = (more: Record<string, unknown> = {}) => {
    const sent = { prevented: 0, ...more, preventDefault: () => { sent.prevented++; } };
    return sent;
};

test("it is the kit's select, holding the choices in their order with the chosen one as its value", async () => {
    const f = await field({ "aria-describedby": "why" });
    const box = f.select().props;
    assert.deepEqual([box.value, box.disabled, box.tabIndex, box["aria-busy"], box["aria-disabled"], box["aria-label"], box["aria-describedby"], box.invalid],
        ["b", undefined, undefined, undefined, undefined, "Fruit", "why", undefined]);
    assert.deepEqual(f.options(), [
        { value: "a", words: "Apple", disabled: undefined, hidden: undefined },
        { value: "b", words: "Banana", disabled: undefined, hidden: undefined },
        { value: "c", words: "Cherry", disabled: undefined, hidden: undefined },
    ]);
    // An id given as a number finds its choice; numbers are words too.
    const numbers = f.draw({ selected_id: 7, list: { 5: 5, 7: 7 } });
    assert.equal(f.select(numbers).props.value, "7");
    assert.deepEqual(f.options(numbers).map(option => [option.value, option.words]), [["5", 5], ["7", 7]]);
});

test("its labels name it when they are text, and the second one shows over the field", async () => {
    const f = await field({ secondary_label: "(mic)" });
    const tree = f.draw();
    assert.equal(f.select(tree).props["aria-label"], "Fruit (mic)");
    const [label, select] = tree.props.children;
    assert.deepEqual([label.type, label.props.className, label.props.children], ["p", "secondary_label", "(mic)"]);
    assert.equal(select.type, kitStandIns.Select);
    assert.equal(tree.props.className, "each_dropdown_menu_wrapper");
    // Labels that are not text do not name it; with no second label nothing shows over the field.
    const plain = f.draw({ label: 5, secondary_label: undefined });
    assert.equal(f.select(plain).props["aria-label"], undefined);
    assert.equal(plain.props.children[0], undefined);
});

test("a choice reports the setting's id and the chosen id", async () => {
    const f = await field();
    f.select().props.onChange({ target: { value: "c" } });
    assert.deepEqual(f.chosen, [{ dropdown_id: "fruit", selected_id: "c" }]);
    // The pointer and the keys reach the system's list.
    const press = event(), key = event({ key: "ArrowDown" });
    f.select().props.onMouseDown(press);
    f.select().props.onKeyDown(key);
    assert.deepEqual([press.prevented, key.prevented], [0, 0]);
});

test("a value the list does not hold still shows on the field, kept out of the open list", async () => {
    const f = await field({ selected_id: "kiwi" });
    assert.equal(f.select().props.value, "kiwi");
    assert.deepEqual(f.options(), [
        { value: "kiwi", words: "kiwi", disabled: true, hidden: true },
        { value: "a", words: "Apple", disabled: undefined, hidden: undefined },
        { value: "b", words: "Banana", disabled: undefined, hidden: undefined },
        { value: "c", words: "Cherry", disabled: undefined, hidden: undefined },
    ]);
    // The words a page gives in place of a value, as the model fields do when a key is needed.
    const needed = f.draw({ selected_id: "A key is needed", list: [], is_disabled: true });
    assert.deepEqual([f.select(needed).props.value, f.select(needed).props.disabled], ["A key is needed", true]);
    assert.deepEqual(f.options(needed), [{ value: "A key is needed", words: "A key is needed", disabled: true, hidden: true }]);
    // Nothing chosen yet: an empty field.
    for (const selected_id of [null, undefined]) {
        const none = f.draw({ selected_id });
        assert.equal(f.select(none).props.value, "");
        assert.deepEqual(f.options(none)[0], { value: "", words: "", disabled: true, hidden: true });
    }
    // An empty id the list holds is a choice like the others.
    const automatic = f.draw({ selected_id: "", list: { "": "Automatic", x: "X" } });
    assert.deepEqual(f.options(automatic).map(option => [option.value, option.hidden]), [["", undefined], ["x", undefined]]);
    const none = await field({ list: undefined });
    assert.deepEqual(none.options(), [{ value: "b", words: "b", disabled: true, hidden: true }]);
});

test("before its value is read it holds no choices", async () => {
    const f = await field({ state: "error" });
    assert.deepEqual(f.options(), []);
    assert.equal(f.select().props.value, "b");
    assert.deepEqual(f.options(f.draw({ state: undefined })), []);
});

test("while it waits it says so and keeps focus, and neither the pointer nor the keys open or change it", async () => {
    const f = await field({ state: "pending" });
    const box = f.select().props;
    // Not the disabled attribute: that would take focus away from a field chosen with the keys.
    assert.deepEqual([box.value, box.disabled, box.tabIndex, box["aria-busy"], box["aria-disabled"]], ["b", undefined, -1, true, true]);
    assert.deepEqual(f.options(), [{ value: "b", words: "common.loading", disabled: undefined, hidden: undefined }]);
    const press = event(), keys = ["Enter", " ", "ArrowDown", "ArrowUp", "F4", "a"].map(key => event({ key })), tab = event({ key: "Tab" });
    box.onMouseDown(press);
    for (const key of keys) box.onKeyDown(key);
    box.onKeyDown(tab);
    assert.deepEqual([press.prevented, keys.map(key => key.prevented), tab.prevented], [1, [1, 1, 1, 1, 1, 1], 0], "Tab still leaves it");
    box.onChange({ target: { value: "c" } });
    assert.deepEqual(f.chosen, []);
    // Turned off as well: the attribute, as when it is not waiting.
    assert.equal(f.select(f.draw({ is_disabled: true })).props.disabled, true);
    // The answer came: the choices are back and a choice is reported.
    const ok = f.select(f.draw({ state: "ok" })).props;
    assert.deepEqual([ok.tabIndex, ok["aria-busy"], ok["aria-disabled"]], [undefined, undefined, undefined]);
    ok.onChange({ target: { value: "c" } });
    assert.deepEqual(f.chosen, [{ dropdown_id: "fruit", selected_id: "c" }]);
});

test("a row of select fields puts each in the column, with the parts beside or among them", async () => {
    const f = await field();
    const Check = (_: { at: string }) => null;
    const dropdown_settings: MultiDropdownEntry<{ at: string }>[] = [
        { insert_component: Check, insert_component_props: { at: "before" }, insert_to: "before" },
        { dropdown_id: "host", list, selected_id: "a", state: "ok", secondary_label: "Host", selectFunction() {} },
        { insert_component: Check, insert_component_props: { at: "among" } },
        { dropdown_id: "device", list, selected_id: "c", state: "ok", secondary_label: "Device", selectFunction() {}, "aria-describedby": "own" },
        { insert_component: Check, insert_component_props: { at: "after" }, insert_to: "after" },
    ];
    const tree = treeNode(f.runtime.render(f.module.MultiDropdownMenu, {
        "aria-labelledby": "row-label", "aria-describedby": "row-help", is_break_point: true, dropdown_settings,
    }));
    assert.ok(tree);
    assert.deepEqual([tree.props.role, tree.props["aria-labelledby"], tree.props["aria-describedby"], tree.props.className],
        ["group", "row-label", "row-help", "container is_break_point"]);
    const [before, column, after] = tree.props.children.props.children;
    assert.deepEqual([before.map((node: TreeNode) => node.props.at), after.map((node: TreeNode) => node.props.at)], [["before"], ["after"]]);
    assert.equal(column.props.className, "wrapper");
    const [host, among, device] = column.props.children;
    assert.deepEqual([host.key, among.props.at, device.key], ["host", "among", "device"]);
    // Each field is described by the row's help, then by its own.
    assert.deepEqual([host.props["aria-describedby"], device.props["aria-describedby"]], ["row-help", "row-help own"]);
    const alone = treeNode(f.runtime.render(f.module.MultiDropdownMenu, { dropdown_settings: [{ dropdown_id: "", list, selectFunction() {} }] }));
    assert.ok(alone);
    assert.equal(alone.props.className, "container");
    const [lone] = alone.props.children.props.children[1].props.children;
    assert.deepEqual([lone.key, lone.props["aria-describedby"]], ["inner-0", undefined]);
});
