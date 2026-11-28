import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as logFontSize from "../../../../../../logics/main/logFontSize.ts";

// #1314 (M-8): A− and A＋ at the start of the composer set the log's font size in sight, a mark of
// the settings' slider at a time. Each button's name, also its tooltip, says the size now.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };

async function buttons(setting: Setting) {
    const sets: unknown[] = [];
    const { LogFontButtons } = await loadModule<typeof import("./LogFontButtons.tsx")>(new URL("./LogFontButtons.tsx", import.meta.url), hooks(), {
        "@useI18n": { useI18n: () => ({ t }) },
        "@logics_configs": { useAppearance: () => ({ currentMessageLogUiScaling: setting, setMessageLogUiScaling: (size: unknown) => sets.push(size) }) },
        "../../../../../kit/index.ts": { Button: "Button" },
        "../../../../../common_components/tooltip/Tooltip": { Tooltip: "Tooltip" },
        "../../../../../../logics/main/logFontSize.ts": logFontSize,
    });
    const group: TreeNode = LogFontButtons();
    const tips = nodesIn(group).filter(node => node.type === "Tooltip");
    const pressables = nodesIn(group).filter(node => node.type === "Button");
    return { group, tips, pressables, sets };
}

const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};

test("the two buttons are a group named as the setting, and each names the size now", async () => {
    const view = await buttons({ state: "ok", data: 100 });
    assert.deepEqual([view.group.props.role, view.group.props["aria-label"]], ["group", "config_page.appearance.textbox_ui_size.label"]);
    assert.deepEqual(view.pressables.map(textOf), ["A−", "A＋"]);
    const names = ['main_page.log_font.smaller_now {"size":100}', 'main_page.log_font.larger_now {"size":100}'];
    assert.deepEqual(view.pressables.map(button => button.props["aria-label"]), names);
    // The tooltip shows the button's own name.
    assert.deepEqual(view.tips.map(tip => tip.props.title), names);
    assert.deepEqual(view.pressables.map(button => button.props["aria-disabled"]), [undefined, undefined]);
    view.pressables[0].props.onClick();
    view.pressables[1].props.onClick();
    assert.deepEqual(view.sets, [90, 110]);
});

test("at an end of the range, that button says so and a press does nothing", async () => {
    for (const [size, end] of [[40, 0], [200, 1]] as const) {
        const view = await buttons({ state: "ok", data: size });
        const stopped = view.pressables[end], other = view.pressables[1 - end];
        assert.deepEqual([stopped.props["aria-disabled"], stopped.props["aria-label"]],
            [true, `main_page.log_font.${end === 0 ? "smallest" : "largest"} {"size":${size}}`]);
        assert.equal(other.props["aria-disabled"], undefined);
        stopped.props.onClick();
        assert.deepEqual(view.sets, [], `${size}`);
        other.props.onClick();
        assert.deepEqual(view.sets, [end === 0 ? 50 : 190]);
    }
});

test("until the saved size is read, neither button does anything", async () => {
    for (const setting of [{ state: "pending", data: 100 }, { state: "ok", data: undefined }, { state: "error", data: "100" }]) {
        const view = await buttons(setting);
        assert.deepEqual(view.pressables.map(button => [button.props["aria-disabled"], button.props["aria-label"]]),
            [[true, "main_page.log_font.smaller"], [true, "main_page.log_font.larger"]]);
        for (const button of view.pressables) button.props.onClick();
        assert.deepEqual(view.sets, []);
    }
});
