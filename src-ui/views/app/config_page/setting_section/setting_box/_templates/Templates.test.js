import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.ts";

const base = "../_components/";
const all = (tree, predicate) => {
    const result = [];
    find(tree, node => { if (predicate(node)) result.push(node); return false; });
    return result;
};
// The hint module (#614): `on` is whether the page keeps descriptions out of sight.
const hintModule = on => ({ "../hint/Hint": { Hint: "hint", useHintDescriptions: () => on } });
async function setup(hints = false) {
    const runtime = hooks();
    const { LabelComponent } = await loadModule(new URL(base + "label_component/LabelComponent.tsx", import.meta.url), hooks(), {
        "../_atoms/_open_webpage_button/_OpenWebpageButton": { _OpenWebpageButton: "webpage" },
        "../description/Description": { Description: "description" }, ...hintModule(hints),
    });
    const { RadioButton } = await loadModule(new URL(base + "radio_button/RadioButton.tsx", import.meta.url), hooks(), hintModule(hints));
    const { DownloadModels } = await loadModule(new URL(base + "download_models/DownloadModels.tsx", import.meta.url), hooks(), {
        "../index": { RadioButton }, "../_atoms/_download_button/_DownloadButton": { _DownloadButton: "download" },
    });
    const { DropdownMenu, MultiDropdownMenu } = await loadModule(new URL(base + "dropdown_menu/DropdownMenu.tsx", import.meta.url), hooks(), {
        "../_atoms/_dropdown_menu/_DropdownMenu": { _DropdownMenu: "dropdown" },
    });
    const components = { LabelComponent, RadioButton, DownloadModels, DropdownMenu, MultiDropdownMenu,
        EntryWithSaveButton: "save-entry", AuthKey: "auth", ColorEntryWithSaveButton: "color",
        Slider: "slider", WordFilter: "word-filter", WordFilterListToggleComponent: "word-toggle",
        HotkeysEntry: "hotkey", ActionButton: "action", MessageFormat: "message", ConnectionCheckButton: "check" };
    const templates = await loadModule(new URL("./Templates.tsx", import.meta.url), runtime, {
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        "../_components": components, "@common_components": { Checkbox: "checkbox" },
    });
    const render = (name, props) => {
        let tree = runtime.render(templates[name], props);
        if (tree.type.name === "CommonContainer") tree = runtime.render(tree.type, tree.props);
        return tree;
    };
    return { runtime, templates, components, render };
}

for (const name of ["Checkbox", "EntryWithSaveButton", "AuthKey", "ColorEntryWithSaveButton", "Slider", "DropdownMenu", "RadioButton", "DownloadModels", "ActionButton", "HotkeysEntry", "ConnectionCheckButton"]) {
    test(`${name} template connects description and warning IDs without changing its label`, async () => {
        const s = await setup();
        const props = { label: "Setting", desc: "Help", add_warnings: [{ label: "Unavailable" }], "aria-describedby": "existing-help" };
        const tree = s.render(`${name}Container`, props);
        const label = find(tree, node => node.type === s.components.LabelComponent);
        const control = tree.props.children[1];
        const renderedLabel = label.type(label.props);
        const help = find(renderedLabel, node => node.type === "description");
        const warning = find(renderedLabel, node => node.props?.className === "warnings_section");
        assert.equal(control.props["aria-describedby"], `existing-help ${help.props.id} ${warning.props.id}`);
        assert.equal(control.props["aria-labelledby"], find(renderedLabel, node => node.props?.children === "Setting").props.id);
        assert.equal(control.props.label, "Setting");
        const next = s.render(`${name}Container`, props).props.children[1];
        assert.equal(next.props["aria-describedby"], control.props["aria-describedby"]);
    });
}

for (const name of ["RadioButton", "DownloadModels"]) test(`${name} exposes a labelled radio group and keeps individual option labels`, async () => {
    const s = await setup();
    const tree = s.render(`${name}Container`, { label: "Recognition engine", desc: "Choose one", name: "engine",
        checked_variable: { state: "ok", data: "a" }, options: [{ id: "a", label: "Engine A", is_downloaded: true }] });
    const label = tree.props.children[0], control = tree.props.children[1];
    let group = control.type(control.props);
    if (name === "DownloadModels") { const radio = find(group, node => node.type === s.components.RadioButton); group = radio.type(radio.props); }
    assert.equal(group.props.role, "radiogroup");
    assert.equal(group.props["aria-labelledby"], label.props.label_id);
    assert.equal(group.props["aria-describedby"], label.props.description_id);
    assert.ok(find(group, node => node.type === "label"));
    assert.equal(find(group, node => node.type === "input").props.name, "engine");
});

test("a radio choice that waits on the engine keeps its radios focusable but ignores presses until it settles", async () => {
    const s = await setup();
    const chosen = [];
    const tree = s.render("RadioButtonContainer", { label: "Recognition engine", name: "engine", selectFunction: id => chosen.push(id),
        checked_variable: { state: "ok", data: "a" }, options: [{ id: "a", label: "Engine A" }, { id: "b", label: "Engine B" },
            { id: "c", label: "Engine C", disabled: true }] });
    const control = tree.props.children[1];
    const inputs = state => all(control.type({ ...control.props, checked_variable: { state, data: "a" } }), node => node.type === "input")
        .map(node => node.props);
    assert.deepEqual(inputs("ok").map(input => [input.disabled, input["aria-disabled"]]), [[false, undefined], [false, undefined], [true, undefined]]);
    inputs("ok")[1].onChange();
    assert.deepEqual(chosen, ["b"]);
    // A disabled radio would drop the keyboard focus of the one just chosen; aria-disabled keeps it.
    const waiting = inputs("pending");
    assert.deepEqual(waiting.map(input => [input.disabled, input["aria-disabled"]]), [[false, true], [false, true], [true, undefined]]);
    waiting[0].onChange();
    assert.deepEqual(chosen, ["b"], "a press while waiting changes nothing");
});

test("a radio row split into groups keeps one choice: a labelled group around radiogroups named by their visible labels", async () => {
    const s = await setup();
    const groups = [{ id: "local", label: "On your PC", options: [{ id: "a", label: "Engine A" }] },
        { id: "api", label: "API", options: [{ id: "b", label: "Engine B" }, { id: "c", label: "Engine C", disabled: true }] }];
    const chosen = [];
    const tree = s.render("RadioButtonContainer", { label: "Recognition engine", desc: "Choose one", name: "engine", groups,
        selectFunction: id => chosen.push(id), checked_variable: { state: "ok", data: "a" } });
    const label = tree.props.children[0], control = tree.props.children[1];
    const group = control.type(control.props);
    assert.equal(group.props.role, "group");
    assert.equal(group.props["aria-labelledby"], label.props.label_id);
    assert.equal(group.props["aria-describedby"], label.props.description_id);
    const systems = all(group, node => node.props?.role === "radiogroup");
    assert.deepEqual(systems.map(node => find(group, other => other.props?.id === node.props["aria-labelledby"]).props.children), ["On your PC", "API"]);
    // One native set (one name): the arrow keys move across the groups, and Tab stops once.
    const inputs = all(group, node => node.type === "input").map(node => node.props);
    assert.deepEqual(inputs.map(input => [input.value, input.name, input.checked, input.disabled]),
        [["a", "engine", true, false], ["b", "engine", false, false], ["c", "engine", false, true]]);
    inputs[1].onChange();
    assert.deepEqual(chosen, ["b"]);
});

test("multi-select row has a group label and each dropdown receives the shared help", async () => {
    const s = await setup();
    const tree = s.render("MultiDropdownMenuContainer", { label: "Compute device", desc: "Help", dropdown_settings: [
        { dropdown_id: "device", secondary_label: "Device" }, { dropdown_id: "type", secondary_label: "Type" },
    ] });
    const label = tree.props.children[0], control = tree.props.children[1], group = control.type(control.props);
    assert.equal(group.props.role, "group");
    assert.equal(group.props["aria-labelledby"], label.props.label_id);
    for (const dropdown of all(group, node => node.type === s.components.DropdownMenu)) {
        const atom = find(dropdown.type(dropdown.props), node => node.type === "dropdown");
        assert.equal(atom.props["aria-describedby"], label.props.description_id);
        assert.ok(["Device", "Type"].includes(atom.props.secondary_label));
    }
});

for (const name of ["WordFilter", "MessageFormat"]) test(`${name} shares one label and description across its two rows`, async () => {
    const s = await setup();
    const tree = s.runtime.render(s.templates[`${name}Container`], { label: "Setting", desc: "Help" });
    const rows = tree.props.children.map(row => s.runtime.render(row.type, row.props));
    const label = find(rows[0], node => node.type === s.components.LabelComponent);
    const control = find(rows[1], node => node.type === s.components[name]);
    assert.equal(control.props["aria-labelledby"], label.props.label_id);
    assert.equal(control.props["aria-describedby"], label.props.description_id);
});

test("FormRow preserves a field's error relation while adding its description", async () => {
    const runtime = hooks();
    const { FormRow } = await loadModule(new URL(base + "form_row/FormRow.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, ...hintModule(false),
    });
    const child = runtime.api.createElement("textarea", { "aria-describedby": "error", "aria-invalid": true });
    const tree = runtime.render(FormRow, { label: "Instructions", description: "Help", children: child });
    const input = find(tree, node => node.type === "textarea"), description = find(tree, node => node.type === "description");
    assert.equal(input.props["aria-describedby"], `error ${description.props.id}`);
    assert.equal(input.props["aria-invalid"], true);
    assert.equal(find(tree, node => node.type === "label").props.htmlFor, input.props.id);
});

// #614: on a page that keeps descriptions out of sight, a row's description is its label's hint.
test("with hints on, a label's description is its hint, still the control's description, unless kept", async () => {
    const s = await setup(true);
    const tree = s.render("CheckboxContainer", { label: "Setting", desc: "Help" });
    const label = find(tree, node => node.type === s.components.LabelComponent);
    const control = tree.props.children[1];
    const rendered = label.type(label.props);
    const hint = find(rendered, node => node.type === "hint");
    assert.equal(hint.props.text, "Help");
    assert.equal(hint.props.id, control.props["aria-describedby"], "the bubble is what the control's description points at");
    assert.equal(hint.props.row, true);
    assert.ok(!find(rendered, node => node.type === "description"), "no line of text under the label");
    // The label's own element holds the label only: the hint is beside it, not in its name.
    assert.equal(find(rendered, node => node.props?.id === label.props.label_id).props.children, "Setting");
    assert.equal(find(rendered, node => node.props?.["data-hint-host"]).props["data-hint-host"], true);
    const kept = s.render("CheckboxContainer", { label: "UI Language", desc: "UIの言語", keep_desc: true });
    const keptLabel = find(kept, node => node.type === s.components.LabelComponent);
    const keptRendered = keptLabel.type(keptLabel.props);
    assert.ok(find(keptRendered, node => node.type === "description"));
    assert.ok(!find(keptRendered, node => node.type === "hint"));
    // A row is the host of keyboard focus for its label's hint.
    assert.equal(s.runtime.render(tree.type, tree.props).props["data-hint-row"], true);
});

test("with hints on, an option's description is its hint and its radio's description; a warning stays in sight", async () => {
    const s = await setup(true);
    const tree = s.render("RadioButtonContainer", { label: "Mode", name: "mode", checked_variable: { state: "ok", data: "a" }, options: [
        { id: "a", label: "Auto", desc: "Adjusts by itself." },
        { id: "b", label: "VAD", desc: "Needs a model.", disabled: true },
        { id: "c", label: "Large", desc: "Needs 8 GB.", desc_tone: "warning" },
        { id: "d", label: "Licensed", desc: "Non-commercial license.", keep_desc: true },
    ] });
    const control = tree.props.children[1];
    const group = control.type(control.props);
    const options = all(group, node => node.type === "label");
    const hintOf = option => find(option, node => node.type === "hint");
    const radioOf = option => find(option, node => node.type === "input");
    for (const option of options.slice(0, 2)) {
        assert.equal(hintOf(option).props.id, radioOf(option).props["aria-describedby"]);
        assert.equal(option.props["data-hint-host"], true);
        assert.ok(!hintOf(option).props.row, "focus on one option opens only its own bubble");
    }
    // A disabled radio takes no focus: the mark of an option that cannot be chosen takes it, so
    // why it cannot is still read; the others need no extra stop.
    assert.deepEqual(options.slice(0, 2).map(option => hintOf(option).props.focusable), [false, true]);
    assert.deepEqual(options.slice(2).map(option => [Boolean(hintOf(option)), radioOf(option).props["aria-describedby"]]), [[false, undefined], [false, undefined]]);
    assert.equal(all(group, node => node.type === "p" && /Needs 8 GB|Non-commercial/.test(node.props.children)).length, 2);
});

test("with hints on, a FormRow's description is its label's hint unless the row keeps it (a value in use)", async () => {
    const runtime = hooks();
    const { FormRow } = await loadModule(new URL(base + "form_row/FormRow.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, ...hintModule(true),
    });
    const child = runtime.api.createElement("input", {});
    const tree = runtime.render(FormRow, { label: "Mute", description: "Mutes the speech.", children: child });
    const input = find(tree, node => node.type === "input"), hint = find(tree, node => node.type === "hint");
    assert.equal(input.props["aria-describedby"], hint.props.id);
    assert.ok(!find(tree, node => node.type === "description"));
    assert.equal(tree.props["data-hint-row"], true);
    const kept = runtime.render(FormRow, { label: "Audio route", description: "In use: cable", keepDescription: true, group: true, children: "button" });
    assert.ok(find(kept, node => node.type === "description"));
    assert.ok(!find(kept, node => node.type === "hint"));
});

test("with hints on, a setup fold's description is its title's hint and its summary's description", async () => {
    const runtime = hooks();
    const load = on => loadModule(new URL(base + "setup_section/SetupSection.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, ...hintModule(on),
    });
    const { SetupSection } = await load(true);
    const tree = runtime.render(SetupSection, { title: "Models and servers", status: "Model set", desc: "Choose a model.", children: "fields" });
    const summary = find(tree, node => node.type === "summary"), hint = find(tree, node => node.type === "hint");
    assert.equal(hint.props.text, "Choose a model.");
    assert.equal(summary.props["aria-describedby"], hint.props.id, "the summary takes the focus, so it carries the words");
    // The pointer on the title opens it; the summary opens it when it has the keyboard focus.
    assert.equal(hint.props.row, true);
    assert.equal(summary.props["data-hint-row"], true);
    // The title's element holds the title only, as a label's does: the mark is beside it.
    const host = find(summary, node => node.props?.["data-hint-host"]);
    assert.deepEqual([host.props.children[0].props.className, host.props.children[0].props.children], ["title", "Models and servers"]);
    assert.ok(!find(tree, node => node.type === "description"), "no paragraph opens the fold");
    // On a page not yet reviewed the description is the fold's first paragraph, as before.
    const { SetupSection: Plain } = await load(false);
    const plain = runtime.render(Plain, { title: "Models and servers", desc: "Choose a model.", children: "fields" });
    const body = find(plain, node => node.props?.className === "body");
    assert.equal(body.props.children[0].type, "description");
    assert.equal(find(plain, node => node.type === "summary").props["aria-describedby"], undefined);
    assert.ok(!find(plain, node => node.type === "hint"));
});

test("a checkbox beside its name carries its description as the hint after the name, or under it", async () => {
    const runtime = hooks();
    const load = on => loadModule(new URL(base + "hint/HintCheck.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, "./Hint": { Hint: "hint", useHintDescriptions: () => on },
    });
    const { HintCheck } = await load(true);
    const [label, below] = runtime.render(HintCheck, { label: "Low latency", description: "Uses more power.", checked: true, onChange: () => {} }).props.children;
    const box = find(label, node => node.type === "input"), hint = find(label, node => node.type === "hint");
    // The name's element holds the name only: the mark is beside it.
    assert.ok(find(label, node => node.type === "span" && node.props.children === "Low latency"));
    assert.equal(box.props.type, "checkbox");
    assert.equal(box.props.checked, true);
    assert.equal(box.props["aria-describedby"], hint.props.id);
    // The name's host: the pointer on it, or focus on the box, opens the bubble.
    assert.equal(label.props["data-hint-host"], true);
    assert.ok(!hint.props.focusable, "the box takes the focus");
    assert.equal(below, false);
    const { HintCheck: Plain } = await load(false);
    const [plainLabel, plainBelow] = runtime.render(Plain, { label: "Low latency", description: "Uses more power." }).props.children;
    assert.ok(!find(plainLabel, node => node.type === "hint"));
    assert.equal(plainBelow.type, "description");
    assert.equal(find(plainLabel, node => node.type === "input").props["aria-describedby"], plainBelow.props.id);
});
