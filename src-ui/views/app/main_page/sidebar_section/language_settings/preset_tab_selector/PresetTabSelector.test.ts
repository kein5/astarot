import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, kitStandIns, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// The three presets beside the 「言語設定」 heading (PresetTabSelector.tsx): the kit's ToggleGroup.
async function presets() {
    const runtime = hooks(), asked: string[] = [];
    const state = { selected: "2", busy: false, can: true };
    const { PresetTabSelector } = await loadModule<typeof import("./PresetTabSelector.tsx")>(new URL("./PresetTabSelector.tsx", import.meta.url), runtime, {
        "@logics_main": { useLanguageSettings: () => ({ canChangeLanguageSettings: () => state.can, isLanguageSettingsBusy: state.busy,
            currentSelectedPresetTabNumber: { data: state.selected }, setSelectedPresetTabNumber: (preset: string) => asked.push(preset) }) },
    });
    const draw = () => runtime.render(PresetTabSelector);
    const items = () => nodesIn(draw()).filter(node => node.type === kitStandIns.ToggleGroupItem);
    return { asked, state, draw, items };
}

const press = (item: TreeNode, key: string, repeat = false) => {
    let prevented = false;
    item.props.onKeyDown({ key, repeat, preventDefault() { prevented = true; } });
    return prevented;
};

test("the presets are the kit's ToggleGroup: three radios named by their numbers, the one in use on, each a stop of the Tab key", async () => {
    const { draw, items } = await presets();
    const group = draw();
    assert.equal(group.type, kitStandIns.ToggleGroup);
    assert.deepEqual([group.props.type, group.props.rovingFocus, group.props.value, group.props.className], ["single", false, "2", "container"]);
    assert.deepEqual(items().map(item => [item.props.value, item.props.children, item.props.className, item.props["data-skeleton"], item.props["aria-disabled"]]),
        [["1", "1", "tab", "", false], ["2", "2", "tab", "", false], ["3", "3", "tab", "", false]]);
});

test("choosing another preset asks for it; the one in use, an empty value or a busy moment asks nothing", async () => {
    const { asked, state, draw, items } = await presets();
    draw().props.onValueChange("3");
    assert.deepEqual(asked, ["3"]);
    // Pressing the preset in use with the pointer: Radix offers an empty value.
    draw().props.onValueChange("");
    draw().props.onValueChange("2");
    assert.deepEqual(asked, ["3"]);
    // While the language settings are busy, the presets stay focusable but dimmed, and wait.
    state.busy = true;
    state.can = false;
    assert.ok(items().every(item => item.props["aria-disabled"] === true));
    draw().props.onValueChange("1");
    press(items()[0], "Enter");
    assert.deepEqual(asked, ["3"]);
});

test("Enter and Space ask for the preset on the key going down, once while it is held, the one in use too", async () => {
    const { asked, items } = await presets();
    assert.equal(press(items()[0], "Enter"), true, "the key's own press of the button is held back");
    press(items()[0], "Enter", true);
    press(items()[2], " ");
    press(items()[2], " ", true);
    assert.equal(press(items()[2], "Tab"), false);
    press(items()[1], "Enter");
    assert.deepEqual(asked, ["1", "3", "2"]);
});
