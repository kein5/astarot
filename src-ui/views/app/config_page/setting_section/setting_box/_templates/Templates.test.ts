import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, componentName, componentNamed, draw, drawWith } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

const base = "../_components/";
const all = (tree: unknown, predicate: (node: TreeNode) => unknown) => nodesIn(tree).filter(predicate);
// The hint module (#614): `on` is whether the page keeps descriptions out of sight.
const hintModule = (on: boolean) => ({ "../hint/Hint": { Hint: "hint", useHintDescriptions: () => on } });

async function setup(hints = false) {
    const runtime = hooks();
    const { LabelComponent } = await loadModule<typeof import("../_components/label_component/LabelComponent.tsx")>(new URL(base + "label_component/LabelComponent.tsx", import.meta.url), hooks(), {
        "../_atoms/_open_webpage_button/_OpenWebpageButton": { _OpenWebpageButton: "webpage" },
        "../description/Description": { Description: "description" }, "../lead/Lead": { Lead: "lead" }, ...hintModule(hints),
    });
    const { RadioButton } = await loadModule<typeof import("../_components/radio_button/RadioButton.tsx")>(new URL(base + "radio_button/RadioButton.tsx", import.meta.url), hooks(), hintModule(hints));
    const { DownloadModels } = await loadModule<typeof import("../_components/download_models/DownloadModels.tsx")>(new URL(base + "download_models/DownloadModels.tsx", import.meta.url), hooks(), {
        "../index": { RadioButton }, "../_atoms/_download_button/_DownloadButton": { _DownloadButton: "download" },
    });
    const { DropdownMenu, MultiDropdownMenu } = await loadModule<typeof import("../_components/dropdown_menu/DropdownMenu.tsx")>(new URL(base + "dropdown_menu/DropdownMenu.tsx", import.meta.url), hooks(), {
        "../_atoms/_dropdown_menu/_DropdownMenu": { _DropdownMenu: "dropdown" },
    });
    const components = { LabelComponent, RadioButton, DownloadModels, DropdownMenu, MultiDropdownMenu,
        EntryWithSaveButton: "save-entry", AuthKey: "auth", ColorEntryWithSaveButton: "color",
        Slider: "slider", WordFilter: "word-filter",
        HotkeysEntry: "hotkey", ActionButton: "action", MessageFormat: "message", ConnectionCheckButton: "check" };
    const templates = await loadModule(new URL("./Templates.tsx", import.meta.url), runtime, {
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        "../_components": components, "@common_components": { Checkbox: "checkbox" },
    });
    // A template of Templates.tsx, named as the tests loop over them, with the props each test
    // builds: only the ones that template reads here.
    const template = (name: string) => componentNamed(templates, name);
    const render = (name: string, props: unknown) => {
        let tree = runtime.render(template(name), props);
        if (componentName(tree) === "CommonContainer") tree = drawWith(runtime, tree);
        return tree;
    };
    return { runtime, template, components, render };
}

for (const name of ["Checkbox", "EntryWithSaveButton", "AuthKey", "ColorEntryWithSaveButton", "Slider", "DropdownMenu", "RadioButton", "DownloadModels", "ActionButton", "HotkeysEntry", "ConnectionCheckButton"]) {
    test(`${name} template connects description and warning IDs without changing its label`, async () => {
        const s = await setup();
        const props = { label: "Setting", desc: "Help", add_warnings: [{ label: "Unavailable" }], "aria-describedby": "existing-help" };
        const tree = s.render(`${name}Container`, props);
        const label = findIn(tree, node => node.type === s.components.LabelComponent);
        const control = tree.props.children[1];
        const renderedLabel = draw(label);
        const help = findIn(renderedLabel, node => node.type === "description");
        const warning = findIn(renderedLabel, node => node.props?.className === "warnings_section");
        assert.equal(control.props["aria-describedby"], `existing-help ${help.props.id} ${warning.props.id}`);
        assert.equal(control.props["aria-labelledby"], findIn(renderedLabel, node => node.props?.children === "Setting").props.id);
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
    let group = draw(control);
    if (name === "DownloadModels") { const radio = findIn(group, node => node.type === s.components.RadioButton); group = draw(radio); }
    assert.equal(group.props.role, "radiogroup");
    assert.equal(group.props["aria-labelledby"], label.props.label_id);
    assert.equal(group.props["aria-describedby"], label.props.description_id);
    assert.ok(find(group, node => node.type === "label"));
    assert.equal(findIn(group, node => node.type === "input").props.name, "engine");
});

test("a radio choice that waits on the engine keeps its radios focusable but ignores presses until it settles", async () => {
    const s = await setup();
    const chosen: string[] = [];
    const tree = s.render("RadioButtonContainer", { label: "Recognition engine", name: "engine", selectFunction: (id: string) => chosen.push(id),
        checked_variable: { state: "ok", data: "a" }, options: [{ id: "a", label: "Engine A" }, { id: "b", label: "Engine B" },
            { id: "c", label: "Engine C", disabled: true }] });
    const control = tree.props.children[1];
    const inputs = (state: string) => all(draw(control, { ...control.props, checked_variable: { state, data: "a" } }), node => node.type === "input")
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
    const chosen: string[] = [];
    const tree = s.render("RadioButtonContainer", { label: "Recognition engine", desc: "Choose one", name: "engine", groups,
        selectFunction: (id: string) => chosen.push(id), checked_variable: { state: "ok", data: "a" } });
    const label = tree.props.children[0], control = tree.props.children[1];
    const group = draw(control);
    assert.equal(group.props.role, "group");
    assert.equal(group.props["aria-labelledby"], label.props.label_id);
    assert.equal(group.props["aria-describedby"], label.props.description_id);
    const systems = all(group, node => node.props?.role === "radiogroup");
    assert.deepEqual(systems.map(node => findIn(group, other => other.props?.id === node.props["aria-labelledby"]).props.children), ["On your PC", "API"]);
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
    const label = tree.props.children[0], control = tree.props.children[1], group = draw(control);
    assert.equal(group.props.role, "group");
    assert.equal(group.props["aria-labelledby"], label.props.label_id);
    for (const dropdown of all(group, node => node.type === s.components.DropdownMenu)) {
        const atom = findIn(draw(dropdown), node => node.type === "dropdown");
        assert.equal(atom.props["aria-describedby"], label.props.description_id);
        assert.ok(["Device", "Type"].includes(atom.props.secondary_label));
    }
});

for (const name of ["WordFilter", "MessageFormat"] as const) test(`${name} shares one label and description across its two rows`, async () => {
    const s = await setup();
    const tree = s.runtime.render(s.template(`${name}Container`), { label: "Setting", desc: "Help" });
    // Each row is a CommonContainer, a function component of Templates.tsx.
    const rows = tree.props.children.map((row: TreeNode) => drawWith(s.runtime, row));
    const label = findIn(rows[0], node => node.type === s.components.LabelComponent);
    const control = findIn(rows[1], node => node.type === s.components[name]);
    assert.equal(control.props["aria-labelledby"], label.props.label_id);
    assert.equal(control.props["aria-describedby"], label.props.description_id);
});

test("FormRow preserves a field's error relation while adding its description", async () => {
    const runtime = hooks();
    const { FormRow } = await loadModule<typeof import("../_components/form_row/FormRow.tsx")>(new URL(base + "form_row/FormRow.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, ...hintModule(false),
    });
    const child = runtime.api.createElement("textarea", { "aria-describedby": "error", "aria-invalid": true });
    const tree = runtime.render(FormRow, { label: "Instructions", description: "Help", children: child });
    const input = findIn(tree, node => node.type === "textarea"), description = findIn(tree, node => node.type === "description");
    assert.equal(input.props["aria-describedby"], `error ${description.props.id}`);
    assert.equal(input.props["aria-invalid"], true);
    assert.equal(findIn(tree, node => node.type === "label").props.htmlFor, input.props.id);
});

// #614: on a page that keeps descriptions out of sight, a row's description is its label's hint.
test("with hints on, a label's description is its hint, still the control's description, unless kept", async () => {
    const s = await setup(true);
    const tree = s.render("CheckboxContainer", { label: "Setting", desc: "Help" });
    const label = findIn(tree, node => node.type === s.components.LabelComponent);
    const control = tree.props.children[1];
    const rendered = draw(label);
    const hint = findIn(rendered, node => node.type === "hint");
    assert.equal(hint.props.text, "Help");
    assert.equal(hint.props.id, control.props["aria-describedby"], "the bubble is what the control's description points at");
    assert.equal(hint.props.row, true);
    assert.ok(!find(rendered, node => node.type === "description"), "no line of text under the label");
    // The label's own element holds the label only: the hint is beside it, not in its name.
    assert.equal(findIn(rendered, node => node.props?.id === label.props.label_id).props.children, "Setting");
    assert.equal(findIn(rendered, node => node.props?.["data-hint-host"]).props["data-hint-host"], true);
    const kept = s.render("CheckboxContainer", { label: "UI Language", desc: "UIの言語", keep_desc: true });
    const keptLabel = findIn(kept, node => node.type === s.components.LabelComponent);
    const keptRendered = draw(keptLabel);
    assert.ok(find(keptRendered, node => node.type === "description"));
    assert.ok(!find(keptRendered, node => node.type === "hint"));
    // A row is the host of keyboard focus for its label's hint.
    // The row is a CommonContainer, a function component of Templates.tsx.
    assert.equal(drawWith(s.runtime, tree).props["data-hint-row"], true);
});

// #614: what must be known before acting is one sentence that stays on screen (the row's lead);
// the details are the hint after the sentence. The control is described by both, the sentence first.
test("a row's lead stays on screen under the label, its details are the hint after it, and the control is described by both", async () => {
    const s = await setup(true);
    const props = { label: "Send usage data", lead: "Sends that the app started.", desc: "What goes with it.", "aria-describedby": "state" };
    const tree = s.render("CheckboxContainer", props);
    const label = findIn(tree, node => node.type === s.components.LabelComponent);
    const control = tree.props.children[1];
    const rendered = draw(label);
    const lead = findIn(rendered, node => node.type === "lead");
    assert.deepEqual([lead.props.text, lead.props.details, lead.props.row], ["Sends that the app started.", "What goes with it.", true]);
    assert.equal(control.props["aria-describedby"], `state ${lead.props.id} ${lead.props.details_id}`);
    assert.notEqual(lead.props.id, lead.props.details_id);
    // The label carries no mark of its own: the hint follows the sentence, so its bubble opens
    // under the sentence and does not cover it.
    assert.ok(!find(rendered, node => node.type === "hint" || node.type === "description"));
    assert.ok(!find(rendered, node => node.props?.["data-hint-host"]));
    assert.equal(findIn(rendered, node => node.props?.id === label.props.label_id).props.children, "Send usage data");
    // The ids hold through a second render, as the others do.
    assert.equal(s.render("CheckboxContainer", props).props.children[1].props["aria-describedby"], control.props["aria-describedby"]);
    // On a page that shows descriptions, the sentence comes first and the details are the description.
    const shown = await setup(false);
    const plain = draw(findIn(shown.render("CheckboxContainer", props), node => node.type === shown.components.LabelComponent));
    const parts = nodesIn(plain).filter(node => node.type === "lead" || node.type === "description");
    assert.deepEqual(parts.map(node => [node.type, node.props.text, node.props.details]),
        [["lead", "Sends that the app started.", undefined], ["description", "What goes with it.", undefined]]);
    // A row without a lead is described as before.
    const none = s.render("CheckboxContainer", { label: "Setting", desc: "Help" });
    assert.equal(none.props.children[1].props["aria-describedby"], findIn(draw(findIn(none, node => node.type === s.components.LabelComponent)), node => node.type === "hint").props.id);
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
    const group = draw(control);
    const options = all(group, node => node.type === "label");
    const isHint = (node: TreeNode) => node.type === "hint";
    const hintOf = (option: TreeNode) => find(option, isHint);
    const radioOf = (option: TreeNode) => findIn(option, node => node.type === "input");
    for (const option of options.slice(0, 2)) {
        assert.equal(findIn(option, isHint).props.id, radioOf(option).props["aria-describedby"]);
        assert.equal(option.props["data-hint-host"], true);
        assert.ok(!findIn(option, isHint).props.row, "focus on one option opens only its own bubble");
    }
    // A disabled radio takes no focus: the mark of an option that cannot be chosen takes it, so
    // why it cannot is still read; the others need no extra stop.
    assert.deepEqual(options.slice(0, 2).map(option => findIn(option, isHint).props.focusable), [false, true]);
    assert.deepEqual(options.slice(2).map(option => [Boolean(hintOf(option)), radioOf(option).props["aria-describedby"]]), [[false, undefined], [false, undefined]]);
    assert.equal(all(group, node => node.type === "p" && /Needs 8 GB|Non-commercial/.test(node.props.children)).length, 2);
});

test("with hints on, a FormRow's description is its label's hint unless the row keeps it (a value in use)", async () => {
    const runtime = hooks();
    const { FormRow } = await loadModule<typeof import("../_components/form_row/FormRow.tsx")>(new URL(base + "form_row/FormRow.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, ...hintModule(true),
    });
    const child = runtime.api.createElement("input", {});
    const tree = runtime.render(FormRow, { label: "Mute", description: "Mutes the speech.", children: child });
    const input = findIn(tree, node => node.type === "input"), hint = findIn(tree, node => node.type === "hint");
    assert.equal(input.props["aria-describedby"], hint.props.id);
    assert.ok(!find(tree, node => node.type === "description"));
    assert.equal(tree.props["data-hint-row"], true);
    const kept = runtime.render(FormRow, { label: "Audio route", description: "In use: cable", keepDescription: true, group: true, children: "button" });
    assert.ok(find(kept, node => node.type === "description"));
    assert.ok(!find(kept, node => node.type === "hint"));
    // Current state under the label stays visible even while the row's description is its hint (#1096).
    const withStatus = runtime.render(FormRow, { label: "Monitor", status: "Off", description: "Plays on monitor.", group: true, children: "button" });
    assert.ok(find(withStatus, node => node.type === "hint" && node.props.text === "Plays on monitor."));
    assert.ok(find(withStatus, node => node.type === "p" && node.props.children === "Off"));
});

test("with hints on, a setup fold's description is its title's hint and its summary's description", async () => {
    const runtime = hooks();
    const load = (on: boolean) => loadModule<typeof import("../_components/setup_section/SetupSection.tsx")>(new URL(base + "setup_section/SetupSection.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, ...hintModule(on), "../fold/Fold": { Fold: "fold" },
    });
    const { SetupSection } = await load(true);
    // A bar of the app's one fold: what its summary says, and what the summary element carries.
    const tree = runtime.render(SetupSection, { title: "Models and servers", status: "Model set", desc: "Choose a model.", children: "fields" });
    const summary = tree.props.summary, hint = findIn(summary, node => node.type === "hint");
    assert.equal(tree.type, "fold");
    assert.equal(hint.props.text, "Choose a model.");
    assert.equal(tree.props.summaryProps["aria-describedby"], hint.props.id, "the summary takes the focus, so it carries the words");
    // The pointer on the title opens it; the summary opens it when it has the keyboard focus.
    assert.equal(hint.props.row, true);
    assert.equal(tree.props.summaryProps["data-hint-row"], true);
    // The title's element holds the title only, as a label's does: the mark is beside it.
    const host = findIn(summary, node => node.props?.["data-hint-host"]);
    assert.deepEqual([host.props.children[0].props.className, host.props.children[0].props.children], ["title", "Models and servers"]);
    assert.ok(!find(tree, node => node.type === "description"), "no paragraph opens the fold");
    // On a page not yet reviewed the description is the fold's first paragraph, as before.
    const { SetupSection: Plain } = await load(false);
    const plain = runtime.render(Plain, { title: "Models and servers", desc: "Choose a model.", children: "fields" });
    assert.equal(plain.props.children[0].type, "description");
    assert.equal(plain.props.summaryProps["aria-describedby"], undefined);
    assert.ok(!find(plain, node => node.type === "hint"));
});

test("a checkbox beside its name carries its description as the hint after the name, or under it", async () => {
    const runtime = hooks();
    const load = (on: boolean) => loadModule<typeof import("../_components/hint/HintCheck.tsx")>(new URL(base + "hint/HintCheck.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" }, "./Hint": { Hint: "hint", useHintDescriptions: () => on },
    });
    const { HintCheck } = await load(true);
    const [label, below] = runtime.render(HintCheck, { label: "Low latency", description: "Uses more power.", checked: true, onChange: () => {} }).props.children;
    const box = findIn(label, node => node.type === "input"), hint = findIn(label, node => node.type === "hint");
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
    assert.equal(findIn(plainLabel, node => node.type === "input").props["aria-describedby"], plainBelow.props.id);
});
