import assert from "node:assert/strict";
import { test } from "vitest";
import { eventTarget, hooks, loadModule, setRef, stubGlobals, treeNode, unchecked } from "../../../logics/test/hookHarness.ts";
import { relayoutFromAbove } from "./relayoutFromAbove.ts";

// The frame that holds the page: what is done to it, in order.
const frame = (calls: string[]) => ({
    style: {
        setProperty: (name: string, value: string) => { calls.push(`set ${name} ${value}`); },
        removeProperty: (name: string) => { calls.push(`remove ${name}`); return ""; },
    },
    getBoundingClientRect: () => { calls.push("layout"); return {}; },
});
const RELAYOUT = ["set padding-top 1px", "layout", "remove padding-top"];

// WebKitGTK sometimes left the settings page with its first layout; a change of the frame above it,
// laid out, lays the page out again. Undone at once, nothing painted moves.
test("the frame above the page gets a change of layout, laid out and undone at once", () => {
    const calls: string[] = [];
    relayoutFromAbove(unchecked<HTMLElement>({ parentElement: frame(calls) }));
    assert.deepEqual(calls, RELAYOUT);
    // Without the page, or a frame above it, nothing is done.
    relayoutFromAbove(null);
    relayoutFromAbove(undefined);
    relayoutFromAbove(unchecked<HTMLElement>({ parentElement: null }));
    assert.deepEqual(calls, RELAYOUT);
});

test("the settings page is laid out again from its frame each time it opens, not as it closes", async context => {
    const calls: string[] = [], focused: string[] = [];
    stubGlobals(context, { window: eventTarget(), document: { querySelector: () => null } });
    const runtime = hooks();
    const opened = { data: false }, narrow = { data: false };
    const { ConfigPage } = await loadModule<typeof import("./ConfigPage.tsx")>(new URL("./ConfigPage.tsx", import.meta.url), runtime, {
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: opened }) },
        "@logics_configs": { useOcr: () => ({ getOcrCaptureStatus() {} }) },
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: narrow }) },
        "./topbar/Topbar": { Topbar: () => null },
        "./sidebar_section/SidebarSection": { SidebarSection: () => null },
        "./setting_section/SettingSection": { SettingSection: () => null },
        "./search_bar/SearchBar": { SearchBar: () => null },
        "./relayoutFromAbove.ts": { relayoutFromAbove },
    });
    // The page's tab in use takes the focus after the page is laid out again.
    const tab = { focus: () => { focused.push(`focus after ${calls.length}`); } };
    const page = { parentElement: frame(calls), querySelector: () => tab };
    const render = () => runtime.render(ConfigPage, undefined, tree => {
        const node = treeNode(tree);
        if (node) setRef(node, page);
    });
    render();
    assert.deepEqual(calls, [], "closed at the start");
    opened.data = true;
    render();
    assert.deepEqual(calls, RELAYOUT);
    assert.deepEqual(focused, ["focus after 3"]);
    opened.data = false;
    render();
    assert.deepEqual(calls, RELAYOUT, "closing changes nothing");
    opened.data = true;
    render();
    assert.deepEqual(calls, [...RELAYOUT, ...RELAYOUT]);
    // The menu turning to icons while the page is open (the settings window shows it from its first
    // frame, #1236): laid out again, and the focus stays where it is. Closed, nothing.
    narrow.data = true;
    render();
    assert.deepEqual(calls, [...RELAYOUT, ...RELAYOUT, ...RELAYOUT]);
    assert.equal(focused.length, 2);
    opened.data = false;
    render();
    narrow.data = false;
    render();
    assert.deepEqual(calls, [...RELAYOUT, ...RELAYOUT, ...RELAYOUT], "closed: nothing");
});
