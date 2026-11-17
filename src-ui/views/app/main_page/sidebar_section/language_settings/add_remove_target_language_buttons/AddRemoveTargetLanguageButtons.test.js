import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";

const slots = (second, third) => ({ 1: { enable: true }, 2: { enable: second }, 3: { enable: third } });

async function render(targets, busy = false) {
    const runtime = hooks(), calls = [];
    const { AddRemoveTargetLanguageButtons } = await loadModule(new URL("./AddRemoveTargetLanguageButtons.jsx", import.meta.url), runtime, {
        "@logics_main": { useLanguageSettings: () => ({
            currentSelectedPresetTabNumber: { data: "1" }, currentSelectedTargetLanguages: { data: { 1: targets } },
            canChangeLanguageSettings: () => !busy, isLanguageSettingsBusy: busy,
            removeTargetLanguage: () => calls.push("remove"), addTargetLanguage: () => calls.push("add"),
        }) },
    });
    const tree = runtime.render(AddRemoveTargetLanguageButtons);
    const button = label => find(tree, node => node.props?.["aria-label"] === label);
    return { calls, remove: button("main_page.remove_target_language"), add: button("main_page.add_target_language") };
}

const press = (element, key) => element.props.onKeyDown({ key, repeat: false, preventDefault() {} });

test("a button that looks unavailable does nothing from the keyboard or the pointer", async () => {
    // One target: nothing to remove. Three targets: nothing more to add.
    for (const [targets, off] of [[slots(false, false), "remove"], [slots(true, true), "add"]]) {
        const s = await render(targets);
        const button = s[off];
        assert.equal(button.props["aria-disabled"], true, off);
        press(button, "Enter");
        press(button, " ");
        button.props.onClick();
        assert.deepEqual(s.calls, [], off);
    }
});

test("an available button works from the keyboard and says it is available", async () => {
    const s = await render(slots(true, false));
    assert.equal(s.remove.props["aria-disabled"], false);
    assert.equal(s.add.props["aria-disabled"], false);
    press(s.remove, "Enter");
    press(s.add, " ");
    assert.deepEqual(s.calls, ["remove", "add"]);
});

test("while the language settings are busy, both buttons say so and do nothing", async () => {
    const s = await render(slots(true, false), true);
    assert.equal(s.remove.props["aria-disabled"], true);
    press(s.remove, "Enter");
    assert.deepEqual(s.calls, []);
});
