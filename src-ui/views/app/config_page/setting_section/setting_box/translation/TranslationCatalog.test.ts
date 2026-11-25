import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, drawWith, find, findIn, hooks, loadModule, nodesIn, unchecked, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as translationCatalog from "../../../../../../logics/translation/translationCatalog.ts";
import type { TranslationCatalog } from "../../../../../../logics/translation/translationCatalog.ts";
import * as endpointPrivacy from "../../../../../../logics/common/endpointPrivacy.ts";

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
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { useHintDescriptions: () => hints },
        "../_components/fold/Fold": { Fold: "fold" },
        "../_components/lead/Lead": { Lead: "lead" },
        "../advanced_settings/catalogHeading": heading,
        "../advanced_settings/catalogLayout": { CatalogSection: "catalog-section", useCatalogLayout: () => layout, CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch",
            CatalogState: "catalog-state" },
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
// A part of a card by name: the kit's Card parts, the catalogs' state badge, or the class of a part of its own.
const KIT_PARTS = new Map<unknown, string>([[kitStandIns.CardHeader, "CardHeader"], [kitStandIns.CardTitle, "CardTitle"],
    [kitStandIns.CardContent, "CardContent"], [kitStandIns.CardFooter, "CardFooter"], ["catalog-state", "state"]]);
const partOf = (node: TreeNode) => KIT_PARTS.get(node.type) ?? classOf(node);

test("every card of the translation catalog ends its name's line with the state, as the model catalog's cards do", async context => {
    const { cards } = await catalog(context);
    assert.deepEqual([...cards.keys()], ["mine", "llm", "shipped", "home", "cloud"]);
    for (const [id, card] of cards) {
        const parts: (TreeNode | false | null | undefined)[] = [head(card).props.children].flat();
        const shown = parts.filter((part): part is TreeNode => typeof part === "object" && part !== null);
        assert.equal(partOf(shown[0]), "CardTitle", id);
        assert.equal(partOf(shown.at(-1) ?? shown[0]), "state", `${id}: the state is the last part of the head`);
        assert.equal(shown.filter(part => partOf(part) === "state").length, 1, id);
    }
    // Each is the kit's Card, an item of the list; the entry in use is told by its frame.
    assert.deepEqual([...cards].map(([id, card]) => [id, card.type, card.props.as, card.props.active, card.props["data-status"]]), [
        ["mine", kitStandIns.Card, "li", true, "in_use"], ["llm", kitStandIns.Card, "li", false, "no_server"],
        ["shipped", kitStandIns.Card, "li", false, "not_downloaded"], ["home", kitStandIns.Card, "li", false, "ready"],
        ["cloud", kitStandIns.Card, "li", false, "ready"]]);
    // An entry the user added takes the focus the page points at and is named; a shipped one is its head alone.
    assert.deepEqual([...cards].map(([id, card]) => [id, card.props.tabIndex, card.props.role, card.props["aria-label"]]), [
        ["mine", -1, "group", "Mine"], ["llm", -1, "group", "LLM"], ["shipped", undefined, undefined, undefined],
        ["home", -1, "group", "Home"], ["cloud", undefined, undefined, undefined]]);
    // The "added by you" mark is on the name's line in the list, once.
    const own = (node: TreeNode) => nodesIn(node).filter(badge => badge.type === kitStandIns.Badge && badge.props.children === "translation_catalog.badge.user")
        .map(badge => `${badge.props.tone} ${badge.props.variant}`);
    for (const id of ["mine", "llm", "home"]) {
        const card = cards.get(id);
        assert.ok(card, id);
        assert.deepEqual([own(head(card)), own(card)], [["strong dashed"], ["strong dashed"]], id);
    }
});

test("in the grid a card's first line is its name and its state, and its marks are the line under it", async context => {
    const { cards } = await catalog(context, false, "grid");
    for (const id of ["shipped", "mine"]) {
        const card = cards.get(id);
        assert.ok(card, id);
        const headLine = findIn(card, node => classOf(node) === "card_head");
        assert.deepEqual([headLine.props.children].flat().filter(Boolean).map(partOf), ["CardTitle", "state"], id);
        const marks = findIn(card, node => classOf(node) === "card_badges");
        assert.ok(nodesIn(marks).some(node => node.type === kitStandIns.Badge), `${id}: its kind under the name`);
        // An entry the user added says so under its name in the grid, with the dashed edge, and not on the name's line.
        const own = (node: TreeNode) => nodesIn(node).filter(badge => badge.type === kitStandIns.Badge && badge.props.children === "translation_catalog.badge.user")
            .map(badge => `${badge.props.tone} ${badge.props.variant}`);
        assert.deepEqual([own(headLine), own(marks)], id === "mine" ? [[], ["strong dashed"]] : [[], []], id);
    }
});

test("an added entry's card is what it is, its facts, then its notes and actions", async context => {
    const { cards } = await catalog(context);
    for (const id of ["mine", "llm", "home"]) {
        const card = cards.get(id);
        assert.ok(card, id);
        const blocks: TreeNode[] = [card.props.children].flat();
        // The facts are the catalogs' own part (catalogLayout.tsx): beside in the list, folded in the grid.
        const block = (node: TreeNode) => node.type === "catalog-facts" ? `catalog-facts > ${classOf(node.props.children)}` : partOf(node);
        assert.deepEqual(blocks.map(block), ["CardHeader", "catalog-facts > facts", "CardFooter"], id);
        const foot = blocks[2];
        assert.ok(find(foot, node => classOf(node) === "actions"), `${id}: the actions are in the foot`);
        // What keeps an entry from running is said beside the actions it explains.
        assert.equal(find(foot, node => node.props?.role === "alert") !== null, id === "llm", id);
        assert.equal(find(blocks[1], node => node.type === "button" || node.type === kitStandIns.Button), null, `${id}: the facts hold no action`);
    }
    // A shipped entry is its head alone.
    const shipped = cards.get("shipped");
    assert.ok(shipped);
    assert.deepEqual([shipped.props.children].flat().filter(Boolean).map(classOf), ["card_head"]);
});

test("an entry's state badge names its state, so whether it is on the PC is drawn by its shape and mark", async context => {
    const { cards } = await catalog(context);
    // The catalogs' state badge (catalogLayout.tsx's CatalogState) draws each state's look.
    const state = (id: string) => findIn(cards.get(id), node => node.type === "catalog-state").props;
    // Not downloaded yet (an outline with an empty ring), can be used (a check), in use (filled, with a check),
    // and an entry that cannot run as it is, drawn as a problem; the words name the entry's own state.
    assert.deepEqual(["shipped", "cloud", "mine", "llm"].map(id => [state(id).state, state(id).children]), [
        ["not_downloaded", "translation_catalog.state.not_downloaded"], ["ready", "translation_catalog.state.ready"],
        ["in_use", "translation_catalog.state.in_use"], ["missing", "translation_catalog.state.no_server"]]);
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
        return findIn(head(card), node => node.type === kitStandIns.CardTitle).props.children;
    };
    assert.equal(name("m2m100_418M-ct2-int8"), "M2M100 418M · int8");
    // The built-in model in use carries the active frame, as an entry the user added does.
    const used = cards.get("m2m100_418M-ct2-int8");
    assert.deepEqual([used?.props["data-status"], used?.props.active], ["in_use", true]);
    assert.equal(name("mine"), "Mine");
});

// #614, #1112: what the catalog holds is its heading's hint, and what to fill in (including
// provenance/terms for user-added models) is each form's title hint on a page that keeps
// descriptions out of sight. What an API is sent stays one sentence in view with its details as
// its hint, read before adding. Elsewhere the descriptions are lines, as before.
test("the catalog's and its forms' descriptions are hints; the API privacy leads stay in view", async context => {
    const lines = (tree: TreeNode) => nodesIn(tree).filter(node => node.type === "p").map(node => node.props.children)
        .filter((word): word is string => typeof word === "string");
    const hinted = await catalog(context, true);
    const label = findIn(hinted.section, node => node.type === "section-label");
    assert.equal(label.props.desc, "translation_catalog.intro");
    assert.ok(!lines(hinted.section).includes("translation_catalog.intro"));
    assert.equal(hinted.forms.length, 2);
    const [engine, api] = hinted.forms;
    assert.deepEqual([engine.props.hint, api.props.hint], [
        "translation_catalog.add_help.engine\ntranslation_catalog.terms_help",
        "translation_catalog.add_help.api",
    ]);
    assert.deepEqual(lines(engine).filter(word => word.startsWith("translation_catalog.")), []);
    // What an API is sent: one sentence in view and its details as its hint, as everywhere else (decided in #951).
    const lead = findIn(api, node => node.type === "lead");
    assert.deepEqual([lead.props.text, lead.props.details], ["config_page.translation.llm_privacy_lead", "config_page.translation.llm_privacy_desc"]);
    assert.ok(!lines(api).some(word => word.startsWith("config_page.translation.llm_privacy")), "not as lines of their own");
    assert.ok(!lines(api).includes("translation_catalog.add_help.api"));
    const plain = await catalog(context, false);
    const [plainEngine, plainApi] = plain.forms;
    assert.deepEqual([plainEngine.props.hint, plainApi.props.hint], [undefined, undefined]);
    assert.ok(lines(plainEngine).includes("translation_catalog.add_help.engine"));
    assert.ok(lines(plainEngine).includes("translation_catalog.terms_help"));
    assert.ok(lines(plainApi).includes("translation_catalog.add_help.api"));
});

// What the API's address sends is one sentence in view, with what the address may be and that it is
// checked as its hint (#614, the lead's form). Plain HTTP on the LAN adds its warning, in view.
test("the API form's address says what it sends in one sentence, and warns of plain HTTP on the LAN", async context => {
    const hinted = await catalog(context, true);
    const api = hinted.forms[1];
    const lead = findIn(api, node => node.type === "lead" && node.props.text === "translation_catalog.url_lead");
    assert.equal(lead.props.details, "translation_catalog.url_details");
    const url = findIn(api, node => node.type === kitStandIns.TextField && node.props.type === "url");
    assert.equal(url.props["aria-describedby"], lead.props.id);
    assert.ok(!nodesIn(api).some(node => node.props?.role === "note"), "no warning for an empty address");
});

test("when a group has no user-added entries, its empty state names that group's add action (#1113)", async context => {
    shownCatalog = unchecked<TranslationCatalog>({
        engine: [{ id: "shipped", weight: "shipped", origin: "builtin", name: "Shipped", runtime: "onnx", available: true, in_use: false }],
        api: [{ id: "cloud", origin: "builtin", name: "Cloud", kind: "cloud", available: true }],
        runtimes: ["onnx"], protocols: ["openai_compatible"],
    });
    context.onTestFinished(() => { shownCatalog = CATALOG; });
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const heading = await loadModule<typeof import("../advanced_settings/catalogHeading.tsx")>(
        new URL("../advanced_settings/catalogHeading.tsx", import.meta.url), runtime, { "../_components/hint/Hint": { Hint: "hint" } });
    const module = await loadModule<typeof import("./TranslationCatalog.tsx")>(new URL("./TranslationCatalog.tsx", import.meta.url), runtime, {
        "../../../../../../logics/translation/useTranslationCatalog": { useTranslationCatalog: () => ({ catalog: shownCatalog, error: null, pending: null, send: () => {} }) },
        "../../../../../../logics/translation/useListedLocalWeights": { useListedLocalWeights: () => listed },
        "../../../../../../logics/translation/translationCatalog": translationCatalog,
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "@useI18n": { useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }) },
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { useHintDescriptions: () => true },
        "../_components/fold/Fold": { Fold: "fold" },
        "../_components/lead/Lead": { Lead: "lead" },
        "../advanced_settings/catalogHeading": heading,
        "../advanced_settings/catalogLayout": { CatalogSection: "catalog-section", useCatalogLayout: () => "list", CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch",
            CatalogState: "catalog-state" },
        "./TranslationLlamaRuntimes": { TranslationLlamaRuntimes: "llama-runtimes" },
    });
    const groups = nodesIn(runtime.render(module.TranslationCatalogSection))
        .filter(node => componentName(node) === "CatalogGroup")
        .map(node => { runtime.remount(); return drawWith(runtime, node); });
    const emptyLines = groups.map(group => findIn(group, node => node.type === "p").props.children);
    assert.deepEqual(emptyLines, [
        'translation_catalog.none_added:{"add":"translation_catalog.add.engine"}',
        'translation_catalog.none_added:{"add":"translation_catalog.add.api"}',
    ]);
});
