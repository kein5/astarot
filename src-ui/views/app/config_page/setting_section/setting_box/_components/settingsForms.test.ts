import assert from "node:assert/strict";
import { test } from "vitest";
import type { ReactNode } from "react";
import clsx from "clsx";
import { rebaseDraft } from "../../../../../../logics/voice/draftRebase.ts";
import { changedPaths } from "../../../../../../logics/voice/saveBar.ts";
import { hooks, loadModule, findIn, nodesIn, draw, drawWith, componentNamed, refOf, setRef, stubGlobals, eventTarget, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as fieldErrors from "../../../../../../logics/configs/fieldErrors.ts";

// The nodes of a tree the predicate picks, in the order find visits them.
const all = (tree: unknown, predicate: (node: TreeNode) => unknown) => nodesIn(tree).filter(predicate);
const key = (name?: string) => ({ key: name, nativeEvent: {}, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
interface FakeDocument {
    body: object;
    activeElement?: unknown;
}
const focusNode = (document: FakeDocument) => ({ focus() { document.activeElement = this; }, blur() { document.activeElement = document.body; } });


interface Row {
    word: unknown;
    key: string | null;
    button: TreeNode;
    node: ReturnType<typeof focusNode>;
    rendered: ReactNode;
}

for (const index of [0, 1, 2]) test(`word filter names its delete buttons and focuses a neighbour after deleting index ${index}`, async t => {
    const runtime = hooks(), document: FakeDocument = { body: {}, activeElement: null };
    t.onTestFinished(() => runtime.unmount());
    stubGlobals(t, { document, window: eventTarget(), requestAnimationFrame: (fn: () => void) => fn() });
    const { useSettingsDraft } = await loadModule<typeof import("../../../../../../logics/voice/useSettingsDraft.tsx")>(new URL("../../../../../../logics/voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, "./saveBar": { changedPaths, setSaveBarEntry() {} },
    });
    type WordList = { data: string[] };
    const state = { currentMicWordFilterList: { data: ["alpha", "日本語", "gamma"] },
        updateMicWordFilterList(fn: (current: WordList) => string[]) { this.currentMicWordFilterList.data = fn(this.currentMicWordFilterList); },
        setMicWordFilterList: () => {} };
    // The production hook's functions are destructured, so the fake uses closures too.
    state.updateMicWordFilterList = fn => { state.currentMicWordFilterList.data = fn(state.currentMicWordFilterList); };
    const Entry = () => null;
    const { WordFilter } = await loadModule<typeof import("./word_filter/WordFilter.tsx")>(new URL("./word_filter/WordFilter.tsx", import.meta.url), runtime, { "../../../../../../../logics/configs/fieldErrors.ts": fieldErrors, "../field_problem/FieldProblem": { FieldProblem: "field-problem" },
        "../../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft },
        "@logics_configs": { useTranscription: () => state },
        "@store": { useStore_IsOpenedMicWordFilterList: () => ({ currentIsOpenedMicWordFilterList: { data: true } }) },
        "@useI18n": { useI18n: () => ({ t: (name: string, values?: { word?: string }) => values?.word ? `Remove ${values.word}` : name }) },
        "../_atoms/_entry/_Entry": { _Entry: Entry }, "../fold/Fold": { Fold: "fold" },
    });
    const buttons = new Map<string | null, ReturnType<typeof focusNode>>(), entryNode = focusNode(document);
    let rows: Row[] = [];
    const render = () => runtime.render(WordFilter, {}, tree => {
        setRef(findIn(tree, node => node.type === Entry), entryNode);
        rows = all(tree, node => node.props?.deleteAction).map(row => {
            const rendered = draw(row);
            // Each word's delete is the kit's danger icon Button.
            const button = findIn(rendered, node => node.type === kitStandIns.Button);
            assert.deepEqual([button.props.tone, button.props.size], ["danger", "icon"]);
            const node = buttons.get(row.key) ?? focusNode(document);
            buttons.set(row.key, node);
            setRef(button, node);
            return { word: row.props.value, key: row.key, button, node, rendered };
        });
    });
    render();
    const original = rows.slice();
    for (const row of rows) {
        assert.equal(row.key, `.$${row.word}`);
        assert.equal(row.button.props["aria-label"], `Remove ${row.word}`);
        assert.equal(row.button.props.children.props["aria-hidden"], "true");
        assert.equal(row.button.props.children.props.focusable, "false");
    }
    const remove = (row: Row | undefined) => {
        assert.ok(row);
        row.node.focus();
        row.button.props.onClick({ currentTarget: row.node });
        document.activeElement = document.body; // Native removal of the focused button.
        render();
    };
    remove(rows[index]);
    assert.equal(document.activeElement, original[index === 2 ? 1 : index + 1].node);
    while (rows.length) remove(rows[0]);
    assert.equal(document.activeElement, entryNode);
});

test("checkbox input stays mounted and focused through pending, including rejection", async t => {
    const runtime = hooks(), document: FakeDocument = { body: {} };
    stubGlobals(t, { document });
    const { Checkbox } = await loadModule<typeof import("../../../../../common_components/checkbox/Checkbox.tsx")>(new URL("../../../../../common_components/checkbox/Checkbox.tsx", import.meta.url), runtime);
    let toggles = 0;
    const props = { label: "Show resend button", variable: { state: "ok", data: false }, toggleFunction: () => toggles++ };
    const render = () => runtime.render(Checkbox, props);
    const original = findIn(render(), node => node.type === "input");
    const focused = focusNode(document); focused.focus();
    original.props.onChange();
    assert.equal(toggles, 1);
    for (const state of ["pending", "ok"]) {
        props.variable.state = state;
        const tree = render(), input = findIn(tree, node => node.type === "input");
        assert.equal(input.type, original.type);
        assert.equal(input.key, original.key);
        assert.notEqual(input.props.disabled, true);
        assert.equal(input.props["aria-busy"], state === "pending");
        assert.equal(input.props["aria-disabled"], state === "pending");
        // The input remains in the same child slot, immediately before its focus drawing.
        const label = findIn(tree, node => node.type === "label");
        assert.equal(label.props.children[0].props, input.props);
        assert.equal(label.props.children[1].props.className, "cbx");
        assert.equal(document.activeElement, focused);
        if (state === "pending") {
            input.props.onChange();
            const click = key(); input.props.onClick(click);
            const space = key(" "); input.props.onKeyDown(space);
            assert.equal(click.defaultPrevented, true);
            assert.equal(space.defaultPrevented, true);
            assert.equal(toggles, 1);
            assert.equal(label.props.children[2].props["aria-hidden"], "true");
        }
    }
});

for (const label of ["WebSocket locked by OBS", "Mic mute sync without OSC", "OCR detector not installed"]) {
    test(`unavailable checkbox ignores click, Space and change: ${label}`, async () => {
        const runtime = hooks();
        const { Checkbox } = await loadModule<typeof import("../../../../../common_components/checkbox/Checkbox.tsx")>(new URL("../../../../../common_components/checkbox/Checkbox.tsx", import.meta.url), runtime);
        let calls = 0;
        const tree = runtime.render(Checkbox, { label, variable: { state: "ok", data: false }, is_available: false,
            "aria-describedby": "warning", toggleFunction: () => calls++ });
        const input = findIn(tree, node => node.type === "input");
        assert.equal(input.props["aria-disabled"], true);
        assert.equal(input.props["aria-describedby"], "warning");
        for (const [handler, name] of [["onClick", undefined], ["onKeyDown", " "], ["onKeyDown", "Enter"]] as const) {
            const event = key(name); input.props[handler](event); assert.equal(event.defaultPrevented, true);
        }
        input.props.onChange();
        assert.equal(calls, 0);
    });
}

// The props the three fields with a save button are given here.
interface SaveFieldProps {
    label: string;
    variable: string;
    state: string;
    "aria-describedby": string;
    saveFunction: () => unknown;
    onChangeFunction: () => unknown;
}

for (const [name, path] of [["EntryWithSaveButton", "entry_with_save_button"], ["AuthKey", "auth_key"], ["ColorEntryWithSaveButton", "color_entry_with_save_button"]]) {
    test(`${name} Enter saves once, keeps focus and guards pending editing`, async t => {
        const runtime = hooks(), inputRuntime = hooks(), document: FakeDocument = { ...eventTarget(), body: {} };
        stubGlobals(t, { document, window: eventTarget() });
        inputRuntime.api.useImperativeHandle = () => {};
        const { _Entry } = await loadModule<typeof import("./_atoms/_entry/_Entry.tsx")>(new URL("./_atoms/_entry/_Entry.tsx", import.meta.url), inputRuntime);
        const module = await loadModule(new URL(`./${path}/${name}.tsx`, import.meta.url), runtime, {
            clsx: { clsx }, "../_atoms/_entry/_Entry": { _Entry }, "react-colorful": { HexColorPicker: () => null },
            "../field_problem/FieldProblem": { FieldProblem: "field-problem" },
        });
        // One of the three fields with a save button, picked by name; each takes the props below.
        const Component = componentNamed(module, name);
        let saves = 0, edits = 0;
        const props: SaveFieldProps = { label: "Field", variable: "", state: "ok", "aria-describedby": "help",
            saveFunction: () => saves++, onChangeFunction: () => edits++ };
        const node = focusNode(document); node.focus();
        const render = () => {
            const entry = findIn(runtime.render(Component, props), item => item.type === _Entry);
            if (refOf(entry)) setRef(entry, node);
            return findIn(inputRuntime.render(_Entry, entry.props), item => item.type === "input");
        };
        let input = render();
        input.props.onKeyDown({ ...key("Enter"), target: node });
        assert.equal(saves, 1);
        assert.equal(document.activeElement, node);
        props.state = "pending";
        input = render();
        assert.equal(input.props.disabled, false);
        assert.equal(input.props.readOnly, true);
        assert.equal(input.props["aria-busy"], true);
        assert.equal(input.props["aria-describedby"], "help");
        input.props.onKeyDown({ ...key("Enter"), target: node });
        input.props.onChange({ target: { value: "changed" } });
        assert.equal(saves, 1); assert.equal(edits, 0);
        assert.equal(document.activeElement, node);
        const elsewhere = focusNode(document); elsewhere.focus();
        props.state = "ok"; render();
        assert.equal(document.activeElement, elsewhere);
        runtime.unmount();
    });
}

// #1111: a field that saves by itself saves when focus leaves it, puts the saved value back on
// Escape, and says its problem under it, tied to the field for screen readers.
test("a text field that saves by itself saves on leaving, reverts on Escape and says its problem", async () => {
    const runtime = hooks(), inputRuntime = hooks();
    inputRuntime.api.useImperativeHandle = () => {};
    const { _Entry } = await loadModule<typeof import("./_atoms/_entry/_Entry.tsx")>(new URL("./_atoms/_entry/_Entry.tsx", import.meta.url), inputRuntime);
    const { EntryWithSaveButton } = await loadModule<typeof import("./entry_with_save_button/EntryWithSaveButton.tsx")>(
        new URL("./entry_with_save_button/EntryWithSaveButton.tsx", import.meta.url), runtime, {
            "../_atoms/_entry/_Entry": { _Entry }, "../field_problem/FieldProblem": { FieldProblem: "field-problem" } });
    let saves = 0, reverts = 0;
    const props: Parameters<typeof EntryWithSaveButton>[0] = { label: "Field", variable: "x", state: "ok", "aria-describedby": "help",
        saveFunction: () => saves++, onRevert: () => reverts++, autoSave: true, error: null };
    const entryOf = (tree: unknown) => findIn(tree, node => node.type === _Entry);
    let entry = entryOf(runtime.render(EntryWithSaveButton, props));
    entry.props.onBlur();
    assert.equal(saves, 1);
    entry.props.onKeyDown(key("Escape"));
    entry.props.onKeyDown(key("a"));
    assert.equal(reverts, 1);
    assert.equal(entry.props["aria-invalid"], undefined);
    assert.equal(entry.props["aria-describedby"], "help");
    props.error = "The window name is empty.";
    const drawn = runtime.render(EntryWithSaveButton, props);
    entry = entryOf(drawn);
    const problem = findIn(drawn, node => node.type === "field-problem");
    assert.equal(problem.props.text, props.error);
    assert.equal(entry.props["aria-invalid"], true);
    assert.equal(entry.props["aria-describedby"], `help ${problem.props.id}`);
    // While a save waits, leaving the field saves nothing more.
    props.state = "pending";
    entryOf(runtime.render(EntryWithSaveButton, props)).props.onBlur();
    assert.equal(saves, 1);
    // A field with its own leave function gets the blur, which says where focus goes (a field of a pair).
    const left: unknown[] = [], blur = { relatedTarget: "the other field" };
    props.state = "ok"; props.leaveFunction = event => { left.push(event); };
    entryOf(runtime.render(EntryWithSaveButton, props)).props.onBlur(blur);
    assert.deepEqual([saves, left], [1, [blur]]);
    props.leaveFunction = undefined;
    // A field saved from the bar keeps its old behaviour: leaving it saves nothing, no problem is drawn.
    props.autoSave = false; props.state = "ok";
    const plain = runtime.render(EntryWithSaveButton, props);
    assert.equal(entryOf(plain).props.onBlur, undefined);
    assert.equal(all(plain, node => node.type === "field-problem").length, 0);
    runtime.unmount();
});

// #1111, decided 2: an API key field that saves by itself leaves through its own function (an
// empty field keeps the key), Enter still saves, Escape puts the saved key back, and the reason a
// key was refused is under the field.
test("an API key field that saves by itself leaves, reverts and says its problem", async () => {
    const runtime = hooks(), inputRuntime = hooks();
    inputRuntime.api.useImperativeHandle = () => {};
    const { _Entry } = await loadModule<typeof import("./_atoms/_entry/_Entry.tsx")>(new URL("./_atoms/_entry/_Entry.tsx", import.meta.url), inputRuntime);
    const { AuthKey } = await loadModule<typeof import("./auth_key/AuthKey.tsx")>(new URL("./auth_key/AuthKey.tsx", import.meta.url), runtime, {
        "../_atoms/_entry/_Entry": { _Entry }, "../field_problem/FieldProblem": { FieldProblem: "field-problem" } });
    let saves = 0, leaves = 0, reverts = 0;
    const props: Parameters<typeof AuthKey>[0] = { label: "Key", variable: "", state: "ok", "aria-describedby": "help",
        onChangeFunction: () => {}, saveFunction: () => saves++, leaveFunction: () => leaves++, onRevert: () => reverts++, autoSave: true, error: null };
    const entryOf = (tree: unknown) => findIn(tree, node => node.type === _Entry);
    let entry = entryOf(runtime.render(AuthKey, props));
    entry.props.onBlur();
    assert.deepEqual([saves, leaves], [0, 1], "leaving goes through the leave function, not the Enter one");
    entry.props.onKeyDown(key("Escape"));
    assert.equal(reverts, 1);
    props.error = "The key was not accepted.";
    const drawn = runtime.render(AuthKey, props);
    entry = entryOf(drawn);
    const problem = findIn(drawn, node => node.type === "field-problem");
    assert.equal(problem.props.text, props.error);
    assert.equal(entry.props["aria-invalid"], true);
    assert.equal(entry.props["aria-describedby"], `help ${problem.props.id}`);
    props.autoSave = false;
    const plain = runtime.render(AuthKey, props);
    assert.equal(entryOf(plain).props.onBlur, undefined);
    assert.equal(all(plain, node => node.type === "field-problem").length, 0);
    runtime.unmount();
});

// #1111: a color field that saves by itself saves when focus leaves it and when the picker closes
// after a color is chosen. Escape in the field puts the saved color back, but with the picker open
// it only closes the picker, which keeps the chosen color.
test("a color field that saves by itself saves on leaving and on closing the picker", async t => {
    const runtime = hooks(), document = eventTarget();
    stubGlobals(t, { document, window: eventTarget() });
    const { ColorEntryWithSaveButton } = await loadModule<typeof import("./color_entry_with_save_button/ColorEntryWithSaveButton.tsx")>(
        new URL("./color_entry_with_save_button/ColorEntryWithSaveButton.tsx", import.meta.url), runtime, {
            clsx: { clsx }, "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
            "../_atoms/_entry/_Entry": { _Entry: "entry" }, "react-colorful": { HexColorPicker: "picker" },
            "../field_problem/FieldProblem": { FieldProblem: "field-problem" } });
    let saves: string[] = [], reverts = 0;
    const props: Parameters<typeof ColorEntryWithSaveButton>[0] = { label: "Font color", variable: "#FFFFFF", state: "ok",
        saveFunction: () => saves.push("first"), onRevert: () => reverts++, autoSave: true, error: null };
    const entryOf = (tree: unknown) => findIn(tree, node => node.type === "entry");
    const swatchOf = (tree: unknown) => findIn(tree, node => node.type === "button");
    let tree = runtime.render(ColorEntryWithSaveButton, props);
    entryOf(tree).props.onBlur();
    assert.deepEqual(saves, ["first"], "leaving the field saves");
    entryOf(tree).props.onKeyDown(key("Escape"));
    assert.equal(reverts, 1, "Escape in the field puts the saved color back");
    // Open the picker, choose a color (the page's save now reads it), and close the picker.
    swatchOf(tree).props.onClick();
    tree = runtime.render(ColorEntryWithSaveButton, props);
    assert.equal(swatchOf(tree).props["aria-expanded"], true);
    entryOf(tree).props.onKeyDown(key("Escape"));
    assert.equal(reverts, 1, "with the picker open, Escape does not revert");
    saves = []; props.saveFunction = () => saves.push("chosen");
    tree = runtime.render(ColorEntryWithSaveButton, props);
    document.dispatch("keydown", { key: "Escape" });
    tree = runtime.render(ColorEntryWithSaveButton, props);
    assert.equal(swatchOf(tree).props["aria-expanded"], false);
    assert.deepEqual(saves, ["chosen"], "closing the picker saves the chosen color with the latest save");
    // The problem is said under the field and tied to it.
    props.error = "Enter # and six characters.";
    tree = runtime.render(ColorEntryWithSaveButton, props);
    const problem = findIn(tree, node => node.type === "field-problem");
    assert.equal(problem.props.text, props.error);
    assert.equal(entryOf(tree).props["aria-invalid"], true);
    assert.equal(entryOf(tree).props["aria-describedby"], problem.props.id);
    // A color field saved from the bar keeps its old behaviour.
    props.autoSave = false;
    tree = runtime.render(ColorEntryWithSaveButton, props);
    assert.equal(entryOf(tree).props.onBlur, undefined);
    assert.equal(all(tree, node => node.type === "field-problem").length, 0);
    runtime.unmount();
});

test("threshold Enter commits without blur or a duplicate blur-triggered save", async t => {
    const runtime = hooks(), saves: string[] = [], document: FakeDocument = { body: {} };
    stubGlobals(t, { document });
    const Entry = () => null;
    const { ThresholdEntry } = await loadModule<typeof import("./threshold_component/threshold_entry/ThresholdEntry.tsx")>(new URL("./threshold_component/threshold_entry/ThresholdEntry.tsx", import.meta.url), runtime, {
        "../../_atoms/_entry/_Entry": { _Entry: Entry },
    });
    const wrapper = ThresholdEntry({ ui_threshold: 120, setThresholdFunction: value => saves.push(value) });
    // The input component the wrapper draws, a function component of ThresholdEntry.tsx.
    const input = drawWith(runtime, wrapper);
    const node = focusNode(document); node.focus();
    input.props.onEnterPressed({ target: node });
    assert.equal(document.activeElement, node);
    assert.deepEqual(saves, ["120"]);
    runtime.unmount();
});

test("_Entry forwards ARIA relations and Enter ignores IME confirmation", async () => {
    const runtime = hooks(); runtime.api.useImperativeHandle = () => {};
    const { _Entry } = await loadModule<typeof import("./_atoms/_entry/_Entry.tsx")>(new URL("./_atoms/_entry/_Entry.tsx", import.meta.url), runtime);
    const aria = { "aria-label": "Name", "aria-labelledby": "label", "aria-describedby": "help error",
        "aria-invalid": true, "aria-busy": true, "aria-disabled": true, "aria-controls": "popup", "aria-expanded": false };
    let saves = 0;
    const input = findIn(runtime.render(_Entry, { ...aria, onEnterPressed: () => saves++ }), node => node.type === "input");
    for (const [name, value] of Object.entries(aria)) assert.equal(input.props[name], value);
    input.props.onKeyDown({ ...key("Enter"), nativeEvent: { isComposing: true } });
    input.props.onKeyDown({ ...key("Enter"), keyCode: 229 });
    assert.equal(saves, 0);
});
