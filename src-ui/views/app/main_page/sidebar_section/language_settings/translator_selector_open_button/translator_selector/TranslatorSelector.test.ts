import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, componentName, drawWith, eventTarget, setRef, stubGlobals, unchecked } from "../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../logics/test/hookHarness.ts";
import * as translatorLabel from "../../../../../../../logics/main/translatorLabel.ts";
import * as translatorPlacement from "./translatorPlacement.ts";
import { isAnchorInScrollport, placeTranslatorPopover } from "./translatorPlacement.ts";

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
        "../../../../../../../logics/main/translatorLabel.ts": translatorLabel,
        "./translatorPlacement.ts": translatorPlacement,
        "react-dom": { createPortal: (node: unknown) => node },
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

test("placeTranslatorPopover opens beside the rail and stays inside the workspace below the title bar", () => {
    const beside = placeTranslatorPopover({
        anchor: { left: 12, top: 629, width: 216, height: 32 },
        railRight: 240,
        panel: { width: 340, height: 300 },
        viewport: { width: 1280, height: 720 },
        gap: 8,
        margin: 8,
        topEdge: 34,
    });
    assert.deepEqual(beside, { left: 248, top: 361, maxHeight: 670 });

    const shortWindow = placeTranslatorPopover({
        anchor: { left: 12, top: 200, width: 216, height: 32 },
        railRight: 240,
        panel: { width: 340, height: 400 },
        viewport: { width: 1280, height: 300 },
        gap: 8,
        margin: 8,
        topEdge: 34,
    });
    assert.deepEqual(shortWindow, { left: 248, top: 42, maxHeight: 250 });

    const narrow = placeTranslatorPopover({
        anchor: { left: 12, top: 480, width: 216, height: 32 },
        railRight: 240,
        panel: { width: 340, height: 260 },
        viewport: { width: 420, height: 600 },
        gap: 8,
        margin: 8,
        topEdge: 34,
    });
    assert.equal(narrow.left, 12);
    assert.equal(narrow.top, 212);
    assert.ok(narrow.left + 340 <= 420 - 8);
});

test("isAnchorInScrollport reports whether the trigger button is visible inside the rail", () => {
    const scrollport = { left: 0, top: 50, width: 240, height: 500 };
    assert.equal(isAnchorInScrollport({ left: 12, top: 500, width: 216, height: 32 }, scrollport), true);
    assert.equal(isAnchorInScrollport({ left: 12, top: 10, width: 216, height: 32 }, scrollport), false);
    assert.equal(isAnchorInScrollport({ left: 12, top: 560, width: 216, height: 32 }, scrollport), false);
});

test("the popover closes on Escape, outside press, or focus leaving it, and returns focus to its trigger", async (context: TestContext) => {
    const doc = eventTarget();
    stubGlobals(context, { document: doc });
    const closed: unknown[] = [], focused: unknown[] = [];
    const { runtime, TranslatorSelector } = await setup([], closed);
    const insidePanel = { nodeType: 1 };
    const insideTrigger = { nodeType: 1 };
    const outsideNode = { nodeType: 1 };
    const anchor = {
        contains: (target: unknown) => target === insideTrigger,
        focus: (options?: unknown) => focused.push(options),
    };
    const panelFocus: unknown[] = [];
    const tree = runtime.render(TranslatorSelector, {
        anchorRef: { current: unchecked<HTMLElement>(anchor) },
        selected_id: "CTranslate2",
        translation_engines: engines,
        is_selected_same_language: false,
    });
    setRef(tree, {
        contains: (target: unknown) => target === insidePanel,
        focus: (options?: unknown) => panelFocus.push(options),
    });

    doc.dispatch("pointerdown", { target: insidePanel });
    doc.dispatch("pointerdown", { target: insideTrigger });
    assert.deepEqual(closed, [], "pressing the popover or its trigger keeps it open");

    doc.dispatch("pointerdown", { target: outsideNode });
    assert.deepEqual(closed, [false]);

    doc.dispatch("focusin", { target: outsideNode });
    assert.deepEqual(closed, [false, false]);

    let prevented = false;
    doc.dispatch("keydown", { key: "Escape", preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(closed, [false, false, false]);
    assert.deepEqual(focused, [{ preventScroll: true }]);

    runtime.unmount();
    assert.equal(doc.added.length, doc.removed.length);
});
