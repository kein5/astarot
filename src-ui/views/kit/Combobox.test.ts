import assert from "node:assert/strict";
import { test } from "vitest";
import { findIn, hooks, loadModule, nodesIn, setRef, unchecked } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as model from "./comboboxModel.ts";
import type { ComboboxGroup, ComboboxOption } from "./comboboxModel.ts";

// The kit's searchable choice (#1369): what a search keeps and where the keys go (comboboxModel.ts),
// then the part drawn with the code it runs. The kit's Popover stands in as its three parts, so a
// test opens and closes it through the root's onOpenChange, as Radix would.

const option = (value: string, extra: Partial<ComboboxOption> = {}): ComboboxOption => ({ value, label: value, ...extra });

// The translation engines as the settings page offers them: the one on the PC, then the APIs, two
// of which cannot be used now.
const GROUPS: ComboboxGroup[] = [
    { id: "local", label: "On your PC", options: [option("CTranslate2", { label: "AI translation (local)" })] },
    { id: "api", label: "API (cloud or your own server)", options: [
        option("DeepL_API", { label: "DeepL API" }),
        option("Papago_API", { label: "Papago", disabled: true }),
        option("OpenAI_API", { label: "OpenAI API" }),
        option("Groq_API", { label: "Groq API" }),
        option("OpenAI_Compatible", { label: "OpenAI Compatible", disabled: true }),
    ] },
];
const values = (options: readonly ComboboxOption[]) => options.map(item => item.value);

test("a search reads full-width letters, kana and case as one, and needs every word it is given", () => {
    assert.equal(model.searchForm("ＤｅｅｐＬ API"), "deeplapi");
    assert.equal(model.searchForm("でぃーぷ"), model.searchForm("ディープ"), "hiragana finds katakana");
    assert.equal(model.searchForm("ｵﾗﾏ"), "オラマ", "half-width katakana are read as full-width");
    const openai = option("OpenAI_API", { label: "OpenAI API" });
    assert.equal(model.matchesSearch(openai, ""), true, "no search keeps everything");
    assert.equal(model.matchesSearch(openai, "  "), true);
    assert.equal(model.matchesSearch(openai, "api open"), true, "the words in any order");
    assert.equal(model.matchesSearch(openai, "open ai"), true, "a space between the words of a name");
    assert.equal(model.matchesSearch(openai, "deepl"), false);
    assert.equal(model.matchesSearch(openai, "open deepl"), false, "every word must be found");
    assert.equal(model.matchesSearch(option("CTranslate2", { label: "AI翻訳（ローカル）", keywords: ["CTranslate2"] }), "ctrans"), true, "a keyword");
    assert.equal(model.matchesSearch(option("CTranslate2", { label: "AI翻訳（ローカル）" }), "ろーかる"), true);
});

test("a search keeps the groups' order and drops a group it keeps nothing of, heading and all", () => {
    assert.deepEqual(model.searchGroups(GROUPS, ""), GROUPS);
    const kept = model.searchGroups(GROUPS, "openai");
    assert.deepEqual(kept.map(group => [group.id, values(group.options)]), [["api", ["OpenAI_API", "OpenAI_Compatible"]]]);
    assert.deepEqual(model.searchGroups(GROUPS, "local ai").map(group => group.id), ["local"]);
    assert.deepEqual(model.searchGroups(GROUPS, "nothing like it"), []);
    assert.deepEqual(values(model.optionsOf(GROUPS)), ["CTranslate2", "DeepL_API", "Papago_API", "OpenAI_API", "Groq_API", "OpenAI_Compatible"]);
});

test("the keys start on the value, pass what cannot be chosen, and go round from the last to the first", () => {
    const all = model.optionsOf(GROUPS);
    assert.equal(model.startingOption(all, "Groq_API"), "Groq_API", "the list opens on the value");
    assert.equal(model.startingOption(all, "Papago_API"), "CTranslate2", "a value that cannot be chosen is not where the keys start");
    assert.equal(model.startingOption(all, undefined), "CTranslate2");
    assert.equal(model.startingOption([option("a", { disabled: true })], "a"), undefined, "nothing can be chosen");
    assert.equal(model.stepOption(all, "DeepL_API", 1), "OpenAI_API", "Down passes Papago");
    assert.equal(model.stepOption(all, "OpenAI_API", -1), "DeepL_API", "Up passes it too");
    assert.equal(model.stepOption(all, "Groq_API", 1), "CTranslate2", "from the last that can be chosen to the first");
    assert.equal(model.stepOption(all, "CTranslate2", -1), "Groq_API");
    assert.equal(model.stepOption(all, undefined, 1), "CTranslate2", "from no choice, Down goes to the first");
    assert.equal(model.stepOption(all, undefined, -1), "Groq_API", "and Up to the last");
    assert.equal(model.stepOption([], undefined, 1), undefined);
    assert.equal(model.activeOption(all, "Groq_API"), "Groq_API");
    assert.equal(model.activeOption(all, "Papago_API"), "CTranslate2", "an option that cannot be chosen is never active");
    assert.equal(model.activeOption(all, "gone"), "CTranslate2", "nor one the list no longer holds");
});

// A key going down in a field, as React hands it: which key, whether an IME composes with it, and
// whether the handler took it.
const key = (name: string, composing = false) => {
    const event = { key: name, keyCode: composing ? 229 : 0, nativeEvent: { isComposing: composing }, prevented: false,
        preventDefault: () => { event.prevented = true; } };
    return event;
};

async function combobox(initial: Record<string, unknown> = {}) {
    const runtime = hooks();
    const module = await loadModule<typeof import("./Combobox.tsx")>(new URL("./Combobox.tsx", import.meta.url), runtime, {
        "./Popover.tsx": { Popover: "popover", PopoverTrigger: "popover-trigger", PopoverContent: "popover-content" },
        "./Field.css.ts": { field: (variants: Record<string, unknown>) => `field kind=${String(variants.kind)}`, chevron: "chevron" },
        "./comboboxModel.ts": model,
    });
    const chosen: string[] = [];
    let props: Record<string, unknown> = { value: "Groq_API", onValueChange: (value: string) => { chosen.push(value); }, groups: GROUPS,
        placeholder: "Not chosen", searchLabel: "Search translation engines", emptyText: "No matching engines",
        "aria-labelledby": "row-label", "aria-describedby": "row-note", ...initial };
    // The part drawn again with its props, and its parts by their slots.
    const draw = (next: Record<string, unknown> = {}) => {
        props = { ...props, ...next };
        // The part's props as a test gives them; they are the part's own prop names.
        const tree = runtime.render(module.Combobox, unchecked<Parameters<typeof module.Combobox>[0]>(props));
        const slot = (name: string) => findIn(tree, node => node.props?.["data-slot"] === name, name);
        const items = nodesIn(tree).filter(node => node.props?.["data-slot"] === "command-item");
        return { tree, slot, items, active: items.find(node => node.props["aria-selected"] === true)?.props["data-value"] };
    };
    return { runtime, draw, chosen };
}

const open = (drawn: { tree: TreeNode }) => { drawn.tree.props.onOpenChange(true); };

test("the button is the field: a combobox named by its row, showing the choice, as wide as the longest", async () => {
    const { draw } = await combobox();
    const { tree, slot } = draw();
    assert.deepEqual([tree.type, tree.props.open], ["popover", false]);
    const trigger = slot("combobox-trigger");
    assert.equal(findIn(tree, node => node.type === "popover-trigger").props.asChild, true);
    assert.deepEqual([trigger.type, trigger.props.type, trigger.props.role, trigger.props.className],
        ["button", "button", "combobox", "field kind=select trigger"]);
    assert.deepEqual([trigger.props["aria-labelledby"], trigger.props["aria-describedby"], trigger.props["aria-busy"], trigger.props.disabled],
        ["row-label", "row-note", undefined, false]);
    const cell = findIn(trigger, node => node.props?.className === "value", "the words' cell");
    const hidden = nodesIn(cell).filter(node => node.props.className === "sizer");
    assert.deepEqual(hidden.map(node => [node.props.children, node.props["aria-hidden"]]),
        [...model.optionsOf(GROUPS).map(item => [item.label, "true"]), ["Not chosen", "true"]], "every choice's words lie hidden in one cell");
    assert.deepEqual([slot("combobox-value").props.className, slot("combobox-value").props.children], ["shown", "Groq API"]);
    assert.equal(slot("combobox-icon").props["aria-hidden"], "true");
    // Nothing chosen, or a value the list does not hold: the placeholder, in its colour.
    for (const value of [undefined, "Removed_API"]) {
        const shown = draw({ value }).slot("combobox-value");
        assert.deepEqual([shown.props.className, shown.props.children], ["shown placeholder", "Not chosen"]);
    }
});

test("the list is a listbox of groups named by their headings, the search field a combobox that points into it", async () => {
    const { draw } = await combobox();
    const { slot, items } = draw();
    const content = slot("combobox-content");
    assert.deepEqual([content.type, content.props.inset, content.props.align, content.props.collisionPadding, content.props["aria-labelledby"]],
        ["popover-content", "tight", "start", 8, "row-label"]);
    const list = slot("command-list");
    const input = slot("command-input");
    assert.deepEqual([input.type, input.props.role, input.props["aria-autocomplete"], input.props["aria-expanded"], input.props["aria-controls"]],
        ["input", "combobox", "list", "true", list.props.id]);
    assert.deepEqual([input.props["aria-label"], input.props.placeholder, input.props.autoComplete, input.props.value],
        ["Search translation engines", "Search translation engines", "off", ""]);
    assert.deepEqual([list.props.role, list.props["aria-labelledby"]], ["listbox", "row-label"]);
    const groups = nodesIn(list).filter(node => node.props?.["data-slot"] === "command-group");
    assert.deepEqual(groups.map(group => {
        const heading = findIn(group, node => node.props?.["data-slot"] === "command-group-heading");
        assert.equal(group.props["aria-labelledby"], heading.props.id);
        return [group.props.role, heading.props.children];
    }), [["group", "On your PC"], ["group", "API (cloud or your own server)"]]);
    assert.deepEqual(items.map(item => [item.props["data-value"], item.props.role, item.props["aria-disabled"], item.props["data-checked"]]), [
        ["CTranslate2", "option", undefined, undefined], ["DeepL_API", "option", undefined, undefined], ["Papago_API", "option", true, undefined],
        ["OpenAI_API", "option", undefined, undefined], ["Groq_API", "option", undefined, true], ["OpenAI_Compatible", "option", true, undefined],
    ]);
    // The search field points at the active choice by its id, which does not change with a search.
    const groq = items.find(item => item.props["data-value"] === "Groq_API");
    assert.equal(input.props["aria-activedescendant"], groq?.props.id);
    assert.equal(new Set(items.map(item => item.props.id)).size, items.length);
    assert.equal(draw({ align: "end" }).slot("combobox-content").props.align, "end", "a button at its row's end");
    // A list without headings: its options straight in the listbox.
    const flat = draw({ groups: undefined, options: [option("a"), option("b")] });
    assert.deepEqual(nodesIn(flat.slot("command-list")).filter(node => node.props?.["data-slot"] === "command-group"), []);
    assert.deepEqual(flat.items.map(item => item.props["data-value"]), ["a", "b"]);
});

test("the list opens on the value; Down and Up pass what cannot be chosen; Enter chooses and closes", async () => {
    const { draw, chosen } = await combobox();
    open(draw());
    let drawn = draw();
    assert.deepEqual([drawn.tree.props.open, drawn.active], [true, "Groq_API"]);
    const down = key("ArrowDown");
    drawn.slot("command-input").props.onKeyDown(down);
    drawn = draw();
    assert.deepEqual([down.prevented, drawn.active], [true, "CTranslate2"], "from the last that can be chosen back to the first");
    drawn.slot("command-input").props.onKeyDown(key("ArrowDown"));
    drawn = draw();
    drawn.slot("command-input").props.onKeyDown(key("ArrowDown"));
    drawn = draw();
    assert.equal(drawn.active, "OpenAI_API", "Papago cannot be chosen and is passed");
    drawn.slot("command-input").props.onKeyDown(key("ArrowUp"));
    drawn = draw();
    assert.equal(drawn.active, "DeepL_API");
    const enter = key("Enter");
    drawn.slot("command-input").props.onKeyDown(enter);
    drawn = draw();
    assert.deepEqual([enter.prevented, chosen, drawn.tree.props.open], [true, ["DeepL_API"], false]);
    // Opened again on the value, which the owner has now changed.
    open(draw({ value: "DeepL_API" }));
    drawn = draw();
    assert.equal(drawn.active, "DeepL_API");
    // The value itself is not sent again; the list still closes.
    drawn.slot("command-input").props.onKeyDown(key("Enter"));
    assert.deepEqual([chosen, draw().tree.props.open], [["DeepL_API"], false]);
    // Other keys are the field's own.
    open(draw());
    const letter = key("a");
    draw().slot("command-input").props.onKeyDown(letter);
    assert.equal(letter.prevented, false);
});

test("typing keeps what it finds and starts on the first of it; a search that keeps nothing says so", async () => {
    const { draw, chosen } = await combobox();
    open(draw());
    draw().slot("command-input").props.onChange({ target: { value: "open" } });
    let drawn = draw();
    assert.equal(drawn.slot("command-input").props.value, "open");
    assert.deepEqual(drawn.items.map(item => item.props["data-value"]), ["OpenAI_API", "OpenAI_Compatible"]);
    assert.deepEqual(nodesIn(drawn.slot("command-list")).filter(node => node.props?.["data-slot"] === "command-group-heading")
        .map(node => node.props.children), ["API (cloud or your own server)"], "the group with nothing found has gone");
    assert.equal(drawn.active, "OpenAI_API");
    assert.equal(drawn.slot("command-empty").props.children, null, "nothing to say while something is found");
    drawn.slot("command-input").props.onKeyDown(key("ArrowDown"));
    assert.equal(draw().active, "OpenAI_API", "the other one found cannot be chosen");
    // Nothing found: no active choice, Enter does nothing, and the status says so.
    draw().slot("command-input").props.onChange({ target: { value: "whisper" } });
    drawn = draw();
    assert.deepEqual([drawn.items, drawn.slot("command-input").props["aria-activedescendant"]], [[], undefined]);
    assert.deepEqual([drawn.slot("command-empty").props.role, drawn.slot("command-empty").props.children], ["status", "No matching engines"]);
    drawn.slot("command-input").props.onKeyDown(key("Enter"));
    assert.deepEqual([chosen, draw().tree.props.open], [[], true]);
    // The search emptied: back on the value.
    draw().slot("command-input").props.onChange({ target: { value: "" } });
    assert.equal(draw().active, "Groq_API");
    // Closing forgets the search.
    draw().slot("command-input").props.onChange({ target: { value: "deep" } });
    draw().tree.props.onOpenChange(false);
    open(draw());
    drawn = draw();
    assert.deepEqual([drawn.slot("command-input").props.value, drawn.items.length, drawn.active], ["", 6, "Groq_API"]);
});

test("keys that compose text are the IME's, Escape and Enter included", async () => {
    const { draw, chosen } = await combobox();
    open(draw());
    for (const name of ["ArrowDown", "Enter"]) {
        const composing = key(name, true);
        draw().slot("command-input").props.onKeyDown(composing);
        assert.equal(composing.prevented, false, name);
    }
    assert.deepEqual([chosen, draw().active], [[], "Groq_API"]);
    // Radix closes the panel on Escape unless told not to: not while the IME composes.
    const pressEscape = (isComposing: boolean) => {
        const event = { isComposing, prevented: false, preventDefault: () => { event.prevented = true; } };
        draw().slot("combobox-content").props.onEscapeKeyDown(event);
        return event.prevented;
    };
    assert.deepEqual([pressEscape(true), pressEscape(false)], [true, false]);
});

test("Down or Up on the button opens the list; the focus goes to the search field without scrolling", async () => {
    const { draw } = await combobox();
    const down = key("ArrowDown");
    draw().slot("combobox-trigger").props.onKeyDown(down);
    assert.deepEqual([down.prevented, draw().tree.props.open], [true, true]);
    draw().tree.props.onOpenChange(false);
    draw().slot("combobox-trigger").props.onKeyDown(key("ArrowUp"));
    assert.equal(draw().tree.props.open, true);
    // Enter and Space are the button's own: Radix opens it on the press.
    const enter = key("Enter");
    draw().slot("combobox-trigger").props.onKeyDown(enter);
    assert.equal(enter.prevented, false);
    // Radix's opening focus is replaced by the search field's.
    const focused: unknown[] = [];
    const drawn = draw();
    setRef(drawn.slot("command-input"), { focus: (options: unknown) => { focused.push(options); } });
    const opening = { prevented: false, preventDefault: () => { opening.prevented = true; } };
    drawn.slot("combobox-content").props.onOpenAutoFocus(opening);
    assert.deepEqual([opening.prevented, focused], [true, [{ preventScroll: true }]]);
});

test("the pointer moves the active choice and chooses; a choice that cannot be chosen takes neither", async () => {
    const { draw, chosen } = await combobox();
    open(draw());
    const item = (value: string) => draw().items.find(node => node.props["data-value"] === value) ?? assert.fail(value);
    const down = { prevented: false, preventDefault: () => { down.prevented = true; } };
    item("OpenAI_API").props.onMouseDown(down);
    assert.equal(down.prevented, true, "the focus stays in the search field");
    item("Papago_API").props.onPointerMove();
    assert.equal(draw().active, "Groq_API");
    item("Papago_API").props.onClick();
    assert.deepEqual([chosen, draw().tree.props.open], [[], true]);
    item("OpenAI_API").props.onPointerMove();
    assert.equal(draw().active, "OpenAI_API");
    item("OpenAI_API").props.onClick();
    assert.deepEqual([chosen, draw().tree.props.open], [["OpenAI_API"], false]);
});

test("while the value waits the button keeps its place and the focus, does not open, and a choice waits", async () => {
    const { draw, chosen } = await combobox({ busy: true });
    const trigger = draw().slot("combobox-trigger");
    assert.deepEqual([trigger.props["aria-busy"], trigger.props["aria-disabled"], trigger.props.disabled], [true, true, false]);
    const press = { prevented: false, preventDefault: () => { press.prevented = true; } };
    trigger.props.onClick(press);
    assert.equal(press.prevented, true, "Radix does not open it");
    open(draw());
    draw().slot("combobox-trigger").props.onKeyDown(key("ArrowDown"));
    assert.equal(draw().tree.props.open, false);
    // Opened before the wait began: a choice waits and the list stays open.
    const { draw: drawOpen, chosen: chosenOpen } = await combobox();
    open(drawOpen());
    drawOpen({ busy: true }).slot("command-input").props.onKeyDown(key("Enter"));
    assert.deepEqual([chosenOpen, drawOpen().tree.props.open, drawOpen().slot("command-list").props["aria-busy"]], [[], true, true]);
    assert.deepEqual(chosen, []);
    // Not usable at all: the system's disabled button, which does not open.
    const { draw: drawOff } = await combobox({ disabled: true });
    assert.equal(drawOff().slot("combobox-trigger").props.disabled, true);
    open(drawOff());
    assert.equal(drawOff().tree.props.open, false);
});

test("the list scrolls to show the active choice, a group's first with its heading, once the panel is on the page", async () => {
    const { draw } = await combobox();
    open(draw());
    // The list as the page lays it out: rows 40px high, the list 100px tall and not scrolled.
    const group = { offsetTop: 60, querySelector: () => first };
    const first = { offsetTop: 90, offsetHeight: 40, parentElement: group };
    const later = { offsetTop: 210, offsetHeight: 40, parentElement: group };
    let row: unknown = later;
    const list = { scrollTop: 0, clientHeight: 100, querySelector: (selector: string) => {
        assert.equal(selector, "[data-slot='command-item'][aria-selected='true']");
        return row;
    } };
    Reflect.set(group, "parentElement", list);
    setRef(draw().slot("command-list"), list);
    draw();
    assert.equal(list.scrollTop, 150, "down to the row's bottom edge");
    row = first;
    draw().slot("command-input").props.onKeyDown(key("ArrowDown"));
    draw();
    assert.equal(list.scrollTop, 60, "up to the group's heading");
});
