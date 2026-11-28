import assert from "node:assert/strict";
import { test } from "vitest";
import { find, findIn, hooks, kitStandIns, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";

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

test("the layout switch is the kit's ToggleGroup: both layouts in words, the one in use on, each a stop of the Tab key", async () => {
    const { runtime, module, store } = await layouts("list");
    const draw = () => runtime.render(module.CatalogLayoutSwitch);
    const tree = draw();
    assert.equal(tree.type, kitStandIns.ToggleGroup);
    assert.deepEqual([tree.props.type, tree.props.rovingFocus, tree.props.value, tree.props["aria-label"]],
        ["single", false, "list", "model_catalog.layout.label"]);
    const items = () => nodesIn(draw()).filter(node => node.type === kitStandIns.ToggleGroupItem);
    assert.deepEqual(items().map(item => [item.props.value, findIn(item, node => node.type === "span").props.children]),
        [["grid", "model_catalog.layout.grid"], ["list", "model_catalog.layout.list"]]);
    assert.ok(items().every(item => findIn(item, node => node.type === "svg").props["aria-hidden"] === "true"), "the icons repeat the words");
    // Pressing the one in use gives an empty value and changes nothing, nor does a value that is no
    // layout; the other changes every catalog's layout.
    const choose = (value: string) => draw().props.onValueChange(value);
    choose("");
    choose("list");
    choose("tiles");
    assert.deepEqual(store.updates, []);
    choose("grid");
    assert.deepEqual(store.updates, ["grid"]);
    assert.equal(draw().props.value, "grid");
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
    // In the list the facts are the card's own block (the kit's CardContent), beside what the model is.
    const listed = runtime.render(module.CatalogFacts, { layout: "list", children: facts });
    assert.equal(find(listed, node => node.type === "fold"), null);
    assert.deepEqual([listed.type, listed.props.children], [kitStandIns.CardContent, facts]);
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

// #1230: a part that holds what the page's feature still needs (the chat reading models of the
// chosen language) starts open, opens when it becomes needed, and can still be closed.
test("a part of a catalog that is needed starts open, opens when it becomes needed, and can still be closed", async () => {
    const { runtime, module } = await layouts("grid");
    const open = (needed: boolean) => findIn(runtime.render(module.CatalogSection, { title: "Recognition models", help: [], level: 4, needed, children: "cards" }),
        node => node.type === "fold");
    assert.equal(open(true).props.open, true, "open from the start");
    open(true).props.onToggle({ currentTarget: { open: false } });
    assert.equal(open(true).props.open, false, "closed by the user while still needed");
    // Done: it stays as the user left it; needed again, it opens.
    assert.equal(open(false).props.open, false);
    open(true);
    assert.equal(open(true).props.open, true, "opened when it became needed again");
    const later = await layouts("grid");
    const draw = (needed: boolean) => findIn(later.runtime.render(later.module.CatalogSection, { title: "Recognition models", help: [], level: 4, needed, children: "cards" }),
        node => node.type === "fold").props.open;
    assert.equal(draw(false), false, "not needed: closed at first");
    draw(true);
    assert.equal(draw(true), true, "opened when it became needed");
});

test("a part of the translation review's catalog is not folded: its heading and lines are as before", async () => {
    const { runtime, module } = await layouts("grid");
    const tree = runtime.render(module.CatalogSection, { title: "Translation", help: ["What it is for"], level: 4, id: "model-catalog-translation", fold: false, children: "card" });
    assert.equal(find(tree, node => node.type === "fold"), null);
    assert.deepEqual(findIn(tree, node => node.type === "h4").props, { id: "model-catalog-translation", children: "Translation" });
    assert.ok(find(tree, node => node.type === "p" && node.props.children === "What it is for"));
});

// The state badges of every catalog share these rules (VoiceSettings.css.ts): a model on the PC
// is a filled badge with a check, one that is not is an outline with an empty ring.
test("whether a model is on the PC is told by the state badge's fill and mark, not by its words alone", async () => {
    const { runtime, module } = await layouts("list");
    // The kit's Badge, at the end of the name's line (the status place), with the state's words.
    const drawn = runtime.render(module.CatalogState, { state: "in_use", children: "In use" });
    assert.deepEqual([drawn.type, drawn.props.className, drawn.props.children], [kitStandIns.Badge, "status", "In use"]);
    const look = (state: string) => {
        const { tone, variant, mark } = runtime.render(module.CatalogState, { state, children: state }).props;
        return [tone, variant, mark];
    };
    // On the PC: filled with a check; in use, filled in the active color; ready, the active outline tinted.
    assert.deepEqual(look("downloaded"), [undefined, "solid", "check"]);
    assert.deepEqual(look("in_use"), ["active", "solid", "check"]);
    assert.deepEqual(look("ready"), ["active", "tint", "check"]);
    // Not yet: an outline with an empty ring, its words quieter.
    assert.deepEqual(look("not_downloaded"), ["muted", undefined, "ring"]);
    assert.deepEqual(look("not_set"), ["muted", undefined, "ring"]);
    // Connected: the active outline; working or not answering: amber; a problem: red; no mark.
    assert.deepEqual(look("connected"), ["active", undefined, undefined]);
    for (const state of ["working", "checking", "not_connected", "changed"]) assert.deepEqual(look(state), ["warning", undefined, undefined], state);
    for (const state of ["url_invalid", "missing"]) assert.deepEqual(look(state), ["failed", undefined, undefined], state);
    // Any other state is a plain outline, a name an object has of its own included.
    for (const state of ["unchecked", "unsupported", "toString", "constructor"]) assert.deepEqual(look(state), [undefined, undefined, undefined], state);
});

