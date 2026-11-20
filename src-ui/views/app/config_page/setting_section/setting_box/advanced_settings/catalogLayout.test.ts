import assert from "node:assert/strict";
import { test } from "vitest";
import { find, findIn, hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";

// The model catalogs' two layouts (catalogLayout.tsx): a list, one card a row with its facts
// beside it, and a grid, cards side by side with their facts in a fold. One choice for every
// catalog, kept in the app's state while it runs.
async function layouts(chosen: unknown) {
    const runtime = hooks();
    const store = { data: chosen, updates: [] as unknown[] };
    const module = await loadModule<typeof import("./catalogLayout.tsx")>(new URL("./catalogLayout.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@store": { useStore_CatalogLayout: () => ({ currentCatalogLayout: { data: store.data },
            updateCatalogLayout: (layout: unknown) => { store.updates.push(layout); store.data = layout; } }) },
        "../_components/fold/Fold": { Fold: "fold" },
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

test("anything but the grid is read as the list", async () => {
    for (const [chosen, layout] of [["grid", "grid"], ["list", "list"], [undefined, "list"], ["tiles", "list"]]) {
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
