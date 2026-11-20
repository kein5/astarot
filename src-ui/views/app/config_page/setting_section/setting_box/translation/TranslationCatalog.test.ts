import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, drawWith, find, findIn, hooks, loadModule, nodesIn, unchecked } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as translationCatalog from "../../../../../../logics/translation/translationCatalog.ts";
import type { TranslationCatalog } from "../../../../../../logics/translation/translationCatalog.ts";

// Test data: a catalog with only the fields the cards read. Shipped and added entries of both
// groups: one in use, one that cannot run yet, one ready.
const CATALOG = unchecked<TranslationCatalog>({
    engine: [
        { id: "shipped", weight: "shipped", origin: "builtin", name: "Shipped", runtime: "onnx", non_commercial: true, available: false, in_use: false },
        { id: "mine", weight: "user:mine", origin: "user", name: "Mine", runtime: "onnx", folder: "C:\\Models\\mine", languages: ["ja"], available: true, in_use: true },
        { id: "llm", weight: "user:llm", origin: "user", name: "LLM", runtime: "llamacpp", file: "C:\\Models\\llm.gguf", device: "auto", available: false, server_ready: false, in_use: false },
    ],
    api: [
        { id: "cloud", origin: "builtin", name: "Cloud", kind: "cloud", available: true },
        { id: "home", origin: "user", name: "Home", protocol: "openai_compatible", url: "http://192.168.1.5:8000/v1", model: "", has_key: true, key_in_memory: false, in_use: false },
    ],
    runtimes: ["onnx"], protocols: ["openai_compatible"],
});

// The catalog's groups and cards, each drawn on its own. hints: whether the page shows
// descriptions as hints (HintDescriptions).
async function catalog(context: TestContext, hints = false) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const heading = await loadModule<typeof import("../advanced_settings/catalogHeading.tsx")>(
        new URL("../advanced_settings/catalogHeading.tsx", import.meta.url), runtime, { "../_components/hint/Hint": { Hint: "hint" } });
    const module = await loadModule<typeof import("./TranslationCatalog.tsx")>(new URL("./TranslationCatalog.tsx", import.meta.url), runtime, {
        "../../../../../../logics/translation/useTranslationCatalog": { useTranslationCatalog: () => ({ catalog: CATALOG, error: null, pending: null, send: () => {} }) },
        "../../../../../../logics/translation/translationCatalog": translationCatalog,
        "../../../../../../logics/common/endpointPrivacy": { endpointDescription: () => "" },
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { useHintDescriptions: () => hints },
        "../_components/fold/Fold": { Fold: "fold" },
        "../advanced_settings/catalogHeading": heading,
        "../advanced_settings/catalogLayout": { useCatalogLayout: () => "list", CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch" },
        "./TranslationLlamaRuntimes": { TranslationLlamaRuntimes: "llama-runtimes" },
    });
    // One component at a time: each is drawn from scratch, so no state of the last one is read.
    const drawn = (node: TreeNode) => { runtime.remount(); return drawWith(runtime, node); };
    const groups = nodesIn(runtime.render(module.TranslationCatalogSection)).filter(node => componentName(node) === "CatalogGroup").map(drawn);
    const cards = groups.flatMap(group => nodesIn(group).filter(node => ["EntryCard", "ShippedCard"].includes(componentName(node) ?? "")).map(drawn));
    return { groups, cards: new Map(cards.map(card => [String(card.props["data-catalog-item"]), card])) };
}
const classOf = (node: TreeNode | null | undefined): string => String(node?.props?.className ?? "");
const head = (card: TreeNode) => findIn(card, node => classOf(node) === "card_head");

test("every card of the translation catalog ends its name's line with the state, as the model catalog's cards do", async context => {
    const { cards } = await catalog(context);
    assert.deepEqual([...cards.keys()], ["mine", "llm", "shipped", "home", "cloud"]);
    for (const [id, card] of cards) {
        const parts: (TreeNode | false | null | undefined)[] = [head(card).props.children].flat();
        const shown = parts.filter((part): part is TreeNode => typeof part === "object" && part !== null);
        assert.equal(shown[0].type, "strong", id);
        assert.equal(classOf(shown.at(-1)), "badge status", `${id}: the state is the last part of the head`);
        assert.equal(shown.filter(part => classOf(part).includes("status")).length, 1, id);
    }
    // The state is on the card too, so the entry in use is told by its frame.
    assert.deepEqual([...cards].map(([id, card]) => [id, card.props["data-status"]]),
        [["mine", "in_use"], ["llm", "no_server"], ["shipped", "not_downloaded"], ["home", "ready"], ["cloud", "ready"]]);
});

test("an added entry's card is what it is, its facts, then its notes and actions", async context => {
    const { cards } = await catalog(context);
    for (const id of ["mine", "llm", "home"]) {
        const card = cards.get(id);
        assert.ok(card, id);
        const blocks: TreeNode[] = [card.props.children].flat();
        // The facts are the catalogs' own part (catalogLayout.tsx): beside in the list, folded in the grid.
        const block = (node: TreeNode) => node.type === "catalog-facts" ? `catalog-facts > ${classOf(node.props.children)}` : classOf(node);
        assert.deepEqual(blocks.map(block), ["card_intro", "catalog-facts > facts card_spec", "card_foot"], id);
        const foot = blocks[2];
        assert.ok(find(foot, node => classOf(node) === "actions"), `${id}: the actions are in the foot`);
        // What keeps an entry from running is said beside the actions it explains.
        assert.equal(find(foot, node => node.props?.role === "alert") !== null, id === "llm", id);
        assert.equal(find(blocks[1], node => node.type === "button"), null, `${id}: the facts hold no action`);
    }
    // A shipped entry is its head alone.
    const shipped = cards.get("shipped");
    assert.ok(shipped);
    assert.equal(classOf(shipped.props.children), "card_head");
});

test("a group's help is its heading's hint on a page that shows hints, a line under the heading elsewhere", async context => {
    for (const hints of [false, true]) {
        const { groups } = await catalog(context, hints);
        assert.equal(groups.length, 2);
        const lines = groups.flatMap(group => nodesIn(group).filter(node => node.type === "p").map(node => node.props.children));
        const marks = groups.flatMap(group => nodesIn(group).filter(node => node.type === "hint").map(node => node.props.text));
        const help = ["translation_catalog.group_help.engine", "translation_catalog.group_help.api"];
        assert.deepEqual(marks, hints ? help : []);
        assert.deepEqual(help.map(text => lines.includes(text)), hints ? [false, false] : [true, true]);
        assert.deepEqual(groups.map(group => nodesIn(group).filter(node => node.type === "h3").length), [1, 1]);
    }
});
