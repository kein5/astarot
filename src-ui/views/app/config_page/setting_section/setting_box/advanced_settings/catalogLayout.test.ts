import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { find, findIn, hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";

// The model catalogs' two layouts (catalogLayout.tsx): a list, one card a row with its facts
// beside it, and a grid, cards side by side with their details in a fold. One choice for every
// catalog, the Appearance setting CatalogLayout (saved by the core as CATALOG_LAYOUT).
async function layouts(chosen: unknown, hints = false) {
    const runtime = hooks();
    const store = { data: chosen, updates: [] as unknown[] };
    const module = await loadModule<typeof import("./catalogLayout.tsx")>(new URL("./catalogLayout.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@logics_configs": { useAppearance: () => ({ currentCatalogLayout: { data: store.data },
            setCatalogLayout: (layout: unknown) => { store.updates.push(layout); store.data = layout; } }) },
        "../_components/fold/Fold": { Fold: "fold" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
    });
    return { runtime, module, store };
}

test("the layout buttons say both layouts in words and press the one in use", async () => {
    const { runtime, module, store } = await layouts("list");
    const draw = () => runtime.render(module.CatalogLayoutSwitch);
    const tree = draw();
    assert.deepEqual([tree.props.role, tree.props["aria-label"]], ["group", "model_catalog.layout.label"]);
    const buttons = () => nodesIn(draw()).filter(node => node.type === "button");
    assert.deepEqual(buttons().map(button => [findIn(button, node => node.type === "span").props.children, button.props["aria-pressed"]]),
        [["model_catalog.layout.grid", false], ["model_catalog.layout.list", true]]);
    assert.ok(buttons().every(button => findIn(button, node => node.type === "svg").props["aria-hidden"] === "true"), "the icons repeat the words");
    // Pressing the one in use changes nothing; the other changes every catalog's layout.
    buttons()[1].props.onClick();
    assert.deepEqual(store.updates, []);
    buttons()[0].props.onClick();
    assert.deepEqual(store.updates, ["grid"]);
    assert.deepEqual(buttons().map(button => button.props["aria-pressed"]), [true, false]);
});

test("the grid until the list is chosen: the setting's default, and anything else, is the grid", async () => {
    for (const [chosen, layout] of [["grid", "grid"], ["list", "list"], [undefined, "grid"], ["tiles", "grid"]]) {
        const { runtime, module } = await layouts(chosen);
        assert.equal(runtime.render(module.useCatalogLayout), layout, String(chosen));
    }
});

test("a catalog's list says its layout, and a grid card's facts are a fold of the few-words size", async () => {
    const { runtime, module } = await layouts("grid");
    const facts = runtime.api.createElement("dl", { className: "facts" });
    for (const layout of ["list", "grid"] as const) {
        const list = runtime.render(module.CatalogList, { layout, children: "cards" });
        assert.deepEqual([list.type, list.props.className, list.props.role, list.props["data-layout"], list.props.children],
            ["ul", "catalog", "list", layout, "cards"]);
    }
    // In the list the facts are the card's own block, beside what the model is.
    const listed = runtime.render(module.CatalogFacts, { layout: "list", children: facts });
    assert.equal(find(listed, node => node.type === "fold"), null);
    assert.equal(findIn(listed, node => node.type === "dl").props.className, "facts");
    // In the grid they are folded under the card's words.
    const folded = runtime.render(module.CatalogFacts, { layout: "grid", children: facts });
    assert.deepEqual([folded.type, folded.props.size, folded.props.summary, folded.props.children], ["fold", "link", "model_catalog.layout.facts", facts]);
});

test("a part of a catalog is a bar of the app's fold, closed at first, with its name as a heading, its readout and what it is for", async () => {
    for (const hints of [false, true]) {
        const { runtime, module } = await layouts("grid", hints);
        const draw = () => runtime.render(module.CatalogSection, { title: "Speech recognition", help: ["What it is for", "How to choose"],
            readout: "7 models · 1 downloaded", level: 4, id: "model-catalog-asr", "data-catalog-group": "asr", children: "cards" });
        let tree = draw();
        assert.deepEqual([tree.type, tree.props["aria-labelledby"], tree.props["data-catalog-group"]], ["section", "model-catalog-asr", "asr"]);
        const fold = findIn(tree, node => node.type === "fold");
        assert.deepEqual([fold.props.size, fold.props.open, fold.props["data-catalog-fold"]], [undefined, false, true], "a bar, closed at first");
        // The name stays a heading of its level for assistive technology, inside the bar.
        const heading = findIn(fold.props.summary, node => node.props?.role === "heading");
        assert.deepEqual([heading.props["aria-level"], heading.props.id, heading.props.children], [4, "model-catalog-asr", "Speech recognition"]);
        assert.ok(find(fold.props.summary, node => node.props?.children === "7 models · 1 downloaded"), "the readout beside the name");
        const lines = nodesIn(fold).filter(node => node.type === "p").map(node => node.props.children);
        const marks = nodesIn(fold.props.summary).filter(node => node.type === "hint");
        if (hints) {
            // What the part is for is the name's hint, and the bar's description.
            assert.deepEqual(marks.map(mark => [mark.props.text, mark.props.row]), [["What it is for\nHow to choose", true]]);
            assert.equal(fold.props.summaryProps["aria-describedby"], marks[0].props.id);
            assert.deepEqual(lines, []);
        } else {
            assert.deepEqual(marks, []);
            assert.deepEqual(lines, ["What it is for", "How to choose"]);
        }
        // Opening it keeps it open while it is drawn, and closing it closed.
        fold.props.onToggle({ currentTarget: { open: true } });
        tree = draw();
        assert.equal(findIn(tree, node => node.type === "fold").props.open, true);
        findIn(tree, node => node.type === "fold").props.onToggle({ currentTarget: { open: false } });
        assert.equal(findIn(draw(), node => node.type === "fold").props.open, false);
    }
});

test("a part of the translation review's catalog is not folded: its heading and lines are as before", async () => {
    const { runtime, module } = await layouts("grid");
    const tree = runtime.render(module.CatalogSection, { title: "Translation", help: ["What it is for"], level: 4, id: "model-catalog-translation", fold: false, children: "card" });
    assert.equal(find(tree, node => node.type === "fold"), null);
    assert.deepEqual(findIn(tree, node => node.type === "h4").props, { id: "model-catalog-translation", children: "Translation" });
    assert.ok(find(tree, node => node.type === "p" && node.props.children === "What it is for"));
});

// The state badges of every catalog share these rules (VoiceSettings.module.scss): a model on the PC
// is a filled badge with a check, one that is not is an outline with an empty ring.
test("whether a model is on the PC is told by the state badge's shape and mark, not by its words alone", () => {
    const scss = readFileSync(new URL("./VoiceSettings.module.scss", import.meta.url), "utf8");
    const rules = scss.slice(scss.indexOf(".badge.status {"), scss.indexOf("// The \"!\" of a model"));
    assert.match(rules, /&::before \{[^}]*mask: var\(--status_mark\)/, "a mark drawn before the words");
    assert.match(rules, /&\[data-tone="not_downloaded"\], &\[data-tone="not_set"\] \{\s*--status_mark: url\("data:image\/svg\+xml,[^"]*circle[^"]*"\);\s*background: transparent;/,
        "not yet: an outline with an empty ring");
    assert.match(rules, /&\[data-tone="downloaded"\], &\[data-tone="in_use"\], &\[data-tone="ready"\] \{\s*--status_mark: url\("data:image\/svg\+xml,[^"]*path/,
        "on the PC: a check");
    assert.match(rules, /&\[data-tone="downloaded"\] \{ background: var\(--dark_300_color/, "downloaded: filled light");
    assert.match(rules, /&\[data-tone="in_use"\] \{ background: var\(--vox_state_active/, "in use: filled in the active color");
});

