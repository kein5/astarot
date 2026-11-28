import assert from "node:assert/strict";
import { test } from "vitest";
import { componentName, draw, findIn, hooks, loadModule, nodesIn, treeNode } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import { HAND_PATH } from "./VrHandIcon.tsx";

// The VR log's toolbar: where the log is anchored, recall and lock, the text size and the log's
// opacity. Every button carries its tooltip (VrTooltipButton, a stand-in here that keeps its
// props); a setting whose change is on its way cannot be pressed again.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });
const pending = (data: unknown): Setting => ({ state: "pending", data });

interface Values { anchor?: Setting; locked?: Setting; opacity?: Setting; font?: Setting }

async function toolbar({ anchor = ok("LeftHand"), locked = ok(false), opacity = ok(1), font = ok(17) }: Values = {}) {
    const calls: unknown[][] = [];
    const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
    const { VrToolbar } = await loadModule<typeof import("./VrToolbar.tsx")>(new URL("./VrToolbar.tsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: record("send") }) },
        "@logics_configs": { useVr: () => ({
            currentOverlayVrPanelAnchor: anchor, setOverlayVrPanelAnchor: record("anchor"),
            currentOverlayVrPanelLocked: locked, toggleOverlayVrPanelLocked: record("lock"),
            currentOverlayVrPanelOpacity: opacity, setOverlayVrPanelOpacity: record("opacity"),
            currentOverlayVrPanelFontSize: font, setOverlayVrPanelFontSize: record("font"),
        }) },
        "./VrTooltip": { VrTooltipButton: "tip-button" },
        "./VrHandIcon": { HAND_PATH },
    });
    const tree = VrToolbar();
    const groups: TreeNode[] = tree.props.children;
    // Each group's buttons, as drawn: the tooltip buttons with their props.
    const buttonsOf = (group: TreeNode) => nodesIn(group).filter(node => componentName(node) === "Button").map(node => draw(node));
    const [anchors, position, fonts, opacityGroup] = groups.map(buttonsOf);
    return { tree, groups, calls, anchors, position, fonts, opacity: opacityGroup[0] };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);
// The tooltip a button carries and how it is named and pressed.
const tipOf = (button: TreeNode) => ({ label: button.props["aria-label"], pressed: button.props["aria-pressed"], disabled: button.props["aria-disabled"],
    busy: button.props["aria-busy"], title: button.props.tipTitle, state: button.props.tipState, help: button.props.tipHelp });
// The icon a button draws: its path, and whether it is mirrored.
function iconOf(button: TreeNode) {
    const svg = draw(findIn(button, node => componentName(node) === "Icon", "the icon"));
    assert.deepEqual([svg.type, svg.props.viewBox, svg.props["aria-hidden"]], ["svg", "0 0 24 24", "true"]);
    return { d: svg.props.children.props.d, mirrored: svg.props.style?.transform === "scaleX(-1)" };
}

test("the toolbar's groups are named for screen readers", async () => {
    const view = await toolbar();
    assert.deepEqual([view.tree.props.role, view.tree.props["aria-label"]], ["group", "vr_panel.tooltip.controls_group"]);
    assert.deepEqual(view.groups.map(group => [group.props.role, group.props["aria-label"]]), [
        ["group", "vr_panel.tooltip.anchor"], ["group", "vr_panel.tooltip.position"], ["group", "vr_panel.tooltip.font"], [undefined, undefined],
    ]);
});

test("the four anchors: the one in use says so, the others say where the log is and offer to move it", async () => {
    const view = await toolbar();
    const current = "vr_panel.tooltip.current: vr_panel.anchor_left_hand";
    assert.deepEqual(view.anchors.map(tipOf), [
        { label: "vr_panel.tooltip.anchor: vr_panel.anchor_playspace", pressed: false, disabled: undefined, busy: undefined,
            title: "vr_panel.tooltip.anchor: vr_panel.anchor_playspace", state: current, help: "vr_panel.tooltip.choose_anchor" },
        { label: "vr_panel.tooltip.anchor: vr_panel.anchor_left_hand", pressed: true, disabled: undefined, busy: undefined,
            title: "vr_panel.tooltip.anchor: vr_panel.anchor_left_hand", state: "vr_panel.language.selected", help: "" },
        { label: "vr_panel.tooltip.anchor: vr_panel.anchor_right_hand", pressed: false, disabled: undefined, busy: undefined,
            title: "vr_panel.tooltip.anchor: vr_panel.anchor_right_hand", state: current, help: "vr_panel.tooltip.choose_anchor" },
        { label: "vr_panel.tooltip.anchor: vr_panel.anchor_head", pressed: false, disabled: undefined, busy: undefined,
            title: "vr_panel.tooltip.anchor: vr_panel.anchor_head", state: current, help: "vr_panel.tooltip.choose_anchor" },
    ]);
    assert.deepEqual(view.anchors.map(button => classesOf(button).includes("is_on")), [false, true, false, false]);
    // Pressing the one in use does nothing; another moves the log there.
    for (const button of view.anchors) button.props.onClick();
    assert.deepEqual(view.calls, [["anchor", "Playspace"], ["anchor", "RightHand"], ["anchor", "HMD"]]);
});

test("each anchor draws its place: a pin, a left and a mirrored right hand marked L and R, and a head", async () => {
    const view = await toolbar();
    const icons = view.anchors.map(iconOf);
    assert.deepEqual(icons.map(icon => icon.mirrored), [false, false, true, false]);
    assert.equal(icons[1].d, HAND_PATH);
    assert.equal(icons[2].d, HAND_PATH);
    assert.equal(new Set(icons.map(icon => icon.d)).size, 3, "the pin, the hand and the head differ");
    // The hands' marks are hidden from screen readers: the buttons' names say the hand.
    const marks = view.anchors.map(button => nodesIn(button).filter(node => node.type === "span"));
    assert.deepEqual(marks.map(spans => spans.map(span => [textOf(span), span.props["aria-hidden"]])), [[], [["L", "true"]], [["R", "true"]], []]);
});

test("an anchor the toolbar does not know is read as the play space, and none is pressed", async () => {
    const view = await toolbar({ anchor: ok("Elsewhere") });
    assert.deepEqual(view.anchors.map(button => button.props["aria-pressed"]), [false, false, false, false]);
    assert.ok(view.anchors.every(button => button.props.tipState === "vr_panel.tooltip.current: vr_panel.anchor_playspace"));
    assert.equal(view.position[0].props.tipState, "vr_panel.tooltip.anchor: vr_panel.anchor_playspace");
    const head = await toolbar({ anchor: ok("HMD") });
    assert.equal(head.position[0].props.tipState, "vr_panel.tooltip.anchor: vr_panel.anchor_head");
});

test("while the anchor is changing, its buttons wait, and their tooltips say so", async () => {
    const view = await toolbar({ anchor: pending("RightHand") });
    for (const button of view.anchors) {
        assert.deepEqual([button.props["aria-disabled"], button.props["aria-busy"], button.props.tipHelp], [true, true, "vr_panel.tooltip.busy_help"]);
        assert.ok(classesOf(button).includes("is_pending"));
        button.props.onClick();
    }
    assert.deepEqual(view.anchors.map(button => button.props.tipState), [
        "vr_panel.tooltip.current: vr_panel.anchor_right_hand · vr_panel.settings.changing_short",
        "vr_panel.tooltip.current: vr_panel.anchor_right_hand · vr_panel.settings.changing_short",
        "vr_panel.language.selected · vr_panel.settings.changing_short",
        "vr_panel.tooltip.current: vr_panel.anchor_right_hand · vr_panel.settings.changing_short",
    ]);
    assert.deepEqual(view.calls, []);
    // The other buttons are not waiting.
    assert.ok([...view.position, ...view.fonts, view.opacity].every(button => !classesOf(button).includes("is_pending")));
});

test("recall brings the log back to its anchor", async () => {
    const view = await toolbar({ anchor: ok("RightHand") });
    const [recall] = view.position;
    assert.deepEqual(tipOf(recall), { label: "vr_panel.recall_log", pressed: undefined, disabled: undefined, busy: undefined,
        title: "vr_panel.recall_log", state: "vr_panel.tooltip.anchor: vr_panel.anchor_right_hand", help: "vr_panel.tooltip.recall_help" });
    assert.equal(iconOf(recall).mirrored, false);
    recall.props.onClick();
    assert.deepEqual(view.calls, [["send", "/run/vr_panel_recall_log"]]);
});

test("the lock says whether the log can be grabbed, and switches it", async () => {
    const unlocked = await toolbar();
    const locked = await toolbar({ locked: ok(true) });
    const [, open] = unlocked.position, [, shut] = locked.position;
    assert.deepEqual([tipOf(open), tipOf(shut)], [
        { label: "vr_panel.lock", pressed: false, disabled: undefined, busy: undefined, title: "vr_panel.lock", state: "vr_panel.tooltip.unlocked", help: "vr_panel.tooltip.lock_help" },
        { label: "vr_panel.lock", pressed: true, disabled: undefined, busy: undefined, title: "vr_panel.lock", state: "vr_panel.locked", help: "vr_panel.tooltip.unlock_help" },
    ]);
    assert.notEqual(iconOf(open).d, iconOf(shut).d, "an open and a closed lock");
    assert.equal(iconOf((await toolbar({ locked: ok("true") })).position[1]).d, iconOf(open).d, "only true is locked");
    open.props.onClick();
    shut.props.onClick();
    assert.deepEqual([...unlocked.calls, ...locked.calls], [["lock"], ["lock"]]);
    const changing = await toolbar({ locked: pending(true) });
    changing.position[1].props.onClick();
    assert.deepEqual(changing.calls, []);
    assert.equal(changing.position[1].props["aria-busy"], true);
});

test("A− and A＋ change the log's text by one, from 14 to 28", async () => {
    const view = await toolbar({ font: ok(17) });
    const [smaller, larger] = view.fonts;
    assert.deepEqual([tipOf(smaller), tipOf(larger)], [
        { label: "vr_panel.tooltip.smaller", pressed: undefined, disabled: undefined, busy: undefined, title: "vr_panel.tooltip.smaller",
            state: 'vr_panel.tooltip.font_current {"size":17}', help: "vr_panel.tooltip.font_help" },
        { label: "vr_panel.tooltip.larger", pressed: undefined, disabled: undefined, busy: undefined, title: "vr_panel.tooltip.larger",
            state: 'vr_panel.tooltip.font_current {"size":17}', help: "vr_panel.tooltip.font_help" },
    ]);
    assert.deepEqual([textOf(smaller), textOf(larger)], ["A−", "A＋"]);
    smaller.props.onClick();
    larger.props.onClick();
    assert.deepEqual(view.calls, [["font", 16], ["font", 18]]);
    // The size between them, named for screen readers.
    const value = findIn(view.groups[2], node => node.type === "span");
    assert.deepEqual([textOf(value), value.props["aria-label"]], ["17", "vr_panel.tooltip.font: 17"]);
    assert.equal(view.fonts.some(button => classesOf(button).includes("is_disabled")), false);
});

test("at either end of the text sizes, that button is greyed out, says why and does nothing", async () => {
    for (const [size, end] of [[14, 0], [13, 0], [28, 1], [29, 1]] as const) {
        const view = await toolbar({ font: ok(size) });
        const stopped = view.fonts[end], other = view.fonts[1 - end];
        assert.deepEqual([stopped.props["aria-disabled"], stopped.props.tipHelp, classesOf(stopped).includes("is_disabled")],
            [true, "vr_panel.tooltip.font_limit", true], `${size}`);
        assert.deepEqual([other.props["aria-disabled"], other.props.tipHelp, classesOf(other).includes("is_disabled")],
            [undefined, "vr_panel.tooltip.font_help", false], `${size}`);
        stopped.props.onClick();
        assert.deepEqual(view.calls, []);
    }
    for (const size of [15, 27]) {
        const view = await toolbar({ font: ok(size) });
        assert.deepEqual(view.fonts.map(button => button.props["aria-disabled"]), [undefined, undefined], `${size}`);
    }
});

test("while the text size is changing, both size buttons wait", async () => {
    const view = await toolbar({ font: pending(18) });
    for (const button of view.fonts) {
        assert.deepEqual([button.props["aria-disabled"], button.props["aria-busy"], button.props.tipState, button.props.tipHelp],
            [true, true, 'vr_panel.tooltip.font_current {"size":18} · vr_panel.settings.changing_short', "vr_panel.tooltip.busy_help"]);
        button.props.onClick();
    }
    assert.deepEqual(view.calls, []);
});

test("the opacity button shows the opacity in use and steps down through 100, 80, 60 and 40 %", async () => {
    const view = await toolbar({ opacity: ok(0.8) });
    assert.deepEqual(tipOf(view.opacity), { label: "vr_panel.log_opacity: 80%", pressed: undefined, disabled: undefined, busy: undefined,
        title: "vr_panel.log_opacity", state: "vr_panel.tooltip.current: 80%", help: "vr_panel.tooltip.opacity_help" });
    assert.equal(textOf(findIn(view.opacity, node => node.type === "span")), "80%");
    assert.equal(new Set([iconOf(view.opacity).d, iconOf(view.position[0]).d]).size, 2);
    const next = async (opacity: number) => {
        const button = (await toolbar({ opacity: ok(opacity) }));
        button.opacity.props.onClick();
        return button.calls[0]?.[1];
    };
    // From 40 % (or a lower value set in the settings) it goes back to 100 %. A value a hair from a step counts as that step.
    const steps = [];
    for (const opacity of [1, 0.8, 0.6, 0.4, 0.2, 0.9, 0.805, 0.815, 0.4000001, 0.81]) steps.push(await next(opacity));
    // 0.81 is 0.01 over 80 %: still 80 %, so the next is 60 %.
    assert.deepEqual(steps, [0.8, 0.6, 0.4, 1, 1, 0.8, 0.6, 0.8, 1, 0.6]);
    assert.equal((await toolbar({ opacity: ok(0.555) })).opacity.props["aria-label"], "vr_panel.log_opacity: 56%");
    const changing = await toolbar({ opacity: pending(0.6) });
    changing.opacity.props.onClick();
    assert.deepEqual(changing.calls, []);
});

test("every button draws its own shape", async () => {
    const view = await toolbar({ locked: ok(true) });
    const unlocked = await toolbar();
    const paths = [...view.anchors, ...view.position, view.opacity, unlocked.position[1]].map(button => iconOf(button).d);
    assert.ok(paths.every(d => /^M[\d.]+ [\d.]+/.test(d)), paths.join("\n"));
    // The two hands share a drawing; every other shape is its own.
    assert.equal(new Set(paths).size, paths.length - 1);
});

test("the locked log's lock is the closed lock its title bar shows", async () => {
    const { VrWindow } = await loadModule<typeof import("./VrWindow.tsx")>(new URL("./VrWindow.tsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t, i18n: { language: "en" } }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: false } }) },
    });
    const window = VrWindow({ Icon: () => null, title: "Log", onClose() {}, is_grab_locked: true });
    const closed = findIn(window, node => node.type === "path", "the title bar's lock").props.d;
    assert.equal(iconOf((await toolbar({ locked: ok(true) })).position[1]).d, closed);
    assert.notEqual(iconOf((await toolbar({ locked: ok(false) })).position[1]).d, closed);
});
