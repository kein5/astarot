import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { stubGlobals } from "../test/hookHarness.ts";
import { revealSetting } from "./revealSetting.ts";

// revealSetting.ts on a small page of the test's own. The elements answer the selectors the code
// uses as a browser would: a tag, [attribute], [attribute='value'], :disabled and
// :not([type='hidden']), in lists separated by commas. An empty selector throws, as it does in a
// browser.

type Attributes = Record<string, string>;
const simpleMatches = (element: Page, simple: string): boolean => {
    let rest = simple.trim();
    if (!rest) throw new SyntaxError("The selector is empty.");
    const tag = rest.match(/^[a-z]+/)?.[0];
    if (tag) {
        if (element.tagName !== tag.toUpperCase()) return false;
        rest = rest.slice(tag.length);
    }
    while (rest) {
        const not = rest.match(/^:not\((.+?\])\)/);
        if (not) {
            if (simpleMatches(element, not[1])) return false;
            rest = rest.slice(not[0].length);
            continue;
        }
        if (rest.startsWith(":disabled")) {
            if (!["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(element.tagName) || !element.attributes.has("disabled")) return false;
            rest = rest.slice(":disabled".length);
            continue;
        }
        const attribute = rest.match(/^\[([a-z-]+)(?:=(['"])(.*?)\2)?\]/);
        if (!attribute) throw new SyntaxError(`The test's page does not read ${rest}`);
        const value = element.attributes.get(attribute[1]);
        if (value === undefined || (attribute[3] !== undefined && value !== attribute[3])) return false;
        rest = rest.slice(attribute[0].length);
    }
    return true;
};
const selectorMatches = (element: Page, selector: string) => {
    if (!selector.trim()) throw new SyntaxError("The selector is empty.");
    return selector.split(",").some(simple => simpleMatches(element, simple));
};

// What the page saw: focus moves, scrolls and the setting's mark, in order.
type Event = [string, ...unknown[]];

class Page {
    readonly tagName: string;
    readonly attributes: Map<string, string>;
    readonly children: Page[];
    parentElement: Page | null = null;
    open?: boolean;
    readonly listeners: [string, () => void, unknown][] = [];
    readonly log: Event[];
    readonly rects: number;
    constructor(log: Event[], tag: string, attributes: Attributes = {}, children: Page[] = [], rects = 1) {
        this.log = log;
        this.rects = rects;
        this.tagName = tag.toUpperCase();
        this.attributes = new Map(Object.entries(attributes));
        this.children = children;
        for (const child of children) child.parentElement = this;
        if (this.tagName === "DETAILS") this.open = false;
    }
    get name() { return this.attributes.get("name") ?? this.tagName.toLowerCase(); }
    matches(selector: string) { return selectorMatches(this, selector); }
    closest(selector: string): Page | null {
        for (let node: Page | null = this; node; node = node.parentElement) if (node.matches(selector)) return node;
        return null;
    }
    descendants(): Page[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector: string) { return this.descendants().filter(node => node.matches(selector)); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    getClientRects() { return Array.from({ length: this.rects }, () => ({})); }
    addEventListener(type: string, listener: () => void, options: unknown) { this.listeners.push([type, listener, options]); }
    dispatch(type: string) { for (const [name, listener] of this.listeners.splice(0)) if (name === type) listener(); }
    focus(options: unknown) { this.log.push(["focus", this.name, options]); }
    scrollIntoView(options: unknown) { this.log.push(["scroll", this.name, options]); }
    get offsetWidth() { this.log.push(["layout", this.name]); return 100; }
    readonly classList = { add: (name: string) => { this.log.push(["mark", this.name, name]); },
        remove: (name: string) => { this.log.push(["unmark", this.name, name]); } };
}

// A page with the given rows; the document finds what is in it.
function page(context: TestContext, rows: (log: Event[], el: (tag: string, attributes?: Attributes, children?: Page[], rects?: number) => Page) => Page[], reducedMotion = false) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log: Event[] = [];
    const el = (tag: string, attributes: Attributes = {}, children: Page[] = [], rects = 1) => new Page(log, tag, attributes, children, rects);
    const root = el("main", {}, rows(log, el));
    const lookups: string[] = [];
    stubGlobals(context, {
        document: { querySelector: (selector: string) => { lookups.push(selector); return root.querySelector(selector); } },
        window: { matchMedia: (query: string) => ({ matches: reducedMotion && query === "(prefers-reduced-motion: reduce)" }) },
        CSS: { escape: (value: string) => value.replaceAll('"', '\\"') },
    });
    const find = (name: string) => root.descendants().find(node => node.name === name);
    return { log, lookups, root, find, el };
}

test("a setting is found by its id, else by its row's label, else by the setting it is shown under", async context => {
    const p = page(context, (_, el) => [
        el("div", { name: "by-id", "data-setting-id": "osc" }),
        el("div", { name: "by-label", "data-setting-label": "Port" }),
        el("div", { name: "parent", "data-setting-id": "parent" }),
    ]);
    const scrolled = () => p.log.filter(([kind]) => kind === "scroll").map(([, name]) => name);
    revealSetting({ setting_id: "osc", label: "Port", prereq: { parent_id: "parent" } });
    vi.advanceTimersByTime(60);
    revealSetting({ setting_id: "missing", label: "Port", prereq: { parent_id: "parent" } });
    vi.advanceTimersByTime(60);
    revealSetting({ setting_id: "missing", label: "Missing", prereq: { parent_id: "parent" } });
    vi.advanceTimersByTime(60);
    revealSetting({ setting_id: "missing", prereq: null });
    vi.advanceTimersByTime(2000);
    assert.deepEqual(scrolled(), ["by-id", "by-label", "parent"]);
});

test("the closed folds around the setting open, and nothing else is opened", async context => {
    const p = page(context, (_, el) => [el("details", { name: "outer" }, [el("div", { name: "between" }, [el("details", { name: "inner" }, [
        el("div", { name: "row", "data-setting-id": "deep" }, [el("input", { name: "field" })])])])])]);
    revealSetting({ setting_id: "deep" });
    vi.advanceTimersByTime(60);
    assert.deepEqual([p.find("outer")?.open, p.find("inner")?.open, p.find("between")?.open], [true, true, undefined]);
});

test("the setting's first usable field takes the focus, without scrolling the page for it", async context => {
    const usable = (bad: (el: (tag: string, attributes?: Attributes, children?: Page[], rects?: number) => Page) => Page) => {
        const p = page(context, (_, el) => [el("div", { name: "row", "data-setting-id": "s" }, [
            el("button", { name: "help" }), bad(el), el("select", { name: "good" })])]);
        revealSetting({ setting_id: "s" });
        vi.advanceTimersByTime(60);
        return p.log.filter(([kind]) => kind === "focus");
    };
    const focused = [["focus", "good", { preventScroll: true }]];
    assert.deepEqual(usable(el => el("input", { name: "bad", disabled: "" })), focused, "disabled");
    assert.deepEqual(usable(el => el("input", { name: "bad", "aria-disabled": "true" })), focused, "aria-disabled");
    assert.deepEqual(usable(el => el("input", { name: "bad", tabindex: "-1" })), focused, "out of the tab order");
    assert.deepEqual(usable(el => el("div", { hidden: "" }, [el("input", { name: "bad" })])), focused, "hidden");
    assert.deepEqual(usable(el => el("div", { inert: "" }, [el("input", { name: "bad" })])), focused, "inert");
    assert.deepEqual(usable(el => el("input", { name: "bad" }, [], 0)), focused, "not drawn");
    assert.deepEqual(usable(el => el("input", { name: "bad", type: "hidden" })), focused, "a hidden input");
    assert.deepEqual(usable(el => el("div", { name: "bad", role: "switch", tabindex: "0" })), [["focus", "bad", { preventScroll: true }]], "a switch is a field");
});

test("a setting with only a button gives the button the focus", async context => {
    const p = page(context, (_, el) => [el("div", { name: "row", "data-setting-id": "s" }, [el("span"), el("a", { name: "link", href: "#" })])]);
    revealSetting({ setting_id: "s" });
    vi.advanceTimersByTime(60);
    assert.deepEqual(p.log.filter(([kind]) => kind === "focus"), [["focus", "link", { preventScroll: true }]]);
});

test("a row without a control takes the focus itself for a moment, and gets its own tab stop back", async context => {
    for (const previous of ["3", null]) {
        const p = page(context, (_, el) => [el("div", { name: "row", "data-setting-id": "s", ...(previous === null ? {} : { tabindex: previous }) },
            [el("button", { name: "off", disabled: "" })])]);
        revealSetting({ setting_id: "s" });
        vi.advanceTimersByTime(60);
        const row = p.find("row");
        assert.ok(row);
        assert.deepEqual(p.log.filter(([kind]) => kind === "focus"), [["focus", "row", { preventScroll: true }]]);
        assert.equal(row.getAttribute("tabindex"), "-1");
        assert.deepEqual(row.listeners.map(([type, , options]) => [type, options]), [["blur", { once: true }]]);
        row.dispatch("blur");
        assert.equal(row.getAttribute("tabindex"), previous, `tab stop ${String(previous)}`);
    }
});

test("the setting scrolls to the middle, smoothly unless motion is reduced, and is marked for 2.5 seconds", async context => {
    for (const reduced of [false, true]) {
        const p = page(context, (_, el) => [el("div", { name: "row", "data-setting-id": "s" }, [el("input", { name: "field" })])], reduced);
        revealSetting({ setting_id: "s" });
        vi.advanceTimersByTime(60);
        assert.deepEqual(p.log.filter(([kind]) => kind !== "focus"), [
            ["scroll", "row", { behavior: reduced ? "instant" : "smooth", block: "center" }],
            ["unmark", "row", "search_target_highlight"], ["layout", "row"], ["mark", "row", "search_target_highlight"],
        ]);
        p.log.length = 0;
        vi.advanceTimersByTime(2499);
        assert.deepEqual(p.log, []);
        vi.advanceTimersByTime(1);
        assert.deepEqual(p.log, [["unmark", "row", "search_target_highlight"]]);
    }
});

test("a setting not drawn yet is looked for again every 40 ms, 25 more times at most", async context => {
    const p = page(context, () => []);
    revealSetting({ setting_id: "late" });
    vi.advanceTimersByTime(59);
    assert.equal(p.lookups.length, 0);
    vi.advanceTimersByTime(1);
    assert.equal(p.lookups.length, 1);
    vi.advanceTimersByTime(40 * 10);
    assert.equal(p.lookups.length, 11);
    p.root.children.push(new Page(p.log, "div", { name: "late", "data-setting-id": "late" }));
    vi.advanceTimersByTime(40);
    assert.equal(p.lookups.length, 12);
    assert.deepEqual(p.log.find(([kind]) => kind === "scroll"), ["scroll", "late", { behavior: "smooth", block: "center" }]);
    const never = page(context, () => []);
    revealSetting({ setting_id: "never" });
    vi.advanceTimersByTime(60 + 40 * 30);
    assert.equal(never.lookups.length, 26);
});
