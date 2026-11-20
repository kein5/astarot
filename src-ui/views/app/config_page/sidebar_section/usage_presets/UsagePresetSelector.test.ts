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

const setup = async (data: unknown, state = "ok") => {
    const runtime = hooks(), writes: unknown[] = [];
    const current = { data, state };
    const module = await loadModule<typeof import("./UsagePresetSelector.tsx")>(new URL("./UsagePresetSelector.tsx", import.meta.url), runtime, {
        "@logics_configs": { useUsagePresets: () => ({ currentUsagePresets: current, setUsagePresets: (value: unknown) => { writes.push(value); } }) },
        "../../../../../logics/configs/usagePresets.ts": usagePresets,
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
    const s = await setup(["basic", "all"], "pending");
    findIn(s.render(), node => node.type === "button").props.onClick();
    assert.ok(all(s.render(), node => node.type === "input").every(box => box.props.disabled));
    const compact = s.render({ isCompact: true });
    assert.equal(find(compact, node => node.type === "fieldset"), null);
    assert.equal(findIn(compact, node => node.type === "button").props.title, findIn(compact, node => node.type === "button").props["aria-label"]);
});
