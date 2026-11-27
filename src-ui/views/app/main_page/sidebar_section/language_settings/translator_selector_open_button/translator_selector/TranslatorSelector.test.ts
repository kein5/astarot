import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, componentName, drawWith, eventTarget, kitStandIns, setRef, stubGlobals, unchecked } from "../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../logics/test/hookHarness.ts";
import * as translatorLabel from "../../../../../../../logics/main/translatorLabel.ts";
import * as translatorPlacement from "./translatorPlacement.ts";
import { isAnchorInScrollport, translatorPanelMaxHeight, translatorPopoverSide } from "./translatorPlacement.ts";

const engines = [
    { id: "CTranslate2", label: "CTranslate2", is_available: true, is_default: true },
    { id: "DeepL_API", label: "DeepL API", is_available: false },
];

// An engine's box, the list's own function component (not exported), as the list put it in its
// tree: found by its name and drawn (drawWith) with the props the list gave it.
const isBox = (item: TreeNode, id: string) => componentName(item) === "TranslatorBox" && item.props.id === id;

async function setup(selected: unknown[] = [], closed: unknown[] = [], busy = { now: false }, opened: unknown[] = []) {
    const runtime = hooks();
    const { TranslatorSelector } = await loadModule<typeof import("./TranslatorSelector.tsx")>(new URL("./TranslatorSelector.tsx", import.meta.url), runtime, {
        "@store": { useStore_IsOpenedTranslatorSelector: () => ({ updateIsOpenedTranslatorSelector: (value: unknown) => closed.push(value) }) },
        "@logics_main": { useLanguageSettings: () => ({ canChangeLanguageSettings: () => !busy.now, isLanguageSettingsBusy: busy.now,
            setSelectedTranslationEngines: (id: unknown) => selected.push(id) }) },
        "../../../../../../../logics/main/translatorLabel.ts": translatorLabel,
        "../../../../../../../logics/common/useOpenSettings.ts": { useOpenSettings: () => (place: unknown) => opened.push(place) },
        "./translatorPlacement.ts": translatorPlacement,
    });
    return { runtime, TranslatorSelector };
}

const draw = (runtime: Awaited<ReturnType<typeof setup>>["runtime"], TranslatorSelector: Awaited<ReturnType<typeof setup>>["TranslatorSelector"],
    props: Partial<Parameters<typeof TranslatorSelector>[0]> = {}) =>
    runtime.render(TranslatorSelector, { selected_id: "CTranslate2", translation_engines: engines, is_selected_same_language: false, ...props });
const groupOf = (tree: TreeNode) => findIn(tree, item => item.type === kitStandIns.ToggleGroup, "the engines' group");

test("the list is the kit's PopoverContent beside the rail, and the engines are the kit's ToggleGroup: radios, each a stop of the Tab key", async () => {
    const { runtime, TranslatorSelector } = await setup();
    const tree = draw(runtime, TranslatorSelector);
    assert.equal(tree.type, kitStandIns.PopoverContent);
    assert.deepEqual([tree.props["data-translator-selector"], tree.props["aria-label"], tree.props.className, tree.props.style],
        ["", "main_page.translator", "container", { width: "min(38rem, calc(100vw - 1.6rem))", maxHeight: undefined }]);
    // Until the button is measured, beside it.
    assert.deepEqual([tree.props.side, tree.props.align, tree.props.sideOffset], ["right", "end", 0]);
    const group = groupOf(tree);
    assert.deepEqual([group.props.type, group.props.rovingFocus, group.props.value, group.props["aria-label"], group.props.className],
        ["single", false, "CTranslate2", "main_page.translator", "engines"]);
    const boxes = ["CTranslate2", "DeepL_API"].map(id => drawWith(runtime, findIn(tree, item => isBox(item, id))));
    assert.ok(boxes.every(box => box.type === kitStandIns.ToggleGroupItem));
    assert.deepEqual(boxes.map(box => [box.props.value, box.props.disabled, box.props.className]), [["CTranslate2", false, "box"], ["DeepL_API", true, "box"]]);
    assert.ok(find(boxes[0], item => item.props?.children === "common.default_label"), "the default engine says so");
    assert.equal(find(boxes[1], item => item.props?.children === "common.default_label"), null);
    // No engine in use yet: none is on.
    assert.equal(groupOf(draw(runtime, TranslatorSelector, { selected_id: undefined })).props.value, "");
});

test("an unavailable translation engine is disabled, so it leaves the tab order, and the keyboard cannot select it either", async () => {
    const selected: unknown[] = [], closed: unknown[] = [];
    const { runtime, TranslatorSelector } = await setup(selected, closed);
    const tree = draw(runtime, TranslatorSelector);
    const box = (id: string) => drawWith(runtime, findIn(tree, item => isBox(item, id)));
    const press = (element: TreeNode, key: string, repeat = false) => {
        let prevented = false;
        element.props.onKeyDown({ key, repeat, preventDefault() { prevented = true; } });
        return prevented;
    };

    const unavailable = box("DeepL_API");
    assert.deepEqual([unavailable.props.disabled, unavailable.props["aria-disabled"]], [true, undefined]);
    for (const key of ["Enter", " "]) press(unavailable, key);
    assert.deepEqual(selected, []);
    assert.deepEqual(closed, []);

    const available = box("CTranslate2");
    assert.deepEqual([available.props.disabled, available.props["aria-disabled"]], [false, false]);
    assert.equal(press(available, "Tab"), false);
    assert.deepEqual(closed, []);
    // Enter on the engine in use closes the list without asking for it again; held, once.
    assert.equal(press(available, "Enter"), true, "the key's own press of the button is held back");
    press(available, "Enter", true);
    assert.deepEqual([selected, closed], [[], [false]]);
});

test("choosing an engine asks for it and closes the list; the one in use closes it; while busy, nothing", async () => {
    const selected: unknown[] = [], closed: unknown[] = [], busy = { now: false };
    const { runtime, TranslatorSelector } = await setup(selected, closed, busy);
    const choose = (value: string) => groupOf(draw(runtime, TranslatorSelector)).props.onValueChange(value);
    choose("DeepL_API");
    assert.deepEqual([selected, closed], [["DeepL_API"], [false]]);
    // Pressing the engine in use: Radix offers an empty value.
    choose("");
    choose("CTranslate2");
    assert.deepEqual([selected, closed], [["DeepL_API"], [false, false, false]]);
    busy.now = true;
    const tree = draw(runtime, TranslatorSelector);
    assert.equal(drawWith(runtime, findIn(tree, item => isBox(item, "CTranslate2"))).props["aria-disabled"], true, "dimmed, still focusable");
    groupOf(tree).props.onValueChange("DeepL_API");
    drawWith(runtime, findIn(tree, item => isBox(item, "CTranslate2"))).props.onKeyDown({ key: "Enter", repeat: false, preventDefault() {} });
    assert.deepEqual([selected, closed], [["DeepL_API"], [false, false, false]], "the choice waits and the list stays open");
    // With no engine in use, an empty value chooses nothing.
    busy.now = false;
    groupOf(draw(runtime, TranslatorSelector, { selected_id: undefined })).props.onValueChange("");
    assert.deepEqual([selected, closed], [["DeepL_API"], [false, false, false]]);
});

// #1266 T-7: the grey says an engine cannot be used; why is read by screen readers, and the way to
// set it up is a button to the translation settings, not a sentence pointing there.
test("an unavailable engine's reason describes the group and the engine for screen readers, and a button opens the translation settings", async () => {
    const opened: unknown[] = [], closed: unknown[] = [];
    const { runtime, TranslatorSelector } = await setup([], closed, { now: false }, opened);
    const render = (translation_engines: typeof engines, is_selected_same_language = false) =>
        draw(runtime, TranslatorSelector, { translation_engines, is_selected_same_language });
    const text = (tree: TreeNode, key: string) => find(tree, item => ["p", "span"].includes(String(item.type)) && item.props.children === key);
    const box = (tree: TreeNode, id: string) => drawWith(runtime, findIn(tree, item => isBox(item, id)));
    const settings = (tree: TreeNode) => find(tree, item => item.type === kitStandIns.Button && item.props["data-translator-settings"] === "");

    const tree = render(engines);
    assert.equal(text(tree, "main_page.translator_selector.unavailable_hint"), null, "no sentence on screen");
    const reason = text(tree, "main_page.translator_selector.unavailable_reason");
    assert.ok(reason);
    assert.deepEqual([reason.type, reason.props.className], ["span", "visually_hidden"]);
    assert.equal(groupOf(tree).props["aria-describedby"], reason.props.id);
    assert.equal(box(tree, "DeepL_API").props["aria-describedby"], reason.props.id);
    assert.equal(box(tree, "CTranslate2").props["aria-describedby"], undefined);
    const button = settings(tree);
    assert.ok(button);
    assert.equal(button.props.children, "main_page.feature_settings.open_page");
    button.props.onClick();
    assert.deepEqual([closed, opened], [[false], [{ page: "translation", target: "select_translation_engine" }]],
        "the list closes and the settings open at the translation page's engine choice");

    const all_available = render(engines.map(engine => ({ ...engine, is_available: true })));
    assert.equal(text(all_available, "main_page.translator_selector.unavailable_reason"), null);
    assert.equal(settings(all_available), null);
    assert.equal(groupOf(all_available).props["aria-describedby"], undefined);

    // Choosing the same language has its own, more exact reason; it replaces the hint.
    const same_language = render(engines, true);
    assert.equal(text(same_language, "main_page.translator_selector.unavailable_reason"), null);
    assert.equal(settings(same_language), null);
    const same_reason = text(same_language, "main_page.translator_selector.is_selected_same_language");
    assert.ok(same_reason);
    assert.equal(groupOf(same_language).props["aria-describedby"], same_reason.props.id);
    assert.equal(box(same_language, "DeepL_API").props["aria-describedby"], same_reason.props.id);
    const all_available_same = render(engines.map(engine => ({ ...engine, is_available: true })), true);
    assert.equal(groupOf(all_available_same).props["aria-describedby"], text(all_available_same, "main_page.translator_selector.is_selected_same_language")?.props.id);
});

test("translatorPopoverSide opens beside the rail, its foot on the button's, or above the button in a narrow window", () => {
    const anchor = { left: 12, top: 629, width: 216, height: 32 };
    // The offset reaches past the rail's edge and the gap.
    assert.deepEqual(translatorPopoverSide({ anchor, railRight: 240, panelWidth: 380, viewportWidth: 1280, gap: 8, margin: 8 }),
        { side: "right", align: "end", sideOffset: 20 });
    // A button wider than the rail's edge: the gap from the button.
    assert.deepEqual(translatorPopoverSide({ anchor, railRight: 200, panelWidth: 380, viewportWidth: 1280, gap: 8, margin: 8 }),
        { side: "right", align: "end", sideOffset: 8 });
    // Just room beside the rail: 248 + 380 = 628 = 636 - 8.
    assert.equal(translatorPopoverSide({ anchor, railRight: 240, panelWidth: 380, viewportWidth: 636, gap: 8, margin: 8 }).side, "right");
    assert.deepEqual(translatorPopoverSide({ anchor, railRight: 240, panelWidth: 380, viewportWidth: 635, gap: 8, margin: 8 }),
        { side: "top", align: "start", sideOffset: 8 });
    // A window narrower than the panel: it shrinks to the window, and still has no room beside.
    assert.equal(translatorPopoverSide({ anchor, railRight: 240, panelWidth: 380, viewportWidth: 300, gap: 8, margin: 8 }).side, "top");
    // The room is measured from the larger of the button's and the rail's edges.
    assert.equal(translatorPopoverSide({ anchor: { ...anchor, width: 300 }, railRight: 240, panelWidth: 380, viewportWidth: 700, gap: 8, margin: 8 }).side, "top");
});

test("translatorPanelMaxHeight is the window below the title bar less the margins, never under 120 px", () => {
    assert.equal(translatorPanelMaxHeight({ viewportHeight: 720, topEdge: 34, margin: 8 }), 670);
    assert.equal(translatorPanelMaxHeight({ viewportHeight: 600.6, topEdge: 34.2, margin: 8 }), 550);
    assert.equal(translatorPanelMaxHeight({ viewportHeight: 300, topEdge: 34, margin: 8 }), 250);
    assert.equal(translatorPanelMaxHeight({ viewportHeight: 170, topEdge: 34, margin: 8 }), 120);
    assert.equal(translatorPanelMaxHeight({ viewportHeight: 154, topEdge: 0, margin: 8 }), 138);
});

test("isAnchorInScrollport reports whether the trigger button is visible inside the rail", () => {
    const scrollport = { left: 0, top: 50, width: 240, height: 500 };
    assert.equal(isAnchorInScrollport({ left: 12, top: 500, width: 216, height: 32 }, scrollport), true);
    assert.equal(isAnchorInScrollport({ left: 12, top: 10, width: 216, height: 32 }, scrollport), false);
    assert.equal(isAnchorInScrollport({ left: 12, top: 18, width: 216, height: 32 }, scrollport), false);
    assert.equal(isAnchorInScrollport({ left: 12, top: 19, width: 216, height: 32 }, scrollport), true);
    assert.equal(isAnchorInScrollport({ left: 12, top: 549, width: 216, height: 32 }, scrollport), true);
    assert.equal(isAnchorInScrollport({ left: 12, top: 550, width: 216, height: 32 }, scrollport), false);
});

test("opening moves the focus to the panel without scrolling; Escape and a choice give it back to the button, a press outside does not", async () => {
    const closed: unknown[] = [], focused: unknown[] = [];
    const { runtime, TranslatorSelector } = await setup([], closed);
    const anchor = { focus: (options?: unknown) => focused.push(options) };
    const tree = draw(runtime, TranslatorSelector, { anchorRef: { current: unchecked<HTMLElement>(anchor) } });
    const panelFocus: unknown[] = [];
    setRef(tree, { focus: (options?: unknown) => panelFocus.push(options) });
    const event = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };

    const open = event();
    tree.props.onOpenAutoFocus(open);
    assert.deepEqual([open.prevented, panelFocus], [true, [{ preventScroll: true }]], "the panel, not its first engine");

    // Closed by Escape or by a choice: back to the button, without scrolling the rail.
    const close = event();
    tree.props.onCloseAutoFocus(close);
    assert.deepEqual([close.prevented, focused], [true, [{ preventScroll: true }]]);
    // Closed by a press outside or the focus leaving: the focus stays where it went, once.
    tree.props.onInteractOutside();
    tree.props.onCloseAutoFocus(event());
    assert.deepEqual(focused, [{ preventScroll: true }]);
    tree.props.onCloseAutoFocus(event());
    assert.deepEqual(focused, [{ preventScroll: true }, { preventScroll: true }]);

    // Before the panel is drawn, or without a button to go back to, nothing is focused.
    const bare = draw(runtime, TranslatorSelector);
    for (const handler of ["onOpenAutoFocus", "onCloseAutoFocus"]) assert.doesNotThrow(() => bare.props[handler](event()), handler);
    const unset = draw(runtime, TranslatorSelector, { anchorRef: { current: null } });
    assert.doesNotThrow(() => unset.props.onCloseAutoFocus(event()));
    assert.deepEqual(focused, [{ preventScroll: true }, { preventScroll: true }]);
});

test("it opens beside the rail below the title bar, above the button in a narrow window, and closes when the button scrolls out of sight", async (context: TestContext) => {
    const win = Object.assign(eventTarget(), { innerWidth: 1280, innerHeight: 720 });
    stubGlobals(context, { window: win, document: { documentElement: {} }, getComputedStyle: () => ({ fontSize: "10px" }) });
    const closed: unknown[] = [], focused: unknown[] = [];
    const { runtime, TranslatorSelector } = await setup([], closed);
    let anchorTop = 629;
    const boxOf = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
    const scrollport = { getBoundingClientRect: () => boxOf(0, 50, 240, 600) };
    const parts: Record<string, unknown> = {
        "[data-sidebar-rail]": { getBoundingClientRect: () => boxOf(0, 34, 240, 686) },
        "[data-main-page]": { getBoundingClientRect: () => boxOf(0, 34, 1280, 686) },
        "[data-sidebar-scroll]": scrollport,
    };
    const anchor = { getBoundingClientRect: () => boxOf(12, anchorTop, 216, 32), closest: (selector: string) => parts[selector] ?? null,
        focus: (options?: unknown) => focused.push(options) };
    const props = { anchorRef: { current: unchecked<HTMLElement>(anchor) } };
    let tree = draw(runtime, TranslatorSelector, props);
    tree = draw(runtime, TranslatorSelector, props);
    assert.deepEqual([tree.props.side, tree.props.align, tree.props.sideOffset, tree.props.collisionPadding],
        ["right", "end", 20, { top: 42, right: 8, bottom: 8, left: 8 }]);
    // As tall as the window below the title bar (34) less the margins: 720 - 34 - 16.
    assert.equal(tree.props.style.maxHeight, 670);

    // A narrower window: above the button, once the room beside the rail (248 + 380) leaves less
    // than the margin (8) to the window's edge.
    win.innerWidth = 636;
    win.dispatch("resize");
    assert.equal(draw(runtime, TranslatorSelector, props).props.side, "right");
    win.innerWidth = 630;
    win.dispatch("resize");
    tree = draw(runtime, TranslatorSelector, props);
    assert.deepEqual([tree.props.side, tree.props.align, tree.props.sideOffset], ["top", "start", 8]);

    // The panel's own scrolling, or the rail's while the button is in sight, keeps it open.
    const holds = (inside: boolean) => ({ nodeType: 1, contains: (node: unknown) => inside && node === anchor });
    win.dispatch("scroll", { target: holds(false) });
    win.dispatch("scroll", { target: holds(true) });
    win.dispatch("scroll", { target: null });
    assert.deepEqual(closed, []);
    // Out of sight: closed, and the focus is not pulled back to the button.
    anchorTop = 10;
    win.dispatch("scroll", { target: holds(false) });
    assert.deepEqual(closed, []);
    win.dispatch("scroll", { target: holds(true) });
    assert.deepEqual(closed, [false]);
    tree.props.onCloseAutoFocus({ preventDefault() {} });
    assert.deepEqual(focused, []);

    runtime.unmount();
    assert.equal(win.added.length, win.removed.length);
});
