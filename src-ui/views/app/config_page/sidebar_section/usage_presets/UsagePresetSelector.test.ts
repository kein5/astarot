import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn } from "../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../logics/test/hookHarness.ts";
import * as usagePresets from "../../../../../logics/configs/usagePresets.ts";

type Predicate = (node: TreeNode) => boolean;
const all = (tree: unknown, predicate: Predicate) => nodesIn(tree).filter(predicate);
const box = (boxes: TreeNode[], name: string) => {
    const found = boxes.find(node => node.props["data-usage-preset"] === name);
    assert.ok(found);
    return found;
};

const Tooltip = ({ children }: { title?: unknown; placement?: string; bare?: boolean; children?: unknown }) => children;

const setup = async (data: unknown, state = "ok") => {
    const runtime = hooks(), writes: unknown[] = [];
    const current = { data, state };
    const module = await loadModule<typeof import("./UsagePresetSelector.tsx")>(new URL("./UsagePresetSelector.tsx", import.meta.url), runtime, {
        "@logics_configs": { useUsagePresets: () => ({ currentUsagePresets: current, setUsagePresets: (value: unknown) => { writes.push(value); } }) },
        "../../../../../logics/configs/usagePresets.ts": usagePresets,
        "../../../../common_components/tooltip/Tooltip.tsx": { Tooltip },
        "@useI18n": { useI18n: () => ({ t: (key: string, values?: object) => values ? `${key}:${JSON.stringify(values)}` : key }) },
    });
    const render = (props: { isCompact: boolean } = { isCompact: false }) => runtime.render(module.UsagePresetSelector, props);
    return { runtime, render, writes, current };
};

test("the button names the uses picked and opens the list of uses under it", async () => {
    const s = await setup(["basic", "voice_changer"]);
    let tree = s.render();
    const button = findIn(tree, node => node.type === "button");
    assert.equal(button.props["aria-expanded"], false);
    assert.match(button.props["aria-label"], /button_label/);
    assert.match(button.props["aria-label"], /basic\.label.*voice_changer\.label/);
    assert.equal(find(tree, node => node.type === "fieldset"), null, "closed until pressed");
    button.props.onClick();
    tree = s.render();
    assert.equal(findIn(tree, node => node.type === "button").props["aria-expanded"], true);
    const boxes = all(tree, node => node.type === "input");
    assert.deepEqual(boxes.map(box => [box.props["data-usage-preset"], box.props.checked]),
        [["basic", true], ["nonverbal", false], ["multilingual", false], ["voice_changer", true], ["all", false]]);
    // Picking one adds it; the value keeps the table's order.
    boxes[1].props.onChange();
    assert.deepEqual(s.writes, [["basic", "nonverbal", "voice_changer"]]);
    boxes[0].props.onChange();
    assert.deepEqual(s.writes.at(-1), ["voice_changer"]);
});

test("the last use picked cannot be unpicked, and nothing is offered before the uses are known", async () => {
    const s = await setup(["basic"]);
    findIn(s.render(), node => node.type === "button").props.onClick();
    const boxes = all(s.render(), node => node.type === "input");
    assert.equal(box(boxes, "basic").props.disabled, true);
    assert.equal(box(boxes, "all").props.disabled, false);

    const unknown = await setup(null);
    const button = findIn(unknown.render(), node => node.type === "button");
    assert.equal(button.props.disabled, true);
    assert.match(button.props["aria-label"], /common\.loading/);
});

test("while a pick is saved the boxes wait, and the icon rail closes the list", async () => {
    const s = await setup(["basic", "voice_changer"], "pending");
    findIn(s.render(), node => node.type === "button").props.onClick();
    assert.ok(all(s.render(), node => node.type === "input").every(box => box.props.disabled));
    const compact = s.render({ isCompact: true });
    assert.equal(find(compact, node => node.type === "fieldset"), null);
    assert.equal(findIn(compact, node => node.type === "button").props.title, findIn(compact, node => node.type === "button").props["aria-label"]);
});

test("show-all and specific use cases are mutually exclusive in checks, writes, and header summary (#1107)", async () => {
    // Starting in show-all mode: only "all" is checked and the summary names only "all".
    const allMode = await setup(["all"]);
    const allButton = findIn(allMode.render(), node => node.type === "button");
    assert.match(allButton.props["aria-label"], /all\.label/);
    assert.doesNotMatch(allButton.props["aria-label"], /basic\.label/);
    allButton.props.onClick();
    const allBoxes = all(allMode.render(), node => node.type === "input");
    assert.deepEqual(allBoxes.map(item => [item.props["data-usage-preset"], item.props.checked]),
        [["basic", false], ["nonverbal", false], ["multilingual", false], ["voice_changer", false], ["all", true]]);
    assert.equal(box(allBoxes, "all").props.disabled, true);
    // Picking a specific use leaves show-all mode instead of checking both.
    box(allBoxes, "basic").props.onChange();
    assert.deepEqual(allMode.writes, [["basic"]]);

    // Picking show-all from specific uses clears every specific use.
    const specificMode = await setup(["basic", "voice_changer"]);
    findIn(specificMode.render(), node => node.type === "button").props.onClick();
    box(all(specificMode.render(), node => node.type === "input"), "all").props.onChange();
    assert.deepEqual(specificMode.writes, [["all"]]);

    // A previously saved mixed value shows only show-all checked and in the header summary.
    const mixed = await setup(["basic", "all"]);
    const mixedButton = findIn(mixed.render(), node => node.type === "button");
    assert.match(mixedButton.props["aria-label"], /all\.label/);
    assert.doesNotMatch(mixedButton.props["aria-label"], /basic\.label/);
    mixedButton.props.onClick();
    const mixedBoxes = all(mixed.render(), node => node.type === "input");
    assert.deepEqual(mixedBoxes.map(item => [item.props["data-usage-preset"], item.props.checked]),
        [["basic", false], ["nonverbal", false], ["multilingual", false], ["voice_changer", false], ["all", true]]);
    box(mixedBoxes, "basic").props.onChange();
    assert.deepEqual(mixed.writes, [["basic"]]);
});

test("explanations move to right-side tooltips and remain accessible descriptions without always-visible copy (#1106)", async () => {
    const s = await setup(["basic"]);
    findIn(s.render(), node => node.type === "button").props.onClick();
    const tree = s.render();
    // No always-visible introductory paragraph inside the list.
    assert.equal(find(tree, node => node.type === "p"), null);
    // Toggle button and every preset option carry their explanation in a right-side bare Tooltip.
    const tooltips = all(tree, node => node.type === Tooltip);
    assert.deepEqual(
        tooltips.map(node => [node.props.bare, node.props.placement, node.props.title]),
        [
            [true, "right", "config_page.usage_presets.help"],
            ...usagePresets.USAGE_PRESETS.map(({ id }) => [true, "right", usagePresets.usagePresetDescKey(id)]),
        ],
    );
    // Screen readers still receive the help text and each preset description via aria-describedby.
    const button = findIn(tree, node => node.type === "button");
    const fieldset = findIn(tree, node => node.type === "fieldset");
    assert.equal(button.props["aria-describedby"], fieldset.props["aria-describedby"]);
    const helpNode = findIn(tree, node => node.props.id === button.props["aria-describedby"]);
    assert.equal(helpNode.props.className, "visuallyHidden");
    assert.equal(helpNode.props.children, "config_page.usage_presets.help");
    for (const { id } of usagePresets.USAGE_PRESETS) {
        const input = box(all(tree, node => node.type === "input"), id);
        const descNode = findIn(tree, node => node.props.id === input.props["aria-describedby"]);
        assert.equal(descNode.props.className, "visuallyHidden");
        assert.equal(descNode.props.children, usagePresets.usagePresetDescKey(id));
    }
    // Labels contain only the preset name (never the description text).
    for (const label of all(tree, node => node.type === "label")) {
        const texts = all(label, node => typeof node.props.children === "string").map(node => node.props.children);
        assert.equal(texts.length, 1);
        assert.match(texts[0], /\.label$/);
    }
    // Compact rail suppresses the help Tooltip so the native icon title stays clean.
    const compact = s.render({ isCompact: true });
    assert.equal(findIn(compact, node => node.type === Tooltip).props.title, undefined);
});
