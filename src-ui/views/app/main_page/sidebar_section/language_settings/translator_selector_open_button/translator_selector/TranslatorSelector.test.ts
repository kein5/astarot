import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, componentName, drawWith } from "../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../logics/test/hookHarness.ts";

const engines = [
    { id: "CTranslate2", label: "CTranslate2", is_available: true, is_default: true },
    { id: "DeepL_API", label: "DeepL API", is_available: false },
];

// An engine's box, the list's own function component (not exported), as the list put it in its
// tree: found by its name and drawn (drawWith) with the props the list gave it.
const isBox = (item: TreeNode, id: string) => componentName(item) === "TranslatorBox" && item.props.id === id;

async function setup(selected: unknown[] = [], closed: unknown[] = []) {
    const runtime = hooks();
    const { TranslatorSelector } = await loadModule<typeof import("./TranslatorSelector.tsx")>(new URL("./TranslatorSelector.tsx", import.meta.url), runtime, {
        "@utils": { chunkArray: <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size)) },
        "@store": { useStore_IsOpenedTranslatorSelector: () => ({ updateIsOpenedTranslatorSelector: (value: unknown) => closed.push(value) }) },
        "@logics_main": { useLanguageSettings: () => ({ canChangeLanguageSettings: () => true, isLanguageSettingsBusy: false,
            setSelectedTranslationEngines: (id: unknown) => selected.push(id) }) },
    });
    return { runtime, TranslatorSelector };
}

test("an unavailable translation engine cannot be selected with the keyboard and leaves the tab order", async () => {
    const selected: unknown[] = [], closed: unknown[] = [];
    const { runtime, TranslatorSelector } = await setup(selected, closed);
    const tree = runtime.render(TranslatorSelector, { selected_id: "CTranslate2", translation_engines: engines, is_selected_same_language: false });
    const box = (id: string) => {
        const node = find(tree, item => isBox(item, id));
        assert.ok(node);
        return drawWith(runtime, node);
    };
    const press = (element: TreeNode, key: string) => element.props.onKeyDown({ key, repeat: false, preventDefault() {} });

    const unavailable = box("DeepL_API");
    assert.equal(unavailable.props.tabIndex, -1);
    assert.equal(unavailable.props["aria-disabled"], true);
    for (const key of ["Enter", " "]) press(unavailable, key);
    unavailable.props.onClick();
    assert.deepEqual(selected, []);
    assert.deepEqual(closed, []);

    const available = box("CTranslate2");
    assert.equal(available.props.tabIndex, 0);
    assert.equal(available.props["aria-disabled"], false);
    press(available, "Enter");
    assert.deepEqual(closed, [false]);
});

test("the reason an engine is unavailable is on screen and describes the group and the engine", async () => {
    const { runtime, TranslatorSelector } = await setup();
    const render = (translation_engines: typeof engines, is_selected_same_language = false) =>
        runtime.render(TranslatorSelector, { selected_id: "CTranslate2", translation_engines, is_selected_same_language });
    const group = (tree: TreeNode) => {
        const found = find(tree, item => item.props?.role === "group");
        assert.ok(found);
        return found;
    };
    const text = (tree: TreeNode, key: string) => find(tree, item => item.type === "p" && item.props.children === key);
    const box = (tree: TreeNode, id: string) => {
        const node = find(tree, item => isBox(item, id));
        assert.ok(node);
        return drawWith(runtime, node);
    };

    const tree = render(engines);
    const hint = text(tree, "main_page.translator_selector.unavailable_hint");
    assert.ok(hint);
    assert.equal(group(tree).props["aria-describedby"], hint.props.id);
    assert.equal(box(tree, "DeepL_API").props["aria-describedby"], hint.props.id);
    assert.equal(box(tree, "CTranslate2").props["aria-describedby"], undefined);

    const all_available = render(engines.map(engine => ({ ...engine, is_available: true })));
    assert.equal(text(all_available, "main_page.translator_selector.unavailable_hint"), null);
    assert.equal(group(all_available).props["aria-describedby"], undefined);

    // Choosing the same language has its own, more exact reason; it replaces the hint.
    const same_language = render(engines, true);
    assert.equal(text(same_language, "main_page.translator_selector.unavailable_hint"), null);
    const same_reason = text(same_language, "main_page.translator_selector.is_selected_same_language");
    assert.ok(same_reason);
    assert.equal(group(same_language).props["aria-describedby"], same_reason.props.id);
    assert.equal(box(same_language, "DeepL_API").props["aria-describedby"], same_reason.props.id);
});
