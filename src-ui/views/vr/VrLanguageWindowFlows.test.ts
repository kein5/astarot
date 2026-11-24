import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import React from "react";
import { componentName, draw, find, findIn, hooks, loadModule, nodesIn, refOf, setRef, stubGlobals, treeNode } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as languageNames from "../../logics/common/languageNames.ts";
import * as languageJumpGroups from "../../logics/common/languageJumpGroups.ts";
import * as translatorLabel from "../../logics/main/translatorLabel.ts";

// The VR language window, from opening a list to the backend's answer: what each press sends,
// what the window says while it waits, where the focus goes, and how it recovers when the
// settings change elsewhere. The language settings come from a small model of the presets; the
// list of choices (VrPickerList) is a stand-in that keeps its props. Each element with a ref
// gets a stand-in that records the focus it is given, named by what a screen reader says.

type Language = { language: string; country: string };
type Slot = Language & { enable?: boolean };
const entry = (language: string, country: string): Language => ({ language, country });
const JA = entry("Japanese", "Japan"), EN = entry("English", "United States"), KO = entry("Korean", "South Korea");
const FR = entry("French", "France"), DE = entry("German", "Germany");
const WAIT = 1000;
const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
const c = (key: string, variables?: object) => t(`vr_panel.language.${key}`, variables);
const ENGINES = [
    { id: "CTranslate2", label: "CTranslate2", is_available: true, is_default: true },
    { id: "DeepL", label: "DeepL", is_available: true },
    { id: "Gemini_API", label: "Gemini\nAPI", is_available: false },
];

// The presets as the backend holds them.
interface Model {
    preset: string;
    // null: not read yet.
    sources: Record<string, Language | undefined> | null;
    targets: Record<string, Slot[] | undefined> | null;
    engine: Record<string, string> | null;
    engines: typeof ENGINES;
    selectable: Language[] | null;
    inFlight: unknown;
    isResyncing: boolean;
    lastVrResult: unknown;
    states: Partial<Record<"tab" | "your" | "target" | "selectedEngines" | "engines", string>>;
}
const presets = (over: Partial<Model> = {}): Model => ({ preset: "1",
    sources: { 1: JA, 2: EN, 3: JA }, targets: { 1: [EN, KO], 2: [JA], 3: [FR, { ...DE, enable: false }] },
    engine: { 1: "CTranslate2", 2: "DeepL", 3: "CTranslate2" }, engines: ENGINES, selectable: [JA, EN, KO, FR, DE],
    inFlight: null, isResyncing: false, lastVrResult: null, states: {}, ...over });

// A stand-in for an element the window holds a ref to.
interface Fake {
    name: string;
    node?: TreeNode;
    // Disabled itself or by a disabled fieldset around it, as :disabled matches in a browser.
    disabled: boolean;
    scrollTop: number;
    isConnected: boolean;
    focus: (options?: unknown) => void;
    matches: (selector: string) => boolean;
    // Outside any list of choices.
    closest: (selector: string) => unknown;
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
const ofClass = (tree: unknown, name: string) => nodesIn(tree).filter(node => classesOf(node).includes(name));

async function languageWindow(context: TestContext, model: Model = presets(), { locked = false } = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    // As React does, the layout effects of a render run first, then its other effects.
    const passive: (() => void)[] = [], useEffect = runtime.api.useEffect;
    runtime.api.useEffect = (effect: () => unknown, deps?: readonly unknown[]) => useEffect(() => {
        const ran: { cleanup?: unknown } = {};
        passive.push(() => { ran.cleanup = effect(); });
        return () => { if (typeof ran.cleanup === "function") ran.cleanup(); };
    }, deps);
    const document: { activeElement: unknown } = { activeElement: null };
    stubGlobals(context, { document });
    const calls: unknown[][] = [], focused: string[] = [], jumps: unknown[][] = [];
    let nextId = 0, failing = false, configOpen = locked;
    const act = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return failing ? null : `req-${++nextId}`; };
    const actions = { refreshLanguageSettings: (...args: unknown[]) => { calls.push(["refreshLanguageSettings", ...args]); },
        swapSelectedLanguages: act("swapSelectedLanguages"), setSelectedPresetTabNumber: act("setSelectedPresetTabNumber"),
        setSelectedYourLanguages: act("setSelectedYourLanguages"), setTargetLanguagesInOrder: act("setTargetLanguagesInOrder"),
        setSelectedTranslationEngines: act("setSelectedTranslationEngines") };
    const settings = () => {
        const state = (name: keyof Model["states"]) => model.states[name] ?? "ok";
        return {
            currentSelectedPresetTabNumber: { state: state("tab"), data: model.preset },
            currentSelectedYourLanguages: { state: state("your"), data: model.sources && Object.fromEntries(Object.entries(model.sources)
                .map(([preset, source]) => [preset, source ? { 1: source } : {}])) },
            currentSelectedTargetLanguages: { state: state("target"), data: model.targets && Object.fromEntries(Object.entries(model.targets).flatMap(([preset, slots]) => slots
                ? [[preset, Object.fromEntries(slots.map((slot, index) => [String(index + 1), { enable: true, ...slot }]))]] : [])) },
            currentSelectedTranslationEngines: { state: state("selectedEngines"), data: model.engine },
            currentTranslationEngines: { state: state("engines"), data: model.engines },
            currentSelectableLanguageList: { state: "ok", data: model.selectable },
            currentLanguageMutation: { state: "ok", data: { inFlight: model.inFlight, isResyncing: model.isResyncing, lastVrResult: model.lastVrResult } },
            ...actions,
        };
    };
    const { VrLanguageWindow } = await loadModule<typeof import("./VrLanguageWindow.tsx")>(new URL("./VrLanguageWindow.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t, i18n: { language: "en" } }) },
        "@logics_main": { useLanguageSettings: settings },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: configOpen } }) },
        "../../logics/main/languageMutations": { LANGUAGE_RESPONSE_WAIT_MS: WAIT },
        "../../logics/common/languageNames.ts": languageNames,
        "../../logics/common/languageJumpGroups.ts": languageJumpGroups,
        "../../logics/main/translatorLabel.ts": translatorLabel,
        "./VrWindow": { VrWindow: "window" },
        "./VrPickerList": { VrPickerList: "picker-list", VR_PICKER_WINDOW_THRESHOLD: 5 },
    });
    // The stand-ins, kept by name across renders so that the focus history and scroll stay.
    const fakes = new Map<string, Fake>();
    const nameOf = (node: TreeNode) => node.props["aria-label"] ?? (node.type === "fieldset" ? `fieldset ${classesOf(node)[0]}`
        : classesOf(node).includes("picker_scroll") ? "picker_scroll" : textOf(node));
    const fakeFor = (node: TreeNode): Fake => {
        const name = nameOf(node);
        const fake: Fake = fakes.get(name) ?? { name, scrollTop: 0, isConnected: true, disabled: false,
            // A disabled element does not take the focus. The window never scrolls to what it focuses.
            focus: (options?: unknown) => {
                assert.deepEqual(options, { preventScroll: true }, `the focus given to ${name} would scroll the window`);
                if (fake.disabled) return;
                focused.push(name);
                document.activeElement = fake;
            },
            matches: (selector: string) => selector === ":disabled" && fake.disabled, closest: () => null };
        fake.node = node;
        fakes.set(name, fake);
        return fake;
    };
    let attached: TreeNode[] = [], tree: TreeNode | undefined;
    const navigation = { scrollToIndex: (...args: unknown[]) => { jumps.push(args); } };
    const render = () => {
        tree = runtime.render(VrLanguageWindow, { onClose: () => { calls.push(["close"]); } }, drawn => {
            const withRefs: [TreeNode, boolean][] = [];
            const walk = (node: unknown, inDisabled: boolean) => {
                const element = treeNode(node);
                if (!element) return;
                const disabled = inDisabled || element.props.disabled === true;
                if (refOf(element)) withRefs.push([element, disabled]);
                for (const child of React.Children.toArray(element.props.children)) walk(child, inDisabled || (element.type === "fieldset" && disabled));
            };
            walk(drawn, false);
            // As React does: the refs of elements no longer drawn are cleared, then the drawn ones set.
            for (const node of attached) if (!withRefs.some(([other]) => refOf(other) === refOf(node))) setRef(node, null);
            for (const [node, disabled] of withRefs) { const fake = fakeFor(node); fake.disabled = disabled; setRef(node, fake); }
            attached = withRefs.map(([node]) => node);
            const list = find(drawn, node => node.type === "picker-list");
            if (list) list.props.navigationRef.current = navigation;
        });
        for (let run = passive.shift(); run; run = passive.shift()) run();
        return tree;
    };
    // Drawn, then drawn again with what its effects changed.
    const settle = () => { render(); return render(); };
    render();
    const current = () => { assert.ok(tree); return tree; };
    const fake = (name: string) => { const found = fakes.get(name); assert.ok(found, `no element named ${name}`); return found; };
    return { runtime, calls, focused, jumps, fakes, document, model, render, settle, fake,
        get tree() { return current(); },
        setFailing: (value: boolean) => { failing = value; },
        setLocked: (value: boolean) => { configOpen = value; },
        lastId: () => `req-${nextId}`,
        // The backend answers the last request (or the one named).
        answer: (kind: string, requestId = `req-${nextId}`) => { model.lastVrResult = { requestId, kind }; return settle(); },
        // What the screen reader's status line says.
        status: (tree: TreeNode = current()) => textOf(findIn(tree, node => node.props.role === "status" && node.props["aria-atomic"] === "true")),
        // The main screen's parts.
        main: (tree: TreeNode = current()) => findIn(tree, node => node.type === "fieldset" && classesOf(node).includes("main")),
        presetButtons: (tree: TreeNode = current()) => ofClass(tree, "preset"),
        source: (tree: TreeNode = current()) => ofClass(tree, "source")[0],
        swap: (tree: TreeNode = current()) => ofClass(tree, "swap")[0],
        targetButtons: (tree: TreeNode = current()) => ofClass(tree, "target_change"),
        removeButtons: (tree: TreeNode = current()) => ofClass(tree, "remove"),
        add: (tree: TreeNode = current()) => ofClass(tree, "add")[0],
        engineRow: (tree: TreeNode = current()) => findIn(tree, node => node.type === "button" && textOf(node).startsWith("main_page.translator")),
        // The list screen's parts.
        picker: (tree: TreeNode = current()) => find(tree, node => node.type === "fieldset" && classesOf(node).includes("picker")),
        back: (tree: TreeNode = current()) => ofClass(tree, "back")[0],
        list: (tree: TreeNode = current()) => findIn(tree, node => node.type === "picker-list", "the list of choices"),
        // A choice's button, as the list draws it.
        choice: (language: Language, tree: TreeNode = current()) => {
            const list = findIn(tree, node => node.type === "picker-list", "the list of choices");
            return treeNode(list.props.children(language)) ?? assert.fail("no button");
        },
        // The list's heading: the preset, then what the list changes.
        heading: (tree: TreeNode = current()) => textOf(ofClass(tree, "context")[0]),
        feedback: (tree: TreeNode = current()) => ofClass(tree, "feedback").map(textOf),
    };
}
type View = Awaited<ReturnType<typeof languageWindow>>;

// Opens a list from the main screen: your language, a recipient's, or the one that adds.
function openYour(view: View) { view.source().props.onClick(); return view.render(); }
function openTarget(view: View, index: number) { view.targetButtons()[index].props.onClick(); return view.render(); }
function openAdd(view: View) { view.add().props.onClick(); return view.render(); }
function openEngine(view: View) { view.engineRow().props.onClick(); return view.render(); }
function allLanguages(view: View) { ofClass(view.tree, "all_languages")[0].props.onClick(); return view.render(); }

test("until the settings arrive, the window says it is reading them and its main screen is hidden", async context => {
    for (const over of [{ sources: { 1: undefined } }, { targets: { 1: undefined } }, { selectable: null }]) {
        const view = await languageWindow(context, presets(over));
        const waiting = findIn(view.tree, node => classesOf(node).includes("waiting"));
        assert.deepEqual([waiting.props["aria-busy"], textOf(waiting)], [true, c("sync")], JSON.stringify(over));
        assert.equal(view.status(), c("sync"));
        assert.deepEqual([view.main().props.hidden, view.main().props.disabled], [true, true]);
        assert.equal(find(view.tree, node => classesOf(node).includes("retry")), null);
        // Nothing opens before the settings are there.
        view.source().props.onClick();
        assert.equal(view.picker(view.render()), null);
    }
});

test("when reading the settings failed, the window says so, offers to read them again and focuses that", async context => {
    const view = await languageWindow(context, presets({ states: { target: "error" } }));
    const retry = findIn(view.tree, node => classesOf(node).includes("retry"));
    assert.equal(textOf(retry), c("retry_sync"));
    assert.equal(retry.props.disabled, false);
    assert.equal(view.status(), c("sync_error"));
    assert.deepEqual(view.focused, [c("retry_sync")]);
    assert.deepEqual([view.main().props.disabled, view.main().props["aria-busy"]], [true, false]);
    retry.props.onClick();
    assert.deepEqual(view.calls, [["refreshLanguageSettings"]]);
    // With the settings page open, the retry waits too.
    view.setLocked(true);
    assert.equal(findIn(view.render(), node => classesOf(node).includes("retry")).props.disabled, true);
    // While a change is still on its way or being read again, that is not an error yet.
    for (const over of [{ inFlight: { kind: "pending" } }, { isResyncing: true }]) {
        const waiting = await languageWindow(context, presets({ states: { engines: "error" }, ...over }));
        assert.equal(find(waiting.tree, node => classesOf(node).includes("retry")), null);
        assert.equal(waiting.status(), "vr_panel.settings.changing");
    }
});

test("a failed read before the settings arrived says so where the settings would be", async context => {
    const view = await languageWindow(context, presets({ selectable: null, states: { your: "error" } }));
    const waiting = findIn(view.tree, node => classesOf(node).includes("waiting"));
    assert.deepEqual([waiting.props["aria-busy"], textOf(waiting)], [false, c("sync_error")]);
    assert.equal(view.status(), c("sync_error"));
});

test("at rest, the status line says how many languages are chosen", async context => {
    const view = await languageWindow(context);
    assert.equal(view.status(), c("selected_count", { n: 2 }));
    assert.equal(ofClass(view.tree, "status").length, 0, "nothing beside the presets");
    assert.deepEqual([view.main().props.hidden, view.main().props.disabled, view.main().props["aria-busy"]], [false, false, false]);
});

test("the presets: the one in use is pressed; another is sent and the window waits for the answer", async context => {
    const view = await languageWindow(context);
    const buttons = view.presetButtons();
    assert.deepEqual(buttons.map(button => [textOf(button), button.props["aria-label"], button.props["aria-pressed"], classesOf(button).includes("is_on"), button.props["aria-disabled"]]), [
        ["1", c("preset_number", { n: "1" }), true, true, undefined],
        ["2", c("preset_number", { n: "2" }), false, false, undefined],
        ["3", c("preset_number", { n: "3" }), false, false, undefined],
    ]);
    assert.equal(textOf(ofClass(view.tree, "preset_label")[0]), c("preset_number", { n: "1" }));
    buttons[0].props.onClick();
    assert.deepEqual(view.calls, [], "the preset in use is not sent again");
    view.document.activeElement = view.fake(c("preset_number", { n: "2" }));
    buttons[1].props.onClick();
    assert.deepEqual(view.calls, [["setSelectedPresetTabNumber", "2"]]);
    const waiting = view.render();
    assert.ok(view.presetButtons(waiting).every(button => button.props["aria-disabled"] === true));
    assert.equal(view.status(waiting), "vr_panel.settings.changing");
    assert.deepEqual(ofClass(waiting, "status").map(textOf), ["vr_panel.settings.changing"]);
    assert.equal(view.main(waiting).props["aria-busy"], true);
    // A second press while waiting sends nothing.
    view.presetButtons(waiting)[2].props.onClick();
    assert.equal(view.calls.length, 1);
    // The backend moves to preset 2 and answers: the window says it is done, without calling the change someone else's.
    view.model.preset = "2";
    view.render();
    const done = view.answer("success", "req-1");
    assert.equal(view.status(done), c("success", {}));
    assert.equal(view.focused.at(-1), c("preset_number", { n: "2" }));
    assert.deepEqual(view.presetButtons(done).map(button => button.props["aria-pressed"]), [false, true, false]);
});

test("a preset changed elsewhere is announced, drops what was being chosen, and returns to the main screen", async context => {
    const view = await languageWindow(context);
    openTarget(view, 0);
    assert.ok(view.picker());
    view.model.preset = "3";
    view.render();
    assert.equal(view.picker(view.render()), null);
    assert.equal(view.status(), c("external", { n: "3" }));
    // A change of ours that was waiting is dropped with it: its answer no longer moves the window.
    const again = await languageWindow(context);
    again.swap().props.onClick();
    again.render();
    again.model.preset = "2";
    again.settle();
    assert.equal(again.status(), c("external", { n: "2" }));
    again.answer("success", "req-1");
    assert.equal(again.status(), c("external", { n: "2" }));
    vi.advanceTimersByTime(WAIT);
    assert.equal(again.status(again.render()), c("external", { n: "2" }), "no wait is left running");
});

test("the swap is sent, and its answer says it is done without moving the focus", async context => {
    const view = await languageWindow(context);
    view.document.activeElement = view.fake(c("swap_name"));
    view.swap().props.onClick();
    assert.deepEqual(view.calls, [["swapSelectedLanguages"]]);
    view.render();
    const focusedBefore = view.focused.length;
    assert.equal(view.status(view.answer("success")), c("success", {}));
    assert.equal(view.focused.length, focusedBefore);
    // An answer to someone else's request changes nothing.
    view.swap().props.onClick();
    view.render();
    assert.equal(view.status(view.answer("success", "req-99")), "vr_panel.settings.changing");
});

test("a change the backend refuses says so and gives the focus back to the button that sent it", async context => {
    const view = await languageWindow(context);
    const swap = view.fake(c("swap_name"));
    view.document.activeElement = swap;
    view.swap().props.onClick();
    view.render();
    view.focused.length = 0;
    const refused = view.answer("error");
    assert.equal(view.status(refused), c("error"));
    assert.ok(classesOf(ofClass(refused, "status")[0]).includes("error"));
    view.render();
    assert.deepEqual(view.focused, [c("swap_name")]);
    // Drawn again: the focus is not moved again.
    view.render();
    assert.deepEqual(view.focused, [c("swap_name")]);
});

test("when the button that sent a refused change is gone or disabled, the focus goes to your language", async context => {
    for (const lose of ["gone", "disabled"] as const) {
        const view = await languageWindow(context);
        const sender = { name: "a removed row", isConnected: lose !== "gone", focus: () => { view.focused.push("a removed row"); }, closest: () => null,
            matches: (selector: string) => selector === ":disabled" && lose === "disabled" };
        view.document.activeElement = sender;
        view.swap().props.onClick();
        view.render();
        view.focused.length = 0;
        view.answer("error");
        view.render();
        assert.deepEqual(view.focused, ["main_page.your_language›"], lose);
    }
});

test("a refused change in a list gives the focus to the list's back button when the sender is gone", async context => {
    const view = await languageWindow(context);
    openYour(view);
    view.document.activeElement = { isConnected: false, matches: () => false, closest: () => null };
    view.choice(KO).props.onClick();
    view.render();
    view.focused.length = 0;
    view.answer("error");
    view.render();
    assert.deepEqual(view.focused, ["‹ common.go_back_button_label"]);
});

test("a change that cannot be sent says so at once and does not wait", async context => {
    const view = await languageWindow(context);
    view.setFailing(true);
    view.swap().props.onClick();
    const failed = view.render();
    assert.equal(view.status(failed), c("error"));
    assert.equal(view.swap(failed).props["aria-disabled"], undefined);
    vi.advanceTimersByTime(WAIT);
    assert.equal(view.status(view.render()), c("error"));
    // Sending works again: the error goes.
    view.setFailing(false);
    view.swap().props.onClick();
    assert.equal(view.status(view.render()), "vr_panel.settings.changing");
});

test("an answer that is slow to come is called unconfirmed, by the window's own wait or by the backend", async context => {
    const view = await languageWindow(context);
    view.swap().props.onClick();
    view.render();
    vi.advanceTimersByTime(WAIT - 1);
    assert.equal(view.status(view.render()), "vr_panel.settings.changing");
    vi.advanceTimersByTime(1);
    assert.equal(view.status(view.render()), c("unconfirmed"));
    // The answer comes after all.
    assert.equal(view.status(view.answer("success")), c("success", {}));
    // The backend can say so itself, for this request or for the change in flight.
    view.swap().props.onClick();
    view.render();
    assert.equal(view.status(view.answer("unconfirmed")), c("unconfirmed"));
    assert.equal(view.status(view.answer("success")), c("success", {}));
    view.model.inFlight = { kind: "unconfirmed" };
    assert.equal(view.status(view.render()), c("unconfirmed"));
    view.model.inFlight = { kind: "pending" };
    assert.equal(view.status(view.render()), "vr_panel.settings.changing");
});

test("closing the window stops its wait for an answer", async context => {
    const view = await languageWindow(context);
    view.swap().props.onClick();
    view.render();
    view.runtime.unmount();
    assert.equal(vi.getTimerCount(), 0);
});

// The labels the real language names give, in English.
const LABEL = new Map<Language, string>([[JA, "Japanese (Japan)"], [EN, "English (United States)"], [KO, "Korean (South Korea)"],
    [FR, "French (France)"], [DE, "German (Germany)"]]);
const labelOf = (language: Language) => LABEL.get(language) ?? assert.fail("no label");
const back = "‹ common.go_back_button_label";
// A list of languages, by name: the window keeps the recipients' slots, which carry more than the language.
const named = (list: readonly Language[]) => list.map(language => `${language.language} (${language.country})`);
// The key the window gives the list of choices (the search through the tree prefixes it).
const keyOf = (node: TreeNode) => String(node.key).split("$").at(-1);

test("your language's list: the saved languages, sorted by name, yours marked and not offered again", async context => {
    const view = await languageWindow(context);
    const picker = openYour(view);
    assert.equal(view.main(picker).props.hidden, true);
    assert.deepEqual(view.focused.at(-1), back, "the back button takes the focus");
    assert.equal(view.heading(picker), `${c("preset_number", { n: "1" })}${c("edit_your")}`);
    assert.deepEqual(nodesIn(picker).filter(node => node.type === "h3").map(textOf), [c("saved")]);
    const list = view.list(picker);
    // Every preset's languages, even a recipient turned off, once each.
    assert.deepEqual(named(list.props.options), named([EN, FR, DE, JA, KO]));
    assert.deepEqual([list.props.columns, list.props.virtualized, list.props.initialIndex, keyOf(list)], [2, true, 3, "your/saved//1//en"]);
    const japanese = view.choice(JA);
    assert.deepEqual([japanese.props["aria-pressed"], japanese.props.disabled, japanese.props["aria-disabled"], japanese.props["aria-label"]],
        [true, true, undefined, `${labelOf(JA)} · ${c("selected")}`]);
    assert.deepEqual(ofClass(japanese, "check").map(textOf), ["✓"]);
    const korean = view.choice(KO);
    assert.deepEqual([korean.props["aria-pressed"], korean.props.disabled, korean.props["aria-label"], ofClass(korean, "check").length], [false, false, labelOf(KO), 0]);
    const words = draw(findIn(korean, node => componentName(node) === "LanguageText"));
    assert.deepEqual(words.props.children.map(textOf), ["Korean", "South Korea"]);
    // Your language again: nothing is sent.
    view.choice(JA).props.onClick();
    assert.deepEqual(view.calls, []);
    korean.props.onClick();
    assert.deepEqual(view.calls, [["setSelectedYourLanguages", KO]]);
    // The list waits for the answer; then the window goes back to the main screen and to your language.
    const waiting = view.render();
    assert.deepEqual(view.feedback(waiting), ["vr_panel.settings.changing"]);
    assert.equal(view.choice(JA, waiting).props.disabled, false, "while waiting, nothing is disabled under the focus");
    assert.equal(view.choice(KO, waiting).props["aria-disabled"], true);
    view.choice(DE, waiting).props.onClick();
    assert.equal(view.calls.length, 1, "nothing more is sent while waiting");
    view.model.sources = { ...(view.model.sources ?? {}), 1: KO };
    const done = view.answer("success");
    assert.equal(view.picker(done), null);
    assert.equal(view.focused.at(-1), "main_page.your_language›");
    assert.equal(view.status(done), c("success", {}));
});

test("a language that can no longer be chosen stays in the list, disabled", async context => {
    const view = await languageWindow(context, presets({ selectable: [JA, EN, FR, DE] }));
    openYour(view);
    assert.deepEqual(named(view.list().props.options), named([EN, FR, DE, JA, KO]), "Korean is still a recipient");
    assert.equal(view.choice(KO).props.disabled, true);
    assert.equal(view.choice(entry("Klingon", "Space")).props.disabled, true);
});

test("all languages: the full list, with a filter whose first match Enter picks", async context => {
    const view = await languageWindow(context);
    openYour(view);
    const list = allLanguages(view);
    assert.deepEqual(nodesIn(list).filter(node => node.type === "h3").map(textOf), [c("all_languages")]);
    assert.equal(ofClass(list, "all_languages").length, 0);
    assert.equal(view.list(list).props.options.length, 5);
    const filter = findIn(list, node => node.type === "input");
    assert.deepEqual([filter.props.type, filter.props.value, filter.props.disabled, filter.props.placeholder, filter.props["aria-label"]],
        ["search", "", false, "main_page.language_selector.filter", "main_page.language_selector.filter"]);
    filter.props.onChange({ target: { value: "ko" } });
    const narrowed = view.render();
    assert.deepEqual(named(view.list(narrowed).props.options), named([KO]));
    assert.equal(view.list(narrowed).props.initialIndex, -1, "a search starts at its first match, not at your language");
    assert.equal(keyOf(view.list(narrowed)), "your/list//1/ko/en");
    let prevented = 0;
    const key = (event: object) => findIn(view.tree, node => node.type === "input").props.onKeyDown({ preventDefault: () => { prevented++; }, ...event });
    key({ key: "a" });
    key({ key: "Enter", isComposing: true });
    assert.deepEqual([prevented, view.calls], [0, []]);
    key({ key: "Enter" });
    assert.deepEqual([prevented, view.calls], [1, [["setSelectedYourLanguages", KO]]]);
});

test("Enter in the filter does nothing when the first match cannot be chosen or nothing matches", async context => {
    const view = await languageWindow(context);
    openYour(view);
    allLanguages(view);
    const type = (value: string) => { findIn(view.tree, node => node.type === "input").props.onChange({ target: { value } }); return view.render(); };
    let prevented = 0;
    const enter = () => findIn(view.tree, node => node.type === "input").props.onKeyDown({ key: "Enter", preventDefault: () => { prevented++; } });
    type("ja");
    enter();
    assert.deepEqual([prevented, view.calls], [1, []], "your own language");
    const none = type("zz-none");
    assert.deepEqual(view.list(none).props.options, []);
    assert.deepEqual(nodesIn(none).filter(node => node.props.role === "status" && node.type === "p").map(textOf), ["main_page.language_selector.no_results"]);
    enter();
    assert.deepEqual([prevented, view.calls], [1, []]);
});

test("the jump buttons go to each initial's first language and give it the focus", async context => {
    const view = await languageWindow(context, presets({ selectable: [JA, EN, KO, FR, DE, entry("Ελληνικά", "")] }));
    openYour(view);
    const list = allLanguages(view);
    const group = findIn(list, node => node.props.role === "group");
    assert.equal(group.props["aria-label"], c("jump_navigation"));
    const jumps: TreeNode[] = group.props.children;
    assert.deepEqual(jumps.map(jump => [jump.key, jump.props["data-vr-language-jump"], textOf(jump), jump.props["aria-label"], jump.props.type]), [
        ["E", "E", "E", c("jump_to", { group: "E" }), "button"], ["F", "F", "F", c("jump_to", { group: "F" }), "button"],
        ["G", "G", "G", c("jump_to", { group: "G" }), "button"], ["J", "J", "J", c("jump_to", { group: "J" }), "button"],
        ["K", "K", "K", c("jump_to", { group: "K" }), "button"],
        ["other", "other", c("jump_other"), c("jump_to", { group: c("jump_other") }), "button"],
    ]);
    jumps[3].props.onClick();
    jumps[5].props.onClick();
    assert.deepEqual(view.jumps, [[3, { focus: true }], [5, { focus: true }]]);
    // The saved list has no jumps.
    view.back().props.onClick();
    assert.equal(find(view.render(), node => node.props.role === "group"), null);
});

test("back goes from all languages to the saved ones, then to the main screen; Escape does the same", async context => {
    const view = await languageWindow(context);
    openYour(view);
    allLanguages(view);
    findIn(view.tree, node => node.type === "input").props.onChange({ target: { value: "ko" } });
    view.render();
    view.back().props.onClick();
    const saved = view.render();
    assert.deepEqual(nodesIn(saved).filter(node => node.type === "h3").map(textOf), [c("saved")]);
    assert.equal(view.list(saved).props.options.length, 5, "the filter is cleared");
    allLanguages(view);
    assert.equal(findIn(view.tree, node => node.type === "input").props.value, "", "and stays cleared");
    let prevented = 0;
    const body = () => findIn(view.tree, node => node.props["data-vr-language"] === "");
    body().props.onKeyDown({ key: "Escape", preventDefault: () => { prevented++; } });
    view.render();
    body().props.onKeyDown({ key: "Tab", preventDefault: () => { prevented++; } });
    assert.equal(textOf(nodesIn(view.render()).filter(node => node.type === "h3")[0]), c("saved"));
    body().props.onKeyDown({ key: "Escape", preventDefault: () => { prevented++; } });
    view.render();
    assert.equal(view.picker(view.render()), null);
    assert.equal(prevented, 2);
    // On the main screen, Escape is left to the panel.
    body().props.onKeyDown({ key: "Escape", preventDefault: () => { prevented++; } });
    assert.equal(prevented, 2);
    assert.equal(view.focused.at(-1), "main_page.your_language›", "back on the main screen, the focus returns to where it was");
});

test("back and Escape wait while a change is on its way", async context => {
    const view = await languageWindow(context);
    openYour(view);
    view.choice(KO).props.onClick();
    const waiting = view.render();
    assert.equal(view.back(waiting).props["aria-disabled"], true);
    view.back(waiting).props.onClick();
    let prevented = 0;
    findIn(view.tree, node => node.props["data-vr-language"] === "").props.onKeyDown({ key: "Escape", preventDefault: () => { prevented++; } });
    assert.ok(view.picker(view.render()));
    assert.equal(prevented, 0);
    ofClass(view.tree, "all_languages")[0].props.onClick();
    assert.equal(nodesIn(view.render()).filter(node => node.type === "h3").map(textOf)[0], c("saved"), "all languages waits too");
    assert.equal(ofClass(view.tree, "all_languages")[0].props["aria-disabled"], true);
});

test("a recipient's list replaces that recipient; the recipients are marked with their places", async context => {
    const view = await languageWindow(context, presets({ targets: { 1: [EN, KO, EN] } }));
    const picker = openTarget(view, 1);
    assert.equal(view.heading(picker), `${c("preset_number", { n: "1" })}${c("change_target", { n: 2 })}`);
    assert.equal(view.list(picker).props.initialIndex, named(view.list(picker).props.options).indexOf(named([KO])[0]));
    assert.equal(view.choice(EN).props["aria-label"], `${labelOf(EN)} · ${c("selected_slots", { n: "1, 3" })}`);
    assert.equal(view.choice(KO).props["aria-label"], `${labelOf(KO)} · ${c("selected_slots", { n: "2" })}`);
    assert.equal(view.choice(JA).props["aria-pressed"], false, "your language is not a recipient here");
    view.choice(EN).props.onClick();
    assert.deepEqual(view.calls, [], "already a recipient");
    view.choice(FR).props.onClick();
    assert.deepEqual(view.calls, [["setTargetLanguagesInOrder", [{ enable: true, ...EN }, FR, { enable: true, ...EN }]]]);
});

test("the add list adds after the last recipient; with three, no more can be added", async context => {
    const view = await languageWindow(context);
    const picker = openAdd(view);
    assert.equal(view.heading(picker), `${c("preset_number", { n: "1" })}${c("add_title")}`);
    assert.equal(view.list(picker).props.initialIndex, named(view.list(picker).props.options).indexOf(named([EN])[0]), "starts at recipient 1");
    view.choice(DE).props.onClick();
    assert.deepEqual(view.calls, [["setTargetLanguagesInOrder", [{ enable: true, ...EN }, { enable: true, ...KO }, DE]]]);
    // The backend adds it; the add button is gone, so the focus goes to the new last recipient.
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN, KO, DE] };
    view.answer("success");
    assert.equal(view.add(), undefined);
    assert.equal(view.focused.at(-1), `${c("change_target", { n: 3 })}: ${labelOf(DE)}`);
});

test("with three recipients, a language that is not one of them cannot be added", async context => {
    const view = await languageWindow(context, presets({ targets: { 1: [EN, KO] } }));
    openAdd(view);
    // A third recipient arrives while the list is open, from this window's own change elsewhere.
    view.model.targets = { 1: [EN, KO, FR] };
    view.render();
    assert.equal(view.picker(view.render()), null, "the list closes when the recipients change elsewhere");
    assert.equal(view.status(), c("settings_updated", {}));
});

test("removing a recipient keeps the order and focuses the recipient now in its place; the last one cannot be removed", async context => {
    const view = await languageWindow(context, presets({ targets: { 1: [EN, KO, FR] } }));
    const removes = view.removeButtons();
    assert.deepEqual(removes.map(button => [button.props.disabled, button.props["aria-disabled"], button.props["aria-label"]]), [
        [false, undefined, c("remove", { n: 1, language: "English", country: "United States" })],
        [false, undefined, c("remove", { n: 2, language: "Korean", country: "South Korea" })],
        [false, undefined, c("remove", { n: 3, language: "French", country: "France" })],
    ]);
    assert.ok(removes.every(button => findIn(button, node => typeof node.type === "function").props["aria-hidden"] === "true"));
    removes[2].props.onClick();
    assert.deepEqual(view.calls, [["setTargetLanguagesInOrder", [{ enable: true, ...EN }, { enable: true, ...KO }]]]);
    const waiting = view.render();
    assert.deepEqual(view.removeButtons(waiting).map(button => button.props["aria-disabled"]), [true, true, true]);
    view.model.targets = { 1: [EN, KO] };
    view.answer("success");
    // The third is gone: the second, now the last, takes the focus.
    assert.equal(view.focused.at(-1), `${c("change_target", { n: 2 })}: ${labelOf(KO)}`);
    view.removeButtons()[0].props.onClick();
    assert.deepEqual(view.calls.at(-1), ["setTargetLanguagesInOrder", [{ enable: true, ...KO }]]);
    view.model.targets = { 1: [KO] };
    view.answer("success");
    assert.equal(view.focused.at(-1), `${c("change_target", { n: 1 })}: ${labelOf(KO)}`);
    const [only] = view.removeButtons();
    assert.deepEqual([only.props.disabled, only.props["aria-disabled"], only.props["aria-label"], textOf(only)], [true, undefined, c("min_reason"), c("required")]);
    only.props.onClick();
    assert.equal(view.calls.length, 2);
});

test("the count beside the recipients says when a language is chosen twice", async context => {
    const view = await languageWindow(context, presets({ targets: { 1: [EN, KO, EN] } }));
    assert.equal(textOf(ofClass(view.tree, "count")[0]), `3 / 3 · ${c("duplicate")}`);
    const single = await languageWindow(context);
    assert.equal(textOf(ofClass(single.tree, "count")[0]), "2 / 3");
});

test("the translator's list: the available ones to pick, the unavailable ones folded away", async context => {
    const view = await languageWindow(context);
    const row = view.engineRow();
    assert.equal(textOf(row), "main_page.translatorconfig_page.translation.section_label_ai_translation›");
    const picker = openEngine(view);
    assert.equal(view.heading(picker), `${c("preset_number", { n: "1" })}main_page.translator`);
    assert.deepEqual(nodesIn(picker).filter(node => node.type === "h3").map(textOf), [c("available")]);
    assert.equal(find(picker, node => node.type === "picker-list"), null);
    const choices = nodesIn(picker).filter(node => componentName(node) === "EngineChoice").map(node => draw(node));
    assert.deepEqual(choices.map(choice => [choice.props["aria-label"], choice.props.disabled, choice.props["aria-pressed"], choice.props["aria-disabled"],
        textOf(choice.props.children[0].props.children[1]), ofClass(choice, "check").length]), [
        [`config_page.translation.section_label_ai_translation · ${c("selected")}`, true, true, undefined, "common.default_label", 1],
        ["DeepL", false, false, undefined, "\u00a0", 0],
        ["Gemini API", true, false, undefined, "\u00a0", 0],
    ]);
    const details = findIn(picker, node => node.type === "details");
    assert.equal(details.props.open, false);
    const summary = findIn(details, node => node.type === "summary");
    assert.deepEqual([textOf(summary), summary.props.tabIndex, summary.props["aria-disabled"]], [`${c("unavailable")}1›`, undefined, undefined]);
    assert.deepEqual(ofClass(details, "helper").map(textOf), [c("unavailable_hint")]);
    // The one in use and the unavailable one are disabled; the other is picked.
    choices[1].props.onClick();
    assert.deepEqual(view.calls, [["setSelectedTranslationEngines", "DeepL"]]);
    // Opened by hand, the fold says so.
    details.props.onToggle({ currentTarget: { open: true } });
    const open = findIn(view.render(), node => node.type === "details");
    assert.equal(open.props.open, true);
    assert.equal(textOf(findIn(open, node => node.type === "summary")).at(-1), "⌄");
    let prevented = 0;
    findIn(open, node => node.type === "summary").props.onClick({ preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1, "it does not toggle while a change is on its way");
    view.model.engine = { ...(view.model.engine ?? {}), 1: "DeepL" };
    assert.equal(view.picker(view.answer("success")), null);
});

test("the translator in use cannot be used: the main screen says so, and its list opens with the unavailable ones shown", async context => {
    const view = await languageWindow(context, presets({ engine: { 1: "Gemini_API" } }));
    const row = view.engineRow();
    assert.equal(textOf(row), `main_page.translator${c("unavailable")}Gemini API›`);
    openEngine(view);
    assert.equal(findIn(view.tree, node => node.type === "details").props.open, true);
    // A translator that becomes unavailable while the list is closed opens it the next time.
    const later = await languageWindow(context);
    later.model.engine = { 1: "Gemini_API" };
    later.settle();
    openEngine(later);
    assert.equal(findIn(later.tree, node => node.type === "details").props.open, true);
});

test("a recipient in your own language is warned about on the main screen and in the translator's list", async context => {
    const view = await languageWindow(context, presets({ targets: { 1: [entry("Japanese", "Japan"), KO] } }));
    assert.equal(textOf(view.engineRow()), `main_page.translator${c("same_short")}config_page.translation.section_label_ai_translation›`);
    openEngine(view);
    assert.deepEqual(ofClass(view.tree, "warning").map(textOf), [c("same_reason", { engine: "config_page.translation.section_label_ai_translation" })]);
    const fine = await languageWindow(context);
    openEngine(fine);
    assert.equal(ofClass(fine.tree, "warning").length, 0);
});

test("the translator's list starts at its top; the language lists keep where they were", async context => {
    const view = await languageWindow(context);
    openYour(view);
    view.fake("picker_scroll").scrollTop = 120;
    view.back().props.onClick();
    view.render();
    openYour(view);
    assert.equal(view.fake("picker_scroll").scrollTop, 120);
    view.back().props.onClick();
    view.render();
    openEngine(view);
    assert.equal(view.fake("picker_scroll").scrollTop, 0);
});

test("the main screen comes back at its own scroll position", async context => {
    const view = await languageWindow(context);
    view.fake("fieldset main").scrollTop = 75;
    openTarget(view, 1);
    view.fake("fieldset main").scrollTop = 0;
    view.back().props.onClick();
    view.render();
    assert.equal(view.fake("fieldset main").scrollTop, 75);
    assert.equal(view.focused.at(-1), `${c("change_target", { n: 2 })}: ${labelOf(KO)}`);
});

test("languages changed elsewhere while a list is open return the window to the main screen and say so", async context => {
    const view = await languageWindow(context);
    openTarget(view, 0);
    view.model.sources = { ...(view.model.sources ?? {}), 1: KO };
    view.render();
    assert.equal(view.picker(view.render()), null);
    assert.equal(view.status(), c("settings_updated", {}));
    // Something else that changed (the translator) keeps the list open.
    openYour(view);
    view.model.engine = { 1: "DeepL" };
    view.settle();
    assert.ok(view.picker());
});

test("after a refused change in a list, the list stays open while the backend restores its languages", async context => {
    const view = await languageWindow(context);
    openTarget(view, 1);
    view.choice(FR).props.onClick();
    view.render();
    // The refusal comes while the backend reads its languages again, and they change on the way.
    view.model.isResyncing = true;
    view.answer("error");
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN, FR] };
    view.settle();
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN, KO] };
    view.settle();
    view.model.isResyncing = false;
    view.settle();
    assert.ok(view.picker(), "still in the list");
    assert.equal(view.status(), c("error"));
    // Later changes from elsewhere are noticed again.
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN, DE] };
    view.settle();
    assert.equal(view.picker(), null);
});

test("while the settings page is open, nothing opens or is sent, and the lists wait", async context => {
    const view = await languageWindow(context, presets(), { locked: true });
    assert.equal(view.main().props.disabled, true);
    view.source().props.onClick();
    view.swap().props.onClick();
    view.presetButtons()[1].props.onClick();
    assert.equal(view.picker(view.render()), null);
    assert.deepEqual(view.calls, []);
    // Locked while a list is open.
    const open = await languageWindow(context);
    openYour(open);
    allLanguages(open);
    open.setLocked(true);
    const locked = open.render();
    assert.equal(open.picker(locked)?.props.disabled, true);
    open.back(locked).props.onClick();
    findIn(locked, node => node.props["data-vr-language"] === "").props.onKeyDown({ key: "Escape", preventDefault() {} });
    findIn(locked, node => node.props.role === "group").props.children[0].props.onClick();
    assert.ok(open.picker(open.render()));
    assert.deepEqual(open.jumps, []);
    open.back().props.onClick();
    open.render();
    openEngine(open);
    const engine = await languageWindow(context);
    openEngine(engine);
    engine.setLocked(true);
    const summary = findIn(engine.render(), node => node.type === "summary");
    assert.deepEqual([summary.props.tabIndex, summary.props["aria-disabled"]], [-1, true]);
    let prevented = 0;
    summary.props.onClick({ preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1);
});

test("a focused choice that the feedback pushes out of view is scrolled back into it", async context => {
    const view = await languageWindow(context);
    openYour(view);
    // The list's box is drawn at half its size (the atlas is scaled): 400 px on screen for 200 px of list.
    const list = { scrollTop: 50, clientHeight: 200, getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }) };
    let row = { top: 380, bottom: 460 };
    view.document.activeElement = { closest: (selector: string) => selector === ".picker_scroll" ? list : null, getBoundingClientRect: () => row,
        isConnected: true, matches: () => false };
    view.choice(KO).props.onClick();
    view.render();
    assert.equal(list.scrollTop, 80, "60 px below on screen is 30 px of list");
    row = { top: -40, bottom: 40 };
    view.answer("error");
    assert.equal(list.scrollTop, 60);
    // A focused element outside any list is left alone.
    view.document.activeElement = { closest: () => null, isConnected: true, matches: () => false };
    view.choice(DE).props.onClick();
    view.render();
    assert.equal(list.scrollTop, 60);
});

test("the window is titled for the languages and closes with its frame's button", async context => {
    const view = await languageWindow(context);
    assert.equal(view.tree.type, "window");
    assert.equal(view.tree.props.title, "vr_panel.window_language");
    assert.equal(typeof view.tree.props.Icon, "function");
    view.tree.props.onClose();
    assert.deepEqual(view.calls, [["close"]]);
});

test("a language of another country, or another language of the same country, is another choice", async context => {
    const japaneseInBrazil = entry("Japanese", "Brazil"), englishInJapan = entry("English", "Japan");
    const view = await languageWindow(context, presets({ selectable: [JA, EN, KO, japaneseInBrazil, englishInJapan] }));
    openYour(view);
    allLanguages(view);
    assert.deepEqual([view.choice(japaneseInBrazil).props["aria-pressed"], view.choice(englishInJapan).props["aria-pressed"]], [false, false]);
    view.choice(japaneseInBrazil).props.onClick();
    assert.deepEqual(view.calls, [["setSelectedYourLanguages", japaneseInBrazil]]);
});

test("at rest, the window starts on the main screen with no notice, its focus on your language", async context => {
    const view = await languageWindow(context);
    const settled = view.settle();
    assert.equal(view.status(settled), c("selected_count", { n: 2 }));
    assert.deepEqual(view.focused, ["main_page.your_language›"]);
});

test("while any language setting is being read again, the window waits and sends nothing", async context => {
    for (const store of ["tab", "your", "target", "selectedEngines", "engines"] as const) {
        const view = await languageWindow(context, presets({ states: { [store]: "pending" } }));
        assert.equal(view.status(), "vr_panel.settings.changing", store);
        assert.equal(view.swap().props["aria-disabled"], true);
        view.swap().props.onClick();
        view.source().props.onClick();
        assert.deepEqual(view.calls, [], store);
        assert.equal(view.picker(view.render()), null);
    }
});

test("settings that have not been read at all leave the window waiting for them", async context => {
    for (const over of [{ sources: null }, { sources: {} }, { targets: null }]) {
        const view = await languageWindow(context, presets(over));
        assert.equal(view.status(), c("sync"), JSON.stringify(over));
    }
    const noEngine = await languageWindow(context, presets({ engine: null }));
    assert.equal(textOf(noEngine.engineRow()), `main_page.translator${c("unavailable")}›`);
});

test("a preset changed elsewhere while a list is open gives the focus to that preset", async context => {
    const view = await languageWindow(context);
    openTarget(view, 0);
    view.model.preset = "3";
    view.settle();
    view.render();
    assert.equal(view.focused.at(-1), c("preset_number", { n: "3" }));
});

test("an answer stops the window's own wait: it never says unconfirmed afterwards", async context => {
    const view = await languageWindow(context);
    view.swap().props.onClick();
    view.render();
    view.answer("success");
    vi.advanceTimersByTime(WAIT * 2);
    assert.equal(view.status(view.render()), c("success", {}));
});

test("a refusal that comes during a resync gives the focus back only once the resync is over", async context => {
    const view = await languageWindow(context);
    view.document.activeElement = view.fake(c("swap_name"));
    view.swap().props.onClick();
    view.render();
    view.model.isResyncing = true;
    view.focused.length = 0;
    view.answer("error");
    view.settle();
    assert.deepEqual(view.focused, []);
    view.model.isResyncing = false;
    view.settle();
    assert.deepEqual(view.focused, [c("swap_name")]);
});

test("the retry takes the focus once, not again each time the window is drawn", async context => {
    const view = await languageWindow(context, presets({ states: { your: "error" } }));
    view.render();
    view.render();
    assert.deepEqual(view.focused, [c("retry_sync")]);
});

test("languages changed elsewhere are shown on the main screen without a notice", async context => {
    const view = await languageWindow(context);
    // A list was opened and closed, so the window remembers the languages it showed.
    openYour(view);
    view.back().props.onClick();
    view.render();
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN, DE] };
    view.settle();
    assert.equal(view.status(), c("selected_count", { n: 2 }));
    assert.deepEqual(view.targetButtons().map(button => button.props["aria-label"]),
        [`${c("change_target", { n: 1 })}: ${labelOf(EN)}`, `${c("change_target", { n: 2 })}: ${labelOf(DE)}`]);
    // The order beside each recipient counts from 1.
    assert.deepEqual(view.targetButtons().map(button => textOf(ofClass(button, "order")[0])), ["1", "2"]);
});

test("a sync error is said beside the presets and in a list, marked as an error", async context => {
    const view = await languageWindow(context);
    openYour(view);
    view.model.states = { target: "error" };
    const failed = view.render();
    assert.deepEqual(ofClass(failed, "feedback").map(node => [textOf(node), classesOf(node)]), [[c("sync_error"), ["feedback", "error"]]]);
    assert.deepEqual([view.picker(failed)?.props.disabled, view.picker(failed)?.props["aria-busy"]], [true, false]);
    const main = await languageWindow(context, presets({ states: { tab: "error" } }));
    assert.deepEqual(ofClass(main.tree, "status").map(node => [textOf(node), classesOf(node)]), [[c("sync_error"), ["status", "error"]]]);
});

test("the line beside the presets and the list's feedback are marked as errors only for an error", async context => {
    const view = await languageWindow(context);
    view.swap().props.onClick();
    assert.deepEqual(ofClass(view.render(), "status").map(classesOf), [["status"]]);
    view.answer("success");
    assert.deepEqual(ofClass(view.tree, "status").map(classesOf), [["status"]]);
    openYour(view);
    view.choice(KO).props.onClick();
    const waiting = view.render();
    assert.deepEqual(ofClass(waiting, "feedback").map(classesOf), [["feedback"]]);
    assert.equal(view.picker(waiting)?.props["aria-busy"], true);
    view.answer("error");
    assert.deepEqual(ofClass(view.tree, "feedback").map(classesOf), [["feedback", "error"]]);
    // The error is not left over once the change is sent again: the wait is not an error.
    view.choice(DE).props.onClick();
    assert.deepEqual(ofClass(view.render(), "feedback").map(classesOf), [["feedback"]]);
});

test("back clears an error, and the saved list starts again at the language in use", async context => {
    const view = await languageWindow(context);
    openYour(view);
    view.setFailing(true);
    view.choice(KO).props.onClick();
    assert.equal(view.status(view.render()), c("error"));
    view.setFailing(false);
    allLanguages(view);
    findIn(view.tree, node => node.type === "input").props.onChange({ target: { value: "e" } });
    view.render();
    view.back().props.onClick();
    const saved = view.render();
    assert.notEqual(view.status(saved), c("error"));
    assert.equal(view.list(saved).props.initialIndex, named(view.list(saved).props.options).indexOf(named([JA])[0]));
    assert.equal(view.picker(saved)?.props["aria-busy"], false);
    assert.equal(view.back(saved).props["aria-disabled"], undefined);
    assert.equal(find(saved, node => node.type === "input"), null, "the saved list has no filter");
    assert.equal(textOf(ofClass(saved, "all_languages")[0]), `${c("all_languages")}›`);
    assert.equal(ofClass(saved, "all_languages")[0].props["aria-disabled"], undefined);
});

test("a notice is not carried into a list", async context => {
    const view = await languageWindow(context);
    view.swap().props.onClick();
    view.render();
    view.answer("success");
    assert.deepEqual(view.feedback(openYour(view)), []);
});

test("while a change is on its way, every button on the main screen says it is unavailable", async context => {
    const view = await languageWindow(context);
    const disabledness = (tree: TreeNode) => [view.source(tree), view.swap(tree), ...view.targetButtons(tree), view.add(tree), view.engineRow(tree)]
        .map(button => button.props["aria-disabled"]);
    assert.deepEqual(disabledness(view.tree), [undefined, undefined, undefined, undefined, undefined, undefined]);
    view.swap().props.onClick();
    assert.deepEqual(disabledness(view.render()), [true, true, true, true, true, true]);
    // A single recipient's remove button is disabled outright, not for the wait.
    const single = await languageWindow(context, presets({ targets: { 1: [EN] } }));
    single.swap().props.onClick();
    assert.equal(single.removeButtons(single.render())[0].props["aria-disabled"], undefined);
});

test("back from a list gives the focus to the button that opened it", async context => {
    const view = await languageWindow(context);
    for (const [open, name] of [[openAdd, `＋${c("add")}`], [openEngine, "main_page.translatorconfig_page.translation.section_label_ai_translation›"],
        [(v: View) => openTarget(v, 1), `${c("change_target", { n: 2 })}: ${labelOf(KO)}`], [openYour, "main_page.your_language›"]] as const) {
        open(view);
        view.back().props.onClick();
        view.render();
        assert.equal(view.focused.at(-1), name);
    }
});

test("a recipient removed elsewhere while its list was open leaves the focus on your language", async context => {
    const view = await languageWindow(context);
    openTarget(view, 1);
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN] };
    view.settle();
    view.render();
    assert.equal(view.focused.at(-1), "main_page.your_language›");
});

test("the saved list holds every preset's languages that can still be chosen", async context => {
    const SPANISH = entry("Spanish", "Spain"), ITALIAN = entry("Italian", "Italy");
    const view = await languageWindow(context, presets({ preset: "3", sources: { 1: KO, 2: SPANISH, 3: JA }, targets: { 1: [DE], 2: [ITALIAN], 3: [FR] },
        selectable: [JA, KO, SPANISH, DE, FR] }));
    openYour(view);
    assert.deepEqual(named(view.list().props.options), named([FR, DE, JA, KO, SPANISH]), "Italian can no longer be chosen");
});

test("the saved list is built again when the settings arrive", async context => {
    const view = await languageWindow(context, presets({ selectable: null }));
    view.model.selectable = [JA, EN, KO, FR, DE];
    view.settle();
    openYour(view);
    assert.equal(view.list().props.options.length, 5);
});

test("a short list is drawn whole; the choices are keyed by language and marked when chosen", async context => {
    const view = await languageWindow(context, presets({ sources: { 1: JA }, targets: { 1: [EN] }, selectable: [JA, EN, KO] }));
    openTarget(view, 0);
    const list = view.list();
    assert.deepEqual([list.props.options.length, list.props.virtualized], [2, false]);
    const english = view.choice(EN), japanese = view.choice(JA);
    assert.deepEqual([english.key, japanese.key], ["English/United States", "Japanese/Japan"]);
    assert.deepEqual([classesOf(english).includes("is_selected"), classesOf(japanese).includes("is_selected")], [true, false]);
});

test("after a refused add that left three recipients, the add list offers no fourth", async context => {
    const view = await languageWindow(context);
    openAdd(view);
    view.choice(DE).props.onClick();
    view.render();
    view.model.isResyncing = true;
    view.answer("error");
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN, KO, FR] };
    view.settle();
    view.model.isResyncing = false;
    view.settle();
    assert.ok(view.picker());
    assert.deepEqual([view.choice(DE).props.disabled, view.choice(JA).props.disabled], [true, true]);
    // A recipient's list with three recipients still replaces one.
    const replace = await languageWindow(context, presets({ targets: { 1: [EN, KO, FR] } }));
    openTarget(replace, 0);
    assert.equal(replace.choice(DE).props.disabled, false);
});

test("the jump buttons wait with the rest while a change is on its way, and there are none without matches", async context => {
    const view = await languageWindow(context);
    openYour(view);
    allLanguages(view);
    const jumps = (tree: TreeNode): TreeNode[] => findIn(tree, node => node.props.role === "group").props.children;
    assert.ok(jumps(view.tree).every(jump => jump.props["aria-disabled"] === undefined));
    view.choice(KO).props.onClick();
    const waiting = view.render();
    assert.ok(jumps(waiting).every(jump => jump.props["aria-disabled"] === true));
    jumps(waiting)[0].props.onClick();
    assert.deepEqual(view.jumps, []);
    view.answer("success");
    const other = await languageWindow(context);
    openYour(other);
    allLanguages(other);
    findIn(other.tree, node => node.type === "input").props.onChange({ target: { value: "zz-none" } });
    assert.equal(find(other.render(), node => node.props.role === "group"), null);
});

test("the unavailable translators' fold opens and closes freely when nothing is on its way", async context => {
    const view = await languageWindow(context);
    openEngine(view);
    let prevented = 0;
    findIn(view.tree, node => node.type === "summary").props.onClick({ preventDefault: () => { prevented++; } });
    assert.equal(prevented, 0);
});

test("the translator's list: picked ones are marked, available ones wait while a change is on its way", async context => {
    const view = await languageWindow(context, presets({ engine: { 1: "DeepL" } }));
    openEngine(view);
    const choices = () => nodesIn(view.tree).filter(node => componentName(node) === "EngineChoice").map(node => draw(node));
    const [local, deepl, gemini] = choices();
    assert.deepEqual([local, deepl, gemini].map(choice => classesOf(choice).includes("is_selected")), [false, true, false]);
    assert.equal(textOf(deepl.props.children[0].props.children[1]), c("selected"), "a picked translator that is not the default says it is picked");
    local.props.onClick();
    view.render();
    const [waitingLocal, waitingDeepl, waitingGemini] = choices();
    assert.deepEqual([waitingLocal.props["aria-disabled"], waitingDeepl.props["aria-disabled"], waitingGemini.props["aria-disabled"]], [true, true, undefined]);
    assert.equal(waitingDeepl.props.disabled, false, "while waiting, the picked one is not disabled under the focus");
    waitingDeepl.props.onClick();
    assert.equal(view.calls.length, 1);
});

test("a focused choice already in view is left where it is", async context => {
    const view = await languageWindow(context);
    openYour(view);
    const list = { scrollTop: 50, clientHeight: 200, getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }) };
    view.document.activeElement = { closest: (selector: string) => selector === ".picker_scroll" ? list : null,
        getBoundingClientRect: () => ({ top: 100, bottom: 180 }), isConnected: true, matches: () => false };
    view.choice(KO).props.onClick();
    view.render();
    view.answer("error");
    assert.equal(list.scrollTop, 50);
});

test("a read that fails after the window opened moves the focus to the retry", async context => {
    const view = await languageWindow(context);
    view.settle();
    view.model.states = { engines: "error" };
    view.settle();
    assert.equal(view.focused.at(-1), c("retry_sync"));
});

test("after a refused change that left fewer recipients, the list of a recipient that is gone sends nothing", async context => {
    const view = await languageWindow(context, presets({ targets: { 1: [EN, KO, FR] } }));
    openTarget(view, 2);
    view.choice(DE).props.onClick();
    view.render();
    view.model.isResyncing = true;
    view.answer("error");
    view.model.targets = { ...(view.model.targets ?? {}), 1: [EN, KO] };
    view.settle();
    view.model.isResyncing = false;
    view.settle();
    assert.ok(view.picker(), "the list stays open after its own refusal");
    view.choice(JA).props.onClick();
    assert.deepEqual(view.calls.map(([name]) => name), ["setTargetLanguagesInOrder"], "only the refused change was sent");
});
