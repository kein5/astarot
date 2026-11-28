import assert from "node:assert/strict";
import { test } from "vitest";
import { find, findIn, hooks, kitStandIns, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as sameLanguage from "../../../../../../logics/main/sameLanguage.ts";
import * as translatorLabel from "../../../../../../logics/main/translatorLabel.ts";

// The translator button (TranslatorSelectorOpenButton.tsx): the kit's Popover, whose trigger is the
// kit's plain Button at the compact size, and whose content is the translator list.
async function translatorButton() {
    const runtime = hooks(), opened: unknown[] = [];
    const state = { opened: false as unknown, engines: { state: "ok", data: [{ id: "DeepL", label: "DeepL", is_available: true }] },
        target: "English" };
    const { TranslatorSelectorOpenButton } = await loadModule<typeof import("./TranslatorSelectorOpenButton.tsx")>(new URL("./TranslatorSelectorOpenButton.tsx", import.meta.url), runtime, {
        "@logics_main": { useLanguageSettings: () => ({
            currentSelectedYourLanguages: { data: { "1": { "1": { language: "Japanese", country: "Japan" } } } },
            currentSelectedTargetLanguages: { data: { "1": { "1": { language: state.target, country: "Japan", enable: true } } } },
            currentSelectedPresetTabNumber: { data: "1" },
            currentTranslationEngines: state.engines,
            currentSelectedTranslationEngines: { data: { "1": "DeepL" } },
        }) },
        "@store": { useStore_IsOpenedTranslatorSelector: () => ({ currentIsOpenedTranslatorSelector: { data: state.opened },
            updateIsOpenedTranslatorSelector: (value: unknown) => { opened.push(value); state.opened = value; } }) },
        "./translator_selector/TranslatorSelector": { TranslatorSelector: "translator-list" },
        "../../../../../../logics/main/sameLanguage.ts": sameLanguage,
        "../../../../../../logics/main/translatorLabel.ts": translatorLabel,
    });
    const draw = () => runtime.render(TranslatorSelectorOpenButton);
    const popover = () => findIn(draw(), node => node.type === kitStandIns.Popover, "the popover");
    const button = () => findIn(draw(), node => node.type === kitStandIns.Button, "the button");
    return { opened, state, draw, popover, button };
}

test("the engine is the kit's plain button at the compact size, the trigger of the kit's popover, named by its role and engine", async () => {
    const { draw, popover, button } = await translatorButton();
    const trigger = findIn(draw(), node => node.type === kitStandIns.PopoverTrigger);
    assert.equal(trigger.props.asChild, true);
    assert.ok(find(trigger, node => node.type === kitStandIns.Button), "the trigger is the button");
    assert.deepEqual([button().props.tone, button().props.size, button().props["data-skeleton"], button().props["aria-label"]],
        [undefined, "compact", "", "main_page.translator: DeepL"]);
    assert.ok(find(button(), node => node.type === "span" && node.props.children === "DeepL"), "its words");
    assert.equal(popover().props.open, false);
    assert.equal(find(draw(), node => node.type === "translator-list"), null, "the list is drawn only while open");
});

test("the popover opens and closes with the store, and the list is its content while open", async () => {
    const { opened, state, popover } = await translatorButton();
    popover().props.onOpenChange(true);
    assert.deepEqual(opened, [true]);
    assert.equal(popover().props.open, true);
    const list: TreeNode | null = find(popover(), node => node.type === "translator-list");
    assert.ok(list);
    assert.deepEqual([list.props.selected_id, list.props.is_selected_same_language, list.props.translation_engines], ["DeepL", false, state.engines.data]);
    assert.ok(list.props.anchorRef && "current" in list.props.anchorRef, "it is placed from the button");
    popover().props.onOpenChange(false);
    assert.deepEqual(opened, [true, false]);
    // Opened from elsewhere (useOpenTranslatorList): open here too.
    state.opened = true;
    assert.equal(popover().props.open, true);
});

test("Enter and Space open or close the list on the key going down, once while held", async () => {
    const { opened, button } = await translatorButton();
    const press = (key: string, repeat = false) => {
        let prevented = false;
        button().props.onKeyDown({ key, repeat, preventDefault() { prevented = true; } });
        return prevented;
    };
    assert.equal(press("Enter"), true, "the key's own press of the button is held back");
    press("Enter", true);
    assert.deepEqual(opened, [true]);
    press(" ");
    press(" ", true);
    assert.equal(press("Tab"), false);
    assert.deepEqual(opened, [true, false]);
});

test("while the engines load, the button says so; the same language for both is marked, and the arrow turns while open", async () => {
    const { state, button } = await translatorButton();
    state.engines = { state: "pending", data: [] };
    assert.equal(button().props["aria-label"], "main_page.translator: common.loading");
    // Its name is the engine's words on one line; with no engine to name, its role alone.
    state.engines = { state: "ok", data: [{ id: "DeepL", label: "DeepL\n  API  Pro", is_available: true }] };
    assert.equal(button().props["aria-label"], "main_page.translator: DeepL API Pro");
    state.engines = { state: "ok", data: [] };
    assert.equal(button().props["aria-label"], "main_page.translator");
    state.engines = { state: "ok", data: [{ id: "DeepL", label: "DeepL", is_available: true }] };
    const arrow = () => findIn(button(), node => typeof node.type === "function" && String(node.props.className).includes("arrow_svg"));
    assert.equal(arrow().props.className, "arrow_svg");
    state.opened = true;
    assert.equal(arrow().props.className, "arrow_svg is_opened");
    const marks = () => [button().props.children].flat(Infinity).filter(child => child && typeof child === "object" && String((child as TreeNode).props.className).includes("warning_svg"));
    assert.equal(marks().length, 0);
    state.target = "Japanese";
    assert.equal(marks().length, 1, "the same language for both is marked");
});
