// What a user does with the translation catalog (#413): the groups, adding an entry of each
// group, using one and removing one, and what a card says about an API key. Until 0.6.0 a
// Playwright test drew the page in a browser (tests/voice/test_translation_catalog_ui.py); no CI
// job ran it. The page is drawn here part by part, as TranslationCatalog.test.ts draws the cards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, drawWith, find, findIn, hooks, loadModule, nodesIn, treeNode, unchecked } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import { loadBridgeRoutes } from "../../../../../../logics/test/bridgeHarness.ts";
import * as translationCatalog from "../../../../../../logics/translation/translationCatalog.ts";
import type { ApiItem, EngineItem, TranslationCatalog } from "../../../../../../logics/translation/translationCatalog.ts";
import type { PendingCatalogChange } from "../../../../../../logics/translation/useTranslationCatalog.ts";

const REGISTER = "/run/register_translation_catalog_entry";

// What the section reads of useTranslationCatalog; each test sets it and reads what was sent.
interface CatalogHook {
    catalog: TranslationCatalog | null;
    error: string | null;
    pending: PendingCatalogChange | null;
    send: (endpoint: string, data?: unknown) => void;
}
let hook: CatalogHook;
let sent: [string, unknown][];

// Test data: the entries the app ships, with only the fields the cards read.
const shippedEngine: EngineItem[] = [
    { id: "m2m100_418M-ct2-int8", weight: "m2m100_418M-ct2-int8", origin: "builtin", name: "m2m100_418M-ct2-int8", runtime: "onnx",
        non_commercial: false, available: true, in_use: true },
    { id: "nllb-200-distilled-600M-ct2-int8", weight: "nllb-200-distilled-600M-ct2-int8", origin: "builtin",
        name: "nllb-200-distilled-600M-ct2-int8", runtime: "onnx", non_commercial: true, available: false, in_use: false },
];
const shippedApi: ApiItem[] = [
    { id: "DeepL_API", origin: "builtin", name: "DeepL_API", kind: "cloud", available: false },
    { id: "Ollama", origin: "builtin", name: "Ollama", kind: "local_server", available: true },
];
const catalogWith = (engine: EngineItem[] = [], api: ApiItem[] = [], runtimes = ["onnx"]): TranslationCatalog =>
    ({ engine: [...shippedEngine, ...engine], api: [...shippedApi, ...api], runtimes, protocols: ["openai_compatible"] });

const reset = (catalog: TranslationCatalog) => {
    sent = [];
    hook = { catalog, error: null, pending: null, send: (endpoint, data) => { sent.push([endpoint, data]); } };
};
const sentTo = (endpoint: string) => sent.filter(([to]) => to === endpoint).map(([, data]) => data);

const loadSection = async (runtime: HookRuntime) => {
    const heading = await loadModule<typeof import("../advanced_settings/catalogHeading.tsx")>(
        new URL("../advanced_settings/catalogHeading.tsx", import.meta.url), runtime, { "../_components/hint/Hint": { Hint: "hint" } });
    return loadModule<typeof import("./TranslationCatalog.tsx")>(new URL("./TranslationCatalog.tsx", import.meta.url), runtime, {
        "../../../../../../logics/translation/useTranslationCatalog": { useTranslationCatalog: () => hook },
        "../../../../../../logics/translation/translationCatalog": translationCatalog,
        "../../../../../../logics/common/endpointPrivacy": { endpointDescription: () => "" },
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { useHintDescriptions: () => false },
        "../_components/fold/Fold": { Fold: "fold" },
        "../advanced_settings/catalogHeading": heading,
        "../advanced_settings/catalogLayout": { useCatalogLayout: () => "list", CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch" },
        "./TranslationLlamaRuntimes": { TranslationLlamaRuntimes: "llama-runtimes" },
    });
};

// The section, and one of its groups drawn from it.
async function section(context: TestContext) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const module = await loadSection(runtime);
    const tree = runtime.render(module.TranslationCatalogSection);
    const group = (id: "engine" | "api") => {
        const node = findIn(tree, node => componentName(node) === "CatalogGroup" && node.props.group === id, `the ${id} group`);
        runtime.remount();
        return drawWith(runtime, node);
    };
    return { runtime, tree, group };
}

// A component of a group, drawn in a runtime of its own so it keeps its state from one draw to
// the next, as a mounted component does. The hook's values are read again at every draw.
async function mounted(context: TestContext, group: "engine" | "api", pick: (node: TreeNode) => boolean, what: string) {
    const { runtime, group: draw } = await section(context);
    const node = findIn(draw(group), pick, what);
    runtime.remount();
    const component = componentOf(node), props = node.props;
    return () => runtime.render(component, props);
}
const form = (context: TestContext, group: "engine" | "api") =>
    mounted(context, group, node => componentName(node) === (group === "engine" ? "EngineForm" : "ApiForm"), `the ${group} form`);
const card = (context: TestContext, group: "engine" | "api", id: string) =>
    mounted(context, group, node => componentName(node) === "EntryCard" && node.props.item.id === id, `the card of ${id}`);

// The words a tree shows (translation keys here), in order.
function textOf(value: unknown): string {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(" ");
    const node = treeNode(value);
    return node ? textOf(node.props?.children) : "";
}
const labelled = (tree: TreeNode, key: string) => {
    const label = findIn(tree, node => node.type === "label" && textOf(node).startsWith(key), `the field ${key}`);
    return findIn(label, node => node.type === "input" || node.type === "select", `the control of ${key}`);
};
const type = (tree: TreeNode, key: string, value: string) => labelled(tree, key).props.onChange({ target: { value } });
const button = (tree: TreeNode, key: string) => findIn(tree, node => node.type === "button" && textOf(node) === key, `the button ${key}`);
const alerts = (tree: TreeNode) => nodesIn(tree).filter(node => node.props?.role === "alert").map(textOf);
// Enter in a field of the form, as a keyboard user adds an entry.
const pressEnter = (tree: TreeNode) => findIn(tree, node => node.props?.role === "group").props.onKeyDown(
    { key: "Enter", target: { tagName: "INPUT" }, preventDefault: () => {} });
// The backend answers the form's own request: without a refusal, or with one.
const answer = (draw: () => TreeNode, group: "engine" | "api", error: string | null = null) => {
    hook.pending = { endpoint: REGISTER, id: null, group };
    draw();
    hook.pending = null;
    hook.error = error;
    draw();
    return draw();
};

test("each group says when nothing was added, and keeps the entries the app ships folded with what they are", async context => {
    reset(catalogWith());
    const { runtime, group } = await section(context);
    assert.deepEqual(sent, [["/get/data/translation_catalog", undefined]], "the section asks for the catalog when it opens");
    for (const id of ["engine", "api"] as const) {
        const drawn = group(id);
        assert.ok(textOf(drawn).includes("translation_catalog.none_added"), id);
        // A bar of the app's one fold, named by its summary.
        const fold = findIn(drawn, node => node.type === "fold" && node.props.summary === "translation_catalog.shipped_title", `${id}: the fold`);
        const cards = nodesIn(fold).filter(node => componentName(node) === "ShippedCard").map(node => { runtime.remount(); return drawWith(runtime, node); });
        assert.equal(cards.length, 2, id);
        for (const shipped of cards) assert.ok(textOf(shipped).includes("translation_catalog.badge.builtin"), id);
    }
    const shipped = (id: string) => {
        const drawn = group(shippedEngine.some(item => item.id === id) ? "engine" : "api");
        const node = findIn(drawn, node => componentName(node) === "ShippedCard" && node.props.item.id === id, id);
        runtime.remount();
        return drawWith(runtime, node);
    };
    assert.ok(textOf(shipped("nllb-200-distilled-600M-ct2-int8")).includes("translation_catalog.badge.non_commercial"));
    assert.ok(!textOf(shipped("m2m100_418M-ct2-int8")).includes("translation_catalog.badge.non_commercial"));
    assert.ok(textOf(shipped("Ollama")).includes("translation_catalog.kind.local_server"));
    assert.ok(textOf(shipped("DeepL_API")).includes("translation_catalog.kind.cloud"));
});

test("an engine entry is not sent without a name; Enter sends it once, cleaned, and the form empties after the answer", async context => {
    reset(catalogWith());
    const draw = await form(context, "engine");
    button(draw(), "translation_catalog.add_do").props.onClick();
    assert.deepEqual(alerts(draw()), ["translation_catalog.problem.name_missing"]);
    assert.deepEqual(sentTo(REGISTER), []);
    type(draw(), "translation_catalog.field.name", "My NLLB");
    type(draw(), "translation_catalog.field.folder", '"C:\\Models\\nllb 1.3B"');
    type(draw(), "translation_catalog.field.languages", "ja, en");
    pressEnter(draw());
    assert.deepEqual(sentTo(REGISTER), [{ group: "engine", name: "My NLLB", runtime: "onnx", folder: "C:\\Models\\nllb 1.3B", languages: ["ja", "en"] }]);
    assert.deepEqual(alerts(draw()), []);
    // While the answer is awaited, nothing in the form can be changed or sent again.
    hook.pending = { endpoint: REGISTER, id: null, group: "engine" };
    assert.equal(labelled(draw(), "translation_catalog.field.name").props.disabled, true);
    assert.equal(button(draw(), "translation_catalog.add_do").props.disabled, true);
    const done = answer(draw, "engine");
    for (const key of ["translation_catalog.field.name", "translation_catalog.field.folder", "translation_catalog.field.languages"])
        assert.equal(labelled(done, key).props.value, "", key);
});

test("an added engine entry is the user's, names its languages, is used with one press and cannot be removed while in use", async context => {
    const mine: EngineItem = { id: "tr-1", weight: "user:tr-1", origin: "user", name: "My NLLB", runtime: "onnx",
        folder: "C:\\Models\\nllb 1.3B", languages: ["ja", "en"], available: true, in_use: false };
    reset(catalogWith([mine]));
    const draw = await card(context, "engine", "tr-1");
    const ready = draw();
    assert.ok(textOf(ready).includes("translation_catalog.badge.user"));
    assert.ok(textOf(ready).includes("ja, en"));
    assert.equal(button(ready, "translation_catalog.remove").props.disabled, false);
    button(ready, "translation_catalog.use.engine").props.onClick();
    assert.deepEqual(sentTo("/run/use_translation_catalog_entry"), [{ id: "tr-1" }]);

    reset(catalogWith([{ ...mine, in_use: true }]));
    const inUse = (await card(context, "engine", "tr-1"))();
    assert.equal(find(inUse, node => node.type === "button" && textOf(node) === "translation_catalog.use.engine"), null);
    assert.equal(button(inUse, "translation_catalog.remove").props.disabled, true);
    assert.ok(textOf(inUse).includes("translation_catalog.remove_in_use"));
});

test("a translation LLM asks for its .gguf file and device, and its card waits for llama.cpp's server (ADR-015)", async context => {
    reset(catalogWith([], [], ["onnx", "llamacpp"]));
    const draw = await form(context, "engine");
    assert.equal(find(draw(), node => node.type === "label" && textOf(node).startsWith("translation_catalog.field.device")), null);
    type(draw(), "translation_catalog.field.runtime", "llamacpp");
    const llm = draw();
    assert.ok(textOf(llm).includes("translation_catalog.add_help.engine_llamacpp"));
    assert.equal(find(llm, node => node.type === "label" && textOf(node).startsWith("translation_catalog.field.folder")), null);
    assert.deepEqual(nodesIn(labelled(llm, "translation_catalog.field.device")).filter(node => node.type === "option").map(node => node.props.value),
        ["auto", "cpu"]);
    type(draw(), "translation_catalog.field.name", "TranslateGemma 4B");
    type(draw(), "translation_catalog.field.file", "C:\\Models\\translategemma");
    button(draw(), "translation_catalog.add_do").props.onClick();
    assert.deepEqual(alerts(draw()), ["translation_catalog.problem.file_missing"]);
    assert.deepEqual(sentTo(REGISTER), []);
    type(draw(), "translation_catalog.field.file", '"C:\\Models\\translategemma-4b-it.Q4_K_M.gguf"');
    type(draw(), "translation_catalog.field.device", "cpu");
    button(draw(), "translation_catalog.add_do").props.onClick();
    assert.deepEqual(sentTo(REGISTER), [{ group: "engine", name: "TranslateGemma 4B", runtime: "llamacpp",
        file: "C:\\Models\\translategemma-4b-it.Q4_K_M.gguf", languages: [], device: "cpu" }]);

    reset(catalogWith([{ id: "tr-1", weight: "user:tr-1", origin: "user", name: "TranslateGemma 4B", runtime: "llamacpp",
        file: "C:\\Models\\translategemma-4b-it.Q4_K_M.gguf", device: "cpu", languages: [], available: false, server_ready: false, in_use: false }],
    [], ["onnx", "llamacpp"]));
    const waiting = (await card(context, "engine", "tr-1"))();
    assert.equal(waiting.props["data-status"], "no_server");
    for (const key of ["translation_catalog.fact.file", "translation_catalog.device.cpu"]) assert.ok(textOf(waiting).includes(key), key);
    assert.deepEqual(alerts(waiting), ["translation_catalog.state_help.no_server"]);
    assert.equal(button(waiting, "translation_catalog.use.engine").props.disabled, true);
});

test("an API entry asks for its key, keeps what was typed when the backend refuses it, and empties the key once added", async context => {
    reset(catalogWith());
    const draw = await form(context, "api");
    type(draw(), "translation_catalog.field.name", "Home server");
    type(draw(), "translation_catalog.field.url", "http://192.168.1.5:8000/v1");
    button(draw(), "translation_catalog.add_do").props.onClick();
    assert.deepEqual(alerts(draw()), ["translation_catalog.problem.key_missing"]);
    type(draw(), "translation_catalog.field.key", " secret-key ");
    button(draw(), "translation_catalog.add_do").props.onClick();
    const request = { group: "api", name: "Home server", protocol: "openai_compatible", url: "http://192.168.1.5:8000/v1", model: "", auth_key: "secret-key" };
    assert.deepEqual(sentTo(REGISTER), [request]);
    // A refusal: what was typed stays, the key included, and the section says why.
    const refused = answer(draw, "api", "translation_catalog_url_invalid");
    assert.equal(labelled(refused, "translation_catalog.field.name").props.value, "Home server");
    assert.equal(labelled(refused, "translation_catalog.field.key").props.value, " secret-key ");
    const { tree } = await section(context);
    assert.ok(alerts(tree).some(text => text.startsWith("translation_catalog.errors.translation_catalog_url_invalid")));
    // Added: the key is gone from the form, and only the fact that it is kept is shown.
    button(draw(), "translation_catalog.add_do").props.onClick();
    assert.deepEqual(sentTo(REGISTER), [request, request]);
    const added = answer(draw, "api");
    assert.equal(labelled(added, "translation_catalog.field.key").props.value, "");
    assert.equal(labelled(added, "translation_catalog.field.key").props.type, "password");

    reset(catalogWith([], [{ id: "tr-1", origin: "user", name: "Home server", protocol: "openai_compatible",
        url: "http://192.168.1.5:8000/v1", model: "", has_key: true, key_in_memory: false, in_use: false }]));
    const kept = (await card(context, "api", "tr-1"))();
    for (const key of ["translation_catalog.key_kept", "translation_catalog.model_first"]) assert.ok(textOf(kept).includes(key), key);
});

test("removing an entry asks first; going back sends nothing", async context => {
    reset(catalogWith([], [{ id: "tr-1", origin: "user", name: "Home server", protocol: "openai_compatible",
        url: "http://192.168.1.5:8000/v1", model: "", has_key: true, key_in_memory: false, in_use: true }]));
    const draw = await card(context, "api", "tr-1");
    button(draw(), "translation_catalog.remove").props.onClick();
    const confirm = findIn(draw(), node => node.props?.["aria-label"] === "translation_catalog.remove_confirm_label", "the confirmation");
    assert.ok(textOf(confirm).includes("translation_catalog.remove_confirm.api"));
    button(confirm, "translation_catalog.back").props.onClick();
    assert.equal(find(draw(), node => node.props?.["aria-label"] === "translation_catalog.remove_confirm_label"), null);
    assert.deepEqual(sentTo("/run/remove_translation_catalog_entry"), []);
    button(draw(), "translation_catalog.remove").props.onClick();
    button(draw(), "translation_catalog.remove_do").props.onClick();
    assert.deepEqual(sentTo("/run/remove_translation_catalog_entry"), [{ id: "tr-1" }]);
});

test("an API entry whose key the store did not take says how long the key lasts, and one whose key was lost says what to do", async context => {
    const home: ApiItem = { id: "tr-1", origin: "user", name: "Home server", protocol: "openai_compatible",
        url: "http://192.168.1.5:8000/v1", model: "", has_key: false, key_in_memory: true, in_use: false };
    reset(catalogWith([], [home]));
    const held = (await card(context, "api", "tr-1"))();
    for (const key of ["translation_catalog.key_memory", "translation_catalog.key_memory_help"]) assert.ok(textOf(held).includes(key), key);
    assert.ok(!textOf(held).includes("translation_catalog.key_kept"));
    assert.equal(button(held, "translation_catalog.use.api").props.disabled, false);

    // The app was closed before the store took the key: the entry stays, without a key.
    reset(catalogWith([], [{ ...home, key_in_memory: false }]));
    const lost = (await card(context, "api", "tr-1"))();
    assert.ok(textOf(lost).includes("translation_catalog.key_none"));
    assert.deepEqual(alerts(lost), ["translation_catalog.state_help.no_key"]);
    assert.equal(button(lost, "translation_catalog.use.api").props.disabled, true);
    assert.equal(button(lost, "translation_catalog.remove").props.disabled, false);
});

test("the catalog hook makes one change at a time, keeps the answer and the code of a refusal", async () => {
    const runtime = hooks(), transport: [string, unknown][] = [];
    const module = await loadModule<typeof import("../../../../../../logics/translation/useTranslationCatalog.ts")>(
        new URL("../../../../../../logics/translation/useTranslationCatalog.ts", import.meta.url), runtime, {
            "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string, data?: unknown) => { transport.push([endpoint, data]); return true; } }) },
        });
    const use = () => runtime.render(module.useTranslationCatalog);
    await use().send("/get/data/translation_catalog");
    assert.equal(use().pending, null, "a read waits for nothing");
    await use().send("/run/use_translation_catalog_entry", { id: "tr-1" });
    assert.deepEqual(use().pending, { endpoint: "/run/use_translation_catalog_entry", id: "tr-1", group: null });
    await use().send("/run/remove_translation_catalog_entry", { id: "tr-2" });
    assert.deepEqual(transport.map(([endpoint]) => endpoint), ["/get/data/translation_catalog", "/run/use_translation_catalog_entry"],
        "a second change waits for the first one's answer");
    const answered = catalogWith();
    use().acknowledge(answered);
    assert.equal(use().catalog, answered);
    assert.deepEqual([use().pending, use().error], [null, null]);
    await use().send(REGISTER, { group: "api" });
    use().fail("translation_catalog_url_invalid");
    assert.deepEqual([use().pending, use().error], [null, "translation_catalog_url_invalid"]);
    // An answer without the two groups is not a catalog.
    use().updateCatalog(unchecked<TranslationCatalog>({ engine: [] }));
    assert.equal(use().catalog, answered);
});

test("an entry added, used or removed makes the page read the translation settings it may have changed", async () => {
    const reads = ["/get/data/selectable_ctranslate2_weight_type_dict", "/get/data/selected_ctranslate2_weight_type",
        "/get/data/openai_compatible_url", "/get/data/openai_compatible_auth_key",
        "/get/data/selectable_openai_compatible_model_list", "/get/data/selected_openai_compatible_model"];
    for (const endpoint of [REGISTER, "/run/use_translation_catalog_entry", "/run/remove_translation_catalog_entry"]) {
        const routes = await loadBridgeRoutes();
        routes.receiveRoutes({ endpoint, status: 400, result: { error_code: "translation_catalog_failed" } });
        assert.deepEqual(routes.reads.filter(read => reads.includes(read)), [], `${endpoint}: a refusal changed nothing`);
        routes.receiveRoutes({ endpoint, status: 200, result: catalogWith() });
        assert.deepEqual(routes.reads.filter(read => reads.includes(read)), reads, endpoint);
    }
});

test("on the translation page the catalog is a section of its own after More settings, not inside it (#597)", () => {
    const page = readFileSync(new URL("./Translation.tsx", import.meta.url), "utf8");
    const advanced = page.indexOf("</AdvancedSection>"), catalog = page.indexOf("<TranslationCatalogSection />");
    assert.ok(advanced > 0 && catalog > advanced, "the catalog comes after the More settings fold");
    assert.equal(page.indexOf("<TranslationCatalogSection />", catalog + 1), -1, "the catalog is drawn once");
});
