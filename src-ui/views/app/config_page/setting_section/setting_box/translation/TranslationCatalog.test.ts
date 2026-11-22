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

// What the drawn section reads: the catalog, and the local weights the model list shows (#565).
let shownCatalog: TranslationCatalog = CATALOG;
let listed: ReadonlySet<string> = new Set(["shipped"]);

// The catalog's groups and cards, each drawn on its own. hints: whether the page shows
// descriptions as hints (HintDescriptions).
async function catalog(context: TestContext, hints = false, layout = "list") {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const heading = await loadModule<typeof import("../advanced_settings/catalogHeading.tsx")>(
        new URL("../advanced_settings/catalogHeading.tsx", import.meta.url), runtime, { "../_components/hint/Hint": { Hint: "hint" } });
    const module = await loadModule<typeof import("./TranslationCatalog.tsx")>(new URL("./TranslationCatalog.tsx", import.meta.url), runtime, {
        "../../../../../../logics/translation/useTranslationCatalog": { useTranslationCatalog: () => ({ catalog: shownCatalog, error: null, pending: null, send: () => {} }) },
        "../../../../../../logics/translation/useListedLocalWeights": { useListedLocalWeights: () => listed },
        "../../../../../../logics/translation/translationCatalog": translationCatalog,
        "../../../../../../logics/common/endpointPrivacy": { endpointDescription: () => "" },
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { useHintDescriptions: () => hints },
        "../_components/fold/Fold": { Fold: "fold" },
        "../advanced_settings/catalogHeading": heading,
        "../advanced_settings/catalogLayout": { CatalogSection: "catalog-section", useCatalogLayout: () => layout, CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch" },
        "./TranslationLlamaRuntimes": { TranslationLlamaRuntimes: "llama-runtimes" },
    });
    // One component at a time: each is drawn from scratch, so no state of the last one is read.
    const drawn = (node: TreeNode) => { runtime.remount(); return drawWith(runtime, node); };
    const groups = nodesIn(runtime.render(module.TranslationCatalogSection)).filter(node => componentName(node) === "CatalogGroup").map(drawn);
    const cards = groups.flatMap(group => nodesIn(group).filter(node => ["EntryCard", "ShippedCard"].includes(componentName(node) ?? "")).map(drawn));
    const forms = groups.flatMap(group => nodesIn(group).filter(node => ["EngineForm", "ApiForm"].includes(componentName(node) ?? "")).map(drawn));
    return { groups, forms, section: runtime.render(module.TranslationCatalogSection), cards: new Map(cards.map(card => [String(card.props["data-catalog-item"]), card])) };
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

test("in the grid a card's first line is its name and its state, and its marks are the line under it", async context => {
    const { cards } = await catalog(context, false, "grid");
    for (const id of ["shipped", "mine"]) {
        const card = cards.get(id);
        assert.ok(card, id);
        const headLine = findIn(card, node => classOf(node) === "card_head");
        assert.deepEqual([headLine.props.children].flat().filter(Boolean).map(node => node.type === "strong" ? "name" : classOf(node)),
            ["name", "badge status"], id);
        const marks = findIn(card, node => classOf(node) === "card_badges");
        assert.ok(nodesIn(marks).some(node => classOf(node) === "badge"), `${id}: its kind under the name`);
    }
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
    assert.deepEqual([shipped.props.children].flat().filter(Boolean).map(classOf), ["card_head"]);
});

test("an entry's state badge names its state, so whether it is on the PC is drawn by its shape and mark", async context => {
    const { cards } = await catalog(context);
    const state = (id: string) => findIn(cards.get(id), node => classOf(node) === "badge status").props["data-tone"];
    // Not downloaded yet (an outline with an empty ring), can be used (filled, with a check), in use.
    assert.deepEqual(["shipped", "cloud", "mine"].map(state), ["not_downloaded", "ready", "in_use"]);
});

test("each group is a part of the catalog, folded, with what it is for and how many entries it has", async context => {
    const { groups } = await catalog(context);
    assert.equal(groups.length, 2);
    // The part (catalogLayout.tsx's CatalogSection) shows what the group is for as its name's hint
    // or a line, as the page keeps descriptions (catalogLayout.test.ts).
    const parts = groups.map(group => findIn(group, node => node.type === "catalog-section").props);
    assert.deepEqual(parts.map(part => [part.title, part.level, part["data-catalog-group"], part.help, part.readout]), [
        ["translation_catalog.group.engine", 3, "engine", ["translation_catalog.group_help.engine"], "translation_catalog.group_readout"],
        ["translation_catalog.group.api", 3, "api", ["translation_catalog.group_help.api"], "translation_catalog.group_readout"],
    ]);
});

test("the catalog lists a built-in model as the model list does, by the download catalog's name of it (#565)", async context => {
    // Test data: two built-in models; the model list shows only the one the user can get. An
    // entry the user added is listed whatever the list shows.
    shownCatalog = unchecked<TranslationCatalog>({
        engine: [
            { id: "m2m100_418M-ct2-int8", weight: "m2m100_418M-ct2-int8", origin: "builtin", name: "m2m100_418M-ct2-int8", runtime: "onnx", available: false, in_use: true },
            { id: "m2m100_1.2B-ct2-int8", weight: "m2m100_1.2B-ct2-int8", origin: "builtin", name: "m2m100_1.2B-ct2-int8", runtime: "onnx", available: false, in_use: false },
            { id: "mine", weight: "user:mine", origin: "user", name: "Mine", runtime: "onnx", folder: "C:\\Models\\mine", languages: ["ja"], available: true, in_use: false },
        ],
        api: [], runtimes: ["onnx"], protocols: ["openai_compatible"],
    });
    listed = new Set(["m2m100_418M-ct2-int8"]);
    context.onTestFinished(() => { shownCatalog = CATALOG; listed = new Set(["shipped"]); });
    const { cards } = await catalog(context);
    assert.deepEqual([...cards.keys()], ["mine", "m2m100_418M-ct2-int8"], "the model the list leaves out is not a card either");
    const name = (id: string) => {
        const card = cards.get(id);
        assert.ok(card, id);
        return findIn(head(card), node => node.type === "strong").props.children;
    };
    assert.equal(name("m2m100_418M-ct2-int8"), "M2M100 418M · int8");
    assert.equal(name("mine"), "Mine");
});

// #614: what the catalog holds is its heading's hint, and what to fill in is each form's title
// hint, on a page that keeps descriptions out of sight. Whose model it is and what an API is sent
// stay in view, read before adding. Elsewhere the descriptions are lines, as before.
test("the catalog's and its forms' descriptions are hints; the warnings stay in view", async context => {
    const lines = (tree: TreeNode) => nodesIn(tree).filter(node => node.type === "p").map(node => node.props.children)
        .filter((word): word is string => typeof word === "string");
    const hinted = await catalog(context, true);
    const label = findIn(hinted.section, node => node.type === "section-label");
    assert.equal(label.props.desc, "translation_catalog.intro");
    assert.ok(!lines(hinted.section).includes("translation_catalog.intro"));
    assert.equal(hinted.forms.length, 2);
    const [engine, api] = hinted.forms;
    assert.deepEqual([engine.props.hint, api.props.hint], ["translation_catalog.add_help.engine", "translation_catalog.add_help.api"]);
    assert.deepEqual(lines(engine).filter(word => word.startsWith("translation_catalog.")), ["translation_catalog.terms_help"]);
    assert.deepEqual(lines(api).filter(word => word.startsWith("config_page.translation.llm_privacy")),
        ["config_page.translation.llm_privacy_lead", "config_page.translation.llm_privacy_desc"]);
    assert.ok(!lines(api).includes("translation_catalog.add_help.api"));
    const plain = await catalog(context, false);
    const [plainEngine, plainApi] = plain.forms;
    assert.deepEqual([plainEngine.props.hint, plainApi.props.hint], [undefined, undefined]);
    assert.ok(lines(plainEngine).includes("translation_catalog.add_help.engine"));
    assert.ok(lines(plainApi).includes("translation_catalog.add_help.api"));
});
