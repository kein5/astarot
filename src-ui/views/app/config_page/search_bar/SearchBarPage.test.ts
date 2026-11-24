import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, eventTarget, find, findIn, hooks, loadModule, nodesIn, setRef, stubGlobals, treeNode } from "../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../logics/test/hookHarness.ts";
import type { ConfigSearchEntry } from "../../../../logics/configs/config_page_setter/_aux/useConfigSearch.ts";

// The settings search's field and its list of results (SearchBar.tsx): what the field says, how the
// keys and the pointer move in the list and choose, what a result shows with the words that match
// marked, and what closes the list. The search hook is a stand-in that holds the query and the results
// the test gives and records what the bar asks of it; the document is a stand-in whose listeners the
// test calls, and the root, the field and the list are given boxes as the page would have them.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
const entry = (setting_id: string, label: string, more: Partial<ConfigSearchEntry> = {}): ConfigSearchEntry =>
    ({ setting_id, tab: "device", label, desc: "", tab_label: "Device", searchTarget: [label], prereq: null, ...more });
const oscPort = entry("osc_port", "OSC port", { tab: "advanced_settings", tab_label: "Advanced", desc: "Where OSC messages go" });
const oscIp = entry("osc_ip", "OSC address", { tab: "advanced_settings", tab_label: "Advanced" });
const micOsc = entry("mic_osc", "Microphone", { desc: "Sends what you say over osc" });

// The bars a test drew, taken off the page together when it ends, before the stand-in document goes.
const barsByTest = new WeakMap<TestContext, HookRuntime[]>();
function closeWithTest(context: TestContext, runtime: HookRuntime) {
    const bars = barsByTest.get(context);
    if (bars) { bars.push(runtime); return; }
    const drawn = [runtime];
    barsByTest.set(context, drawn);
    context.onTestFinished(() => { for (const bar of drawn) bar.unmount(); });
}

async function searchBar(context: TestContext, given: { query?: string; results?: ConfigSearchEntry[]; small?: boolean } = {}) {
    const runtime = hooks(), chosen: unknown[][] = [], calls: unknown[][] = [], scrolled: unknown[][] = [];
    closeWithTest(context, runtime);
    const doc = eventTarget();
    stubGlobals(context, { document: doc });
    // What the search hook holds; the bar is told of a new query or list when it draws again.
    const search = { query: given.query ?? "OSC", results: given.results ?? [oscPort, oscIp, micOsc],
        navigate: (item: unknown) => { chosen.push(["first", item]); } };
    const module = await loadModule<typeof import("./SearchBar.tsx")>(new URL("./SearchBar.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: given.small ?? false } }) },
        "@logics_configs": { useConfigSearch: () => ({ query: search.query, results: search.results, navigateToSetting: search.navigate,
            setQuery: (value: string) => { calls.push(["setQuery", value]); },
            clearQuery: () => { calls.push(["clearQuery"]); } }) },
        "../sidebar_section/SidebarSection": { TabIcon: "tab-icon" },
        "@common_components": { Empty: "empty", EmptyDescription: "empty-description" },
    });
    const root = { contains: (target: unknown) => target === "inside" };
    const field = { focus: () => { calls.push(["focus"]); } };
    // The list's rows as the page has them; a test may hold fewer than the results it was drawn from.
    let rows = 3;
    const draw = (): TreeNode => {
        const tree = treeNode(runtime.render(module.SearchBar, {}, drawn => {
            const node = treeNode(drawn);
            assert.ok(node);
            setRef(node, root);
            setRef(findIn(node, item => item.type === "input"), field);
            const list = find(node, item => item.props?.id !== undefined && item.type === "div");
            if (list) setRef(list, { children: Array.from({ length: rows }, (_, index) => ({ scrollIntoView: (options: unknown) => { scrolled.push([index, options]); } })) });
        }));
        assert.ok(tree);
        return tree;
    };
    const input = (tree: TreeNode = draw()) => findIn(tree, node => node.type === "input");
    const list = (tree: TreeNode = draw()) => find(tree, node => node.type === "div" && node.props.id !== undefined);
    const options = (tree: TreeNode = draw()) => nodesIn(tree).filter(node => node.props?.role === "option");
    const focus = () => { input().props.onFocus(); };
    // A key on the field, with what it asked of the event.
    const press = (key: string, more: Record<string, unknown> = {}) => {
        const asked: string[] = [];
        input().props.onKeyDown({ key, preventDefault: () => { asked.push("preventDefault"); }, stopPropagation: () => { asked.push("stopPropagation"); }, ...more });
        return asked;
    };
    const active = () => input().props["aria-activedescendant"];
    const setRows = (count: number) => { rows = count; };
    return { search, chosen, calls, scrolled, doc, draw, input, list, options, focus, press, active, setRows, unmount: () => runtime.unmount() };
}

// The words a part of the tree shows, with the marked parts in brackets.
const shown = (value: unknown): string => {
    if (value === null || value === undefined || typeof value === "boolean") return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(shown).join("");
    const node = treeNode(value);
    if (!node) return "";
    if (typeof node.type === "function") return shown(componentOf(node)(node.props));
    const inner = shown(node.props.children);
    return node.props.className === "match_highlight" ? `[${inner}]` : inner;
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);

test("the field is a combobox named by its words; until it has the focus and more than spaces, no list shows", async context => {
    const s = await searchBar(context);
    let field = s.input();
    assert.deepEqual([field.props.type, field.props.role, field.props["aria-label"], field.props["aria-autocomplete"], field.props.placeholder, field.props.value],
        ["text", "combobox", "config_page.search.label", "list", "config_page.search.placeholder", "OSC"]);
    assert.deepEqual([field.props["aria-expanded"], field.props["aria-controls"], field.props["aria-activedescendant"], s.list()], [false, undefined, undefined, null],
        "a query alone does not open the list");
    s.focus();
    field = s.input();
    assert.deepEqual([field.props["aria-expanded"], field.props["aria-controls"]], [true, s.list()?.props.id]);
    s.search.query = "   ";
    assert.deepEqual([s.input().props["aria-expanded"], s.list()], [false, null], "spaces alone");
    // Typing asks for the new query and opens the list even before a focus event.
    const other = await searchBar(context);
    other.input().props.onChange({ target: { value: "port" } });
    assert.deepEqual(other.calls, [["setQuery", "port"]]);
    assert.equal(other.input().props["aria-expanded"], true);
    // The root is narrower on a small window.
    const draw = async (small: boolean) => classesOf((await searchBar(context, { small })).draw());
    assert.deepEqual([(await draw(true)).includes("is_small"), (await draw(false)).includes("is_small")], [true, false]);
    assert.ok((await draw(false)).includes("search_wrapper"));
});

test("open, the list shows each result with its page, its words with the query marked, and what it needs first", async context => {
    const prereq = entry("osc_port", "OSC port", { prereq: { parent_id: "osc", required_label: "OSC" } });
    const s = await searchBar(context, { query: " osc ", results: [oscPort, prereq, micOsc] });
    s.focus();
    const tree = s.draw();
    const listbox = s.list(tree);
    assert.ok(listbox);
    assert.deepEqual([listbox.props.role, listbox.props["aria-label"], classesOf(listbox)], ["listbox", "config_page.search.results", ["dropdown_results"]]);
    const options = s.options(tree);
    assert.deepEqual(options.map(option => [option.key, option.props.id, option.props["aria-selected"], classesOf(option)]), [
        [`.$advanced_settings_osc_port_0`, `${listbox.props.id}-0`, false, ["result_item"]],
        [`.$device_osc_port_1`, `${listbox.props.id}-1`, false, ["result_item"]],
        [`.$device_mic_osc_2`, `${listbox.props.id}-2`, false, ["result_item"]]]);
    assert.deepEqual(options.map(shown), [
        "Advanced[OSC] portWhere [OSC] messages go",
        `Device[OSC] portconfig_page.search.requires {"name":"OSC"}`,
        "DeviceMicrophoneSends what you say over [osc]"]);
    const icon = findIn(options[0], node => node.type === "tab-icon");
    assert.deepEqual([icon.props.tab_id, icon.props.className], ["advanced_settings", "badge_tab_icon"]);
    assert.ok(find(options[1], node => classesOf(node).includes("prereq_badge")));
    assert.equal(find(options[0], node => classesOf(node).includes("prereq_badge")), null);
    assert.equal(find(options[1], node => classesOf(node).includes("item_desc")), null, "no description, no line for it");
    // A label that does not hold the query stays plain words.
    const label = findIn(options[2], node => classesOf(node).includes("item_label"));
    const text = findIn(label, node => typeof node.type === "function");
    assert.equal(componentOf(text)(text.props), "Microphone");
    assert.equal(componentName(text), "HighlightText");
});

test("the query is marked whatever its case, and taken as plain words even when it holds a pattern's signs", async context => {
    const marked = async (query: string, label: string) => {
        const s = await searchBar(context, { query, results: [entry("a", label)] });
        s.focus();
        return shown(findIn(s.options()[0], node => classesOf(node).includes("item_label")));
    };
    assert.equal(await marked("Port", "OSC port and PORT"), "OSC [port] and [PORT]");
    assert.equal(await marked("(osc", "Port (OSC)"), "Port [(OSC])");
    assert.equal(await marked("a.b", "axb a.b"), "axb [a.b]");
    assert.equal(await marked("c+", "c++ cc"), "[c+]+ cc");
    assert.equal(await marked("x", ""), "", "an empty label shows nothing");
});

test("with nothing found the list says so, and nothing is chosen or highlighted", async context => {
    const s = await searchBar(context, { results: [] });
    s.focus();
    const tree = s.draw();
    const status = s.list(tree);
    assert.ok(status);
    assert.deepEqual([status.props.role, status.props["aria-label"], shown(status)], ["status", undefined, "config_page.search.no_results"]);
    assert.ok(findIn(status, node => node.type === "empty-description"));
    assert.deepEqual([s.input(tree).props["aria-expanded"], s.input(tree).props["aria-controls"]], [false, undefined]);
    s.press("ArrowDown");
    s.press("Enter");
    assert.deepEqual([s.active(), s.chosen], [undefined, []]);
});

test("the arrows move through the results and wrap at the ends, scrolling the highlighted one into view", async context => {
    const s = await searchBar(context);
    s.focus();
    const listId = s.list()?.props.id;
    const highlighted = () => s.options().map(option => [option.props["aria-selected"], classesOf(option).includes("is_active")]);
    assert.deepEqual(s.press("ArrowDown"), ["preventDefault"]);
    assert.equal(s.active(), `${listId}-0`);
    assert.deepEqual(highlighted(), [[true, true], [false, false], [false, false]]);
    s.press("ArrowDown");
    s.press("ArrowDown");
    assert.equal(s.active(), `${listId}-2`);
    s.press("ArrowDown");
    assert.equal(s.active(), `${listId}-0`, "past the last, back to the first");
    assert.deepEqual(s.press("ArrowUp"), ["preventDefault"]);
    assert.equal(s.active(), `${listId}-2`, "before the first, the last");
    s.press("ArrowUp");
    assert.equal(s.active(), `${listId}-1`);
    assert.deepEqual(s.scrolled, [[0, { block: "nearest" }], [1, { block: "nearest" }], [2, { block: "nearest" }], [0, { block: "nearest" }], [2, { block: "nearest" }],
        [1, { block: "nearest" }]]);
    // From nothing highlighted, up goes to the last.
    const up = await searchBar(context);
    up.focus();
    up.press("ArrowUp");
    assert.equal(up.active(), `${up.list()?.props.id}-2`);
    // The pointer highlights what it is over.
    up.options()[0].props.onMouseEnter();
    assert.equal(up.active(), `${up.list()?.props.id}-0`);
    // Other keys leave it as it is.
    assert.deepEqual(up.press("a"), []);
    assert.deepEqual([up.active(), up.input().props["aria-expanded"]], [`${up.list()?.props.id}-0`, true]);
});

test("a new query starts with nothing highlighted, and a highlighted result gone from the list names none", async context => {
    const s = await searchBar(context);
    s.focus();
    s.press("ArrowDown");
    s.press("ArrowDown");
    s.search.query = "OSC p";
    s.draw();
    assert.equal(s.active(), undefined);
    assert.deepEqual(s.options().map(option => option.props["aria-selected"]), [false, false, false]);
    // The same query with a shorter list (the words changed with the UI language): the second is gone.
    s.press("ArrowDown");
    s.press("ArrowDown");
    s.search.results = [oscPort];
    s.setRows(1);
    assert.equal(s.active(), undefined);
    assert.deepEqual(s.press("Enter"), ["preventDefault"]);
    assert.deepEqual(s.chosen, [["first", oscPort]], "Enter takes the first instead");
    // A row the list does not hold yet is not scrolled to.
    const short = await searchBar(context);
    short.focus();
    short.setRows(0);
    short.press("ArrowDown");
    short.draw();
    assert.deepEqual(short.scrolled, []);
});

test("Enter chooses the highlighted result, or the first, closes the list and leads to it with the hook's newest way", async context => {
    const s = await searchBar(context);
    s.focus();
    s.press("ArrowDown");
    s.press("ArrowDown");
    // The hook hands over a new way to lead there; the bar uses the one it has now.
    s.search.navigate = item => { s.chosen.push(["second", item]); };
    assert.deepEqual(s.press("Enter"), ["preventDefault"]);
    assert.deepEqual(s.chosen, [["second", oscIp]]);
    assert.deepEqual([s.input().props["aria-expanded"], s.list()], [false, null], "closed after choosing");
    const first = await searchBar(context);
    first.focus();
    first.press("Enter");
    assert.deepEqual(first.chosen, [["first", oscPort]]);
    // While the IME is composing, Enter belongs to it.
    const composing = await searchBar(context);
    composing.focus();
    assert.deepEqual(composing.press("Enter", { nativeEvent: { isComposing: true } }), []);
    assert.deepEqual(composing.press("Enter", { keyCode: 229 }), []);
    assert.deepEqual([composing.chosen, composing.input().props["aria-expanded"]], [[], true]);
    // Closed, the keys do nothing.
    const closed = await searchBar(context);
    assert.deepEqual([closed.press("Enter"), closed.press("ArrowDown"), closed.chosen], [[], [], []]);
    closed.focus();
    assert.equal(closed.active(), undefined, "nothing was highlighted while it was closed");
});

test("a press on a result chooses it without taking the focus from the field", async context => {
    const s = await searchBar(context);
    s.focus();
    const asked: string[] = [];
    s.options()[2].props.onMouseDown({ preventDefault: () => { asked.push("preventDefault"); } });
    assert.deepEqual([asked, s.chosen], [["preventDefault"], [["first", micOsc]]]);
    assert.equal(s.list(), null);
});

test("Escape, a press outside or the focus leaving closes the list; the clear button empties the query and keeps the focus", async context => {
    const s = await searchBar(context);
    s.focus();
    s.press("ArrowDown");
    assert.deepEqual(s.press("Escape"), ["preventDefault", "stopPropagation"]);
    assert.equal(s.list(), null);
    assert.deepEqual([s.active(), s.input().props["aria-controls"]], [undefined, undefined], "closed, it names no result");
    s.focus();
    assert.deepEqual(s.doc.added.map(([type]) => type), ["mousedown"], "one listener for the whole time it is drawn");
    s.doc.dispatch("mousedown", { target: "inside" });
    assert.ok(s.list());
    s.doc.dispatch("mousedown", { target: "outside" });
    assert.equal(s.list(), null);
    s.focus();
    const root = s.draw();
    root.props.onBlur({ currentTarget: { contains: (target: unknown) => target === "inside" }, relatedTarget: "inside" });
    assert.ok(s.list(), "the focus moved within it");
    root.props.onBlur({ currentTarget: { contains: (target: unknown) => target === "inside" }, relatedTarget: null });
    assert.equal(s.list(), null);
    // The clear button is there only with a query, out of the tab order.
    s.focus();
    const clear = findIn(s.draw(), node => node.type === "button");
    assert.deepEqual([clear.props.type, clear.props.tabIndex, clear.props["aria-label"], classesOf(clear)], ["button", -1, "config_page.search.clear", ["clear_button"]]);
    clear.props.onClick();
    assert.deepEqual(s.calls, [["clearQuery"], ["focus"]]);
    s.search.query = "";
    assert.equal(find(s.draw(), node => node.type === "button"), null);
    assert.deepEqual([s.doc.added.length, s.doc.removed], [1, []], "still the one listener");
    // Gone from the page, it stops listening.
    s.unmount();
    assert.deepEqual(s.doc.removed.map(([type]) => type), ["mousedown"]);
});
