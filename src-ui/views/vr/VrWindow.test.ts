import assert from "node:assert/strict";
import { test } from "vitest";
import { find, findIn, hooks, loadModule, nodesIn, treeNode } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";

// The frame every VR window shares: its title bar, the close button, the lock while the settings
// page is open, and the corners that resize the log. Then which temporary window is open, and
// the inputs and outputs window inside its frame.

const t = (key: string) => key;

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);

async function frame({ configOpen = false, i18n = { language: "ja" } as { language?: string; resolvedLanguage?: string } } = {}) {
    const { VrWindow } = await loadModule<typeof import("./VrWindow.tsx")>(new URL("./VrWindow.tsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t, i18n }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: configOpen } }) },
    });
    return VrWindow;
}
const Icon = () => null;
// Stand-ins for the windows a frame holds and for the flow view.
const VrLanguageWindow = () => null, VrSettingsWindow = () => null, VrIoFlowWindow = () => null;
const IoFlowView = () => null, VrWindowStandIn = () => null;

test("a window's title bar shows its icon and title, and its close button closes it", async () => {
    const VrWindow = await frame();
    let closed = 0;
    const tree = VrWindow({ Icon, title: "Languages", onClose: () => { closed++; }, children: "the body" });
    const [bar, body]: TreeNode[] = tree.props.children;
    const icon = findIn(bar, node => node.type === Icon, "the icon");
    assert.equal(icon.props["aria-hidden"], "true");
    assert.equal(textOf(findIn(bar, node => node.type === "p")), "Languages");
    const close = findIn(bar, node => node.type === "button", "the close button");
    assert.equal(close.props["aria-label"], "common.close_button_label");
    assert.equal(findIn(close, node => typeof node.type === "function").props["aria-hidden"], "true");
    close.props.onClick();
    assert.equal(closed, 1);
    assert.equal(textOf(body), "the body");
    // A window that says what its close does names its button so.
    const settings = VrWindow({ Icon, title: "Settings", onClose() {}, close_label: "Close the settings" });
    assert.equal(findIn(settings, node => node.type === "button").props["aria-label"], "Close the settings");
});

test("a window is in the language of the UI, English when none is known", async () => {
    const lang = async (i18n: { language?: string; resolvedLanguage?: string }) => (await frame({ i18n }))({ Icon, title: "", onClose() {} }).props.lang;
    assert.deepEqual([await lang({ resolvedLanguage: "ja", language: "ja-JP" }), await lang({ language: "ko" }), await lang({})], ["ja", "ko", "en"]);
});

test("while the settings page is open, a window's body is covered by a note, but it can still be closed", async () => {
    const VrWindow = await frame({ configOpen: true });
    const tree = VrWindow({ Icon, title: "Languages", onClose() {}, children: "the body" });
    const [bar, body]: TreeNode[] = tree.props.children;
    assert.equal(textOf(body), "the bodyvr_panel.locked_by_config_page");
    assert.ok(find(bar, node => node.type === "button"));
    // The settings window is the settings page itself: it is never covered.
    const settings = VrWindow({ Icon, title: "Settings", onClose() {}, is_lockable: false, children: "the body" });
    assert.equal(textOf(settings.props.children[1]), "the body");
    // With the page closed, nothing covers the body.
    const closed = (await frame())({ Icon, title: "Languages", onClose() {}, children: "the body" });
    assert.equal(textOf(closed.props.children[1]), "the body");
});

test("the log, while it cannot be grabbed, says so in its title bar", async () => {
    const VrWindow = await frame();
    const locked = VrWindow({ Icon, title: "Log", onClose() {}, is_grab_locked: true });
    const mark = findIn(locked.props.children[0], node => node.type === "span", "the lock");
    assert.equal(textOf(mark), "vr_panel.locked");
    assert.equal(findIn(mark, node => node.type === "svg").props["aria-hidden"], "true");
    assert.equal(find(VrWindow({ Icon, title: "Log", onClose() {} }).props.children[0], node => node.type === "span"), null);
});

test("a resizable window has handles on three corners, not on the close button's, and none while locked", async () => {
    const VrWindow = await frame();
    const handles = (tree: TreeNode) => nodesIn(tree).filter(node => node.props["data-vr-hoverable"] === "" && node.type === "span");
    const log = VrWindow({ Icon, title: "Log", onClose() {}, is_resizable: true });
    assert.equal(log.props["data-vr-hoverable"], "", "the laser's hover shows the handles");
    const corners = handles(log);
    const drawn: TreeNode[] = log.props.children[2];
    assert.deepEqual(drawn.map(corner => corner.key), ["top_left", "bottom_left", "bottom_right"]);
    assert.deepEqual(corners.map(corner => classesOf(corner).slice(1)), [["top_left"], ["bottom_left"], ["bottom_right"]]);
    assert.ok(corners.every(corner => classesOf(corner).length === 2));
    const locked = VrWindow({ Icon, title: "Log", onClose() {}, is_resizable: true, is_grab_locked: true });
    assert.deepEqual(handles(locked), []);
    const fixed = VrWindow({ Icon, title: "Languages", onClose() {} });
    assert.deepEqual([handles(fixed), fixed.props["data-vr-hoverable"]], [[], undefined]);
});

test("one temporary window is open at a time: languages, settings, or inputs and outputs", async () => {
    const { VrPopupWindow } = await loadModule<typeof import("./VrPopupWindow.tsx")>(new URL("./VrPopupWindow.tsx", import.meta.url), hooks(), {
        "./VrLanguageWindow": { VrLanguageWindow }, "./VrSettingsWindow": { VrSettingsWindow }, "./VrIoFlowWindow": { VrIoFlowWindow },
    });
    const onClose = () => {};
    for (const [popup, window] of [["language", VrLanguageWindow], ["settings", VrSettingsWindow], ["io_flow", VrIoFlowWindow]] as const) {
        const tree = VrPopupWindow({ popup, onClose });
        assert.equal(tree?.type, window, popup);
        assert.equal(tree?.props.onClose, onClose);
    }
    assert.equal(VrPopupWindow({ popup: null, onClose }), null);
});

test("the inputs and outputs window draws the main window's flow view, compact, and is never covered", async () => {
    const flow = { voice: {} }, traces = [{ id: "v1" }];
    const { VrIoFlowWindow: VrIoFlow } = await loadModule<typeof import("./VrIoFlowWindow.tsx")>(new URL("./VrIoFlowWindow.tsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t }) },
        "../../logics/flow/useIoFlow": { useIoFlow: () => ({ currentIoFlow: { data: flow }, currentIoTraces: { data: traces } }) },
        "../app/io_flow/IoFlowView": { IoFlowView },
        "./VrWindow": { VrWindow: VrWindowStandIn },
    });
    const onClose = () => {};
    const tree = VrIoFlow({ onClose });
    assert.equal(tree.type, VrWindowStandIn);
    assert.deepEqual([tree.props.title, tree.props.onClose, tree.props.is_lockable], ["io_flow.vr_window", onClose, false]);
    assert.equal(typeof tree.props.Icon, "function");
    const view = findIn(tree, node => node.type === IoFlowView, "the flow view");
    assert.deepEqual(view.props, { flow, traces, compact: true });
});
