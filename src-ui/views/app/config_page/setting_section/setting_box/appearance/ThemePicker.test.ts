import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { drawWith, find, findIn, hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as themes from "../../../../../../logics/theme/themes.ts";

// The theme row (#965): a tile for each preset and one for the user's own colours, chosen at once
// like the page's other choices; the user's own colours under the tiles while "Custom" is in use.
interface World { theme: unknown; sent: unknown[] }

async function load(world: World) {
    const runtime = hooks();
    const module = await loadModule<typeof import("./ThemePicker.tsx")>(new URL("./ThemePicker.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@logics_configs": { useAppearance: () => ({ currentTheme: { data: world.theme, state: "ok" },
            setTheme: (value: unknown) => { world.sent.push(value); } }) },
        "@images/check_mark.svg?react": "check-svg",
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/color_entry_with_save_button/ColorEntryWithSaveButton": { ColorEntryWithSaveButton: "color-entry" },
        "../../../../../../logics/theme/themes.ts": themes,
    });
    const draw = () => runtime.render(module.ThemeContainer);
    // The tiles as drawn: each tile's name, whether it is in use, and its radio. A tile has hooks
    // of its own, so it is drawn apart from the row's.
    const tiles = (tree: TreeNode) => nodesIn(tree).filter(node => typeof node.props?.onChoose === "function").map(node => {
        const drawn = drawWith(hooks(), node);
        const radio = findIn(drawn, child => child.type === "input");
        return { id: node.props.id as string, drawn, radio, checked: radio.props.checked as boolean,
            check: find(drawn, child => child.props?.className === "check" && child.props?.["aria-hidden"] === "true") !== null };
    });
    const entries = (tree: TreeNode) => nodesIn(tree).filter(node => node.type === "color-entry");
    return { runtime, draw, tiles, entries };
}

const custom = { base: "#10272b", accent: "#3fc8c2" };

test("every preset and Custom are tiles in one group, the one in use framed and checked", async () => {
    const world: World = { theme: { preset: "midnight", custom }, sent: [] };
    const { draw, tiles } = await load(world);
    const tree = draw();
    const row = findIn(tree, node => node.type === "form-row");
    assert.deepEqual([row.props.label, row.props.description, row.props.group],
        ["config_page.appearance.theme.label", "config_page.appearance.theme.desc", true]);
    assert.equal(tree.props["data-setting-id"], "theme");
    const drawn = tiles(tree);
    assert.deepEqual(drawn.map(tile => tile.id), [...themes.PRESETS.map(preset => preset.id), "custom"]);
    assert.deepEqual(drawn.filter(tile => tile.checked).map(tile => tile.id), ["midnight"]);
    // In use is said by the check after the name and by the radio, not by the frame's colour alone.
    assert.deepEqual(drawn.filter(tile => tile.check).map(tile => tile.id), ["midnight"]);
    assert.ok(drawn.every(tile => tile.radio.props.type === "radio" && tile.radio.props.name === "theme"));
    // The picture is drawn in the tile's own theme, and is not read out.
    const lagoon = drawn.find(tile => tile.id === "lagoon");
    assert.ok(lagoon);
    const picture = findIn(lagoon.drawn, node => node.props?.["aria-hidden"] === "true" && node.props?.style);
    assert.equal(picture.props.style["--theme_tile_canvas"], themes.deriveTokens(themes.PRESETS[2].colors)["--vox_canvas"]);
    // No colours to pick while a preset is in use.
    assert.equal(find(tree, node => node.props?.["data-theme-custom"] !== undefined), null);
});

test("choosing a tile applies it at once and keeps the user's own colours; the one in use does nothing", async () => {
    const world: World = { theme: { preset: "midnight", custom }, sent: [] };
    const { draw, tiles } = await load(world);
    const pick = (id: string) => tiles(draw()).find(tile => tile.id === id)?.radio.props.onChange();
    pick("midnight");
    assert.deepEqual(world.sent, []);
    pick("forest");
    pick("custom");
    assert.deepEqual(world.sent, [{ preset: "forest", custom }, { preset: "custom", custom }]);
});

test("a preset this version does not know, or no setting yet, is shown as the default", async () => {
    for (const theme of [{ preset: "a_newer_preset", custom }, undefined, "midnight"]) {
        const { draw, tiles } = await load({ theme, sent: [] });
        assert.deepEqual(tiles(draw()).filter(tile => tile.checked).map(tile => tile.id), ["dark_plum"], JSON.stringify(theme));
    }
});

test("with Custom in use, Base and Accent are picked; a whole colour applies, while dragging at most every so often", async () => {
    vi.useFakeTimers();
    try {
        const world: World = { theme: { preset: "custom", custom }, sent: [] };
        const { runtime, draw, entries } = await load(world);
        let tree = draw();
        const fields = () => entries(draw());
        assert.deepEqual(fields().map(entry => [entry.props.label, entry.props.variable]),
            [["config_page.appearance.theme.base.label", "#10272b"], ["config_page.appearance.theme.accent.label", "#3fc8c2"]]);
        const rows = nodesIn(tree).filter(node => node.type === "form-row").map(node => node.props.label);
        assert.deepEqual(rows, ["config_page.appearance.theme.label", "config_page.appearance.theme.base.label", "config_page.appearance.theme.accent.label"]);
        // Half a colour typed is kept in the field and sends nothing.
        fields()[0].props.onChangeFunction("#20");
        assert.equal(fields()[0].props.variable, "#20");
        assert.deepEqual(world.sent, []);
        // The first whole colour goes at once; the ones dragged after it wait, and the last is sent.
        fields()[0].props.onChangeFunction("#203040");
        fields()[0].props.onChangeFunction("#203041");
        fields()[0].props.onChangeFunction("#203042");
        assert.deepEqual(world.sent, [{ preset: "custom", custom: { base: "#203040", accent: "#3fc8c2" } }]);
        vi.advanceTimersByTime(themesSendEvery);
        assert.deepEqual(world.sent.at(-1), { preset: "custom", custom: { base: "#203042", accent: "#3fc8c2" } });
        assert.equal(world.sent.length, 2);
        // Enter sends what is typed at once.
        fields()[1].props.onChangeFunction("#A47AF6");
        fields()[1].props.onChangeFunction("#a47af7");
        fields()[1].props.saveFunction();
        assert.deepEqual(world.sent.at(-1), { preset: "custom", custom: { base: "#203042", accent: "#a47af7" } });
        tree = draw();
        assert.equal(find(tree, node => node.props?.role === "status"), null);
        runtime.unmount();
    } finally {
        vi.useRealTimers();
    }
});

const themesSendEvery = 150;

test("an accent close to warning or failed is said in words under the colours", async () => {
    const world: World = { theme: { preset: "custom", custom: { base: "#261633", accent: "#e0a040" } }, sent: [] };
    const { draw } = await load(world);
    const status = findIn(draw(), node => node.props?.role === "status");
    assert.equal(status.props.children, "config_page.appearance.theme.accent_near_states");
});
