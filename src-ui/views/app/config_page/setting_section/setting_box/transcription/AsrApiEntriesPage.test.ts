import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, find, findIn, hooks, loadModule, nodesIn, treeNode, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as transcriptionCatalog from "../../../../../../logics/transcription/transcriptionCatalog.ts";
import * as translationCatalog from "../../../../../../logics/translation/translationCatalog.ts";
import * as endpointPrivacy from "../../../../../../logics/common/endpointPrivacy.ts";

// The speech recognition APIs the user adds (AsrApiEntries.tsx): their cards and the form that adds
// one, drawn with the real rules for the requests and the cards' states and the real warning about
// plain HTTP on the LAN. The catalog hook is a stand-in that holds what the test gives and records
// what the page sends; the shared parts are stand-ins that keep their props.

// Of several keys the first in the locale is used; a key with "absent" in it is not in the locale.
const t = (key: string | string[], variables?: Record<string, unknown>) => {
    const { defaultValue, ...values } = variables ?? {};
    const found = [key].flat().find(item => !item.includes("absent"));
    if (found === undefined) return String(defaultValue ?? [key].flat().at(-1));
    return Object.keys(values).length ? `${found} ${JSON.stringify(values)}` : found;
};
const REGISTER = "/run/register_transcription_catalog_entry";
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, origin: "user", name: `API ${id}`, protocol: "openai_compatible", url: `https://${id}.example/v1`,
    model: "whisper-1", has_key: true, status: "ok", ...extra });
interface Catalog { catalog: unknown; error: string | null; pending: { endpoint: string } | null }

async function apiEntries(context: TestContext, given: Partial<Catalog> = {}, options: { layout?: string; hints?: boolean } = {}) {
    const sent: unknown[][] = [], loading = hooks(), runtimes = new Set<HookRuntime>([loading]);
    let active: HookRuntime = loading;
    context.onTestFinished(() => { for (const runtime of runtimes) runtime.unmount(); });
    const react = new Proxy(loading.api, { get: (_, key) => Reflect.get(active.api, key) });
    const state: Catalog = { catalog: { api: [], protocols: ["openai_compatible"] }, error: null, pending: null, ...given };
    const hook = { send: (...args: unknown[]) => { sent.push(args); } };
    const module = await loadModule<typeof import("./AsrApiEntries.tsx")>(new URL("./AsrApiEntries.tsx", import.meta.url), { ...loading, api: react }, {
        "@useI18n": { useI18n: () => ({ t }) },
        "../../../../../../logics/transcription/useTranscriptionCatalog": { useTranscriptionCatalog: () => ({ ...state, send: hook.send }) },
        "../../../../../../logics/transcription/transcriptionCatalog.ts": transcriptionCatalog,
        "../../../../../../logics/translation/translationCatalog.ts": translationCatalog,
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "../advanced_settings/catalogLayout": { CatalogFacts: "catalog-facts", CatalogList: "catalog-list", CatalogState: "catalog-state",
            useCatalogLayout: () => options.layout ?? "list" },
        "../_components/fold/Fold": { Fold: "fold" },
        "../_components/hint/Hint": { useHintDescriptions: () => options.hints ?? false },
        "../_components/lead/Lead": { Lead: "lead" },
    });
    // Draws one of the module's components with hook memory of its own (kept when given).
    const draw = (type: unknown, props: object = {}, runtime: HookRuntime = hooks()): TreeNode => {
        runtimes.add(runtime);
        active = runtime;
        const node = treeNode({ type, props });
        assert.ok(node);
        const drawn = treeNode(runtime.render(componentOf(node), props));
        assert.ok(drawn);
        return drawn;
    };
    const pageRuntime = hooks();
    const page = () => draw(module.AsrApiEntries, {}, pageRuntime);
    const part = (name: string) => findIn(page(), node => componentName(node) === name, name);
    // The add form, drawn with a runtime of its own that keeps what is typed.
    const formRuntime = hooks();
    const form = () => { const element = part("AddForm"); return draw(element.type, element.props, formRuntime); };
    return { state, hook, sent, draw, page, part, form };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const ofType = (tree: unknown, type: unknown) => nodesIn(tree).filter(node => node.type === type);
// A button by its words: the kit's, or one of the kit's confirmation inside a card.
const BUTTONS: unknown[] = [kitStandIns.Button, kitStandIns.InlineConfirmTrigger, kitStandIns.InlineConfirmCancel, kitStandIns.InlineConfirmAction];
const buttonNamed = (tree: unknown, words: string) => findIn(tree, node => BUTTONS.includes(node.type) && textOf(node) === words, `the button ${words}`);
const isConfirm = (node: TreeNode) => node.type === kitStandIns.InlineConfirmContent;
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);

test("the part asks for the entries when it opens and again on a new connection, and says a failure in its own words or the general ones", async context => {
    const a = await apiEntries(context, { error: "entry_exists", catalog: { api: [], protocols: [], error_code: "absent_reason" } });
    let tree = a.page();
    assert.deepEqual(a.sent, [["/get/data/transcription_catalog"]]);
    assert.equal(tree.props["data-asr-api-entries"], true);
    assert.deepEqual(ofType(tree, "p").filter(node => node.props.role === "alert").map(textOf), [`config_page.transcription.api_entries.errors.entry_exists {"code":"entry_exists"}`,
        `config_page.transcription.api_entries.errors.other {"code":"absent_reason"}`]);
    a.page();
    assert.equal(a.sent.length, 1);
    a.hook.send = (...args: unknown[]) => { a.sent.push(["new", ...args]); };
    a.page();
    assert.deepEqual(a.sent.at(-1), ["new", "/get/data/transcription_catalog"]);
    a.state.error = null;
    a.state.catalog = null;
    tree = a.page();
    assert.deepEqual(ofType(tree, "p").filter(node => node.props.role === "alert"), [], "no failure, and no catalog yet");
    assert.equal(find(tree, node => node.type === "catalog-list"), null);
    assert.deepEqual(a.part("AddForm").props.protocols, []);
});

test("each entry is a card in the catalog's list, laid out as the catalogs are", async context => {
    const a = await apiEntries(context, { catalog: { api: [item("a"), item("b")], protocols: ["openai_compatible", "deepgram"] } }, { layout: "grid" });
    const tree = a.page();
    const list = findIn(tree, node => node.type === "catalog-list");
    assert.equal(list.props.layout, "grid");
    assert.deepEqual(nodesIn(list).filter(node => componentName(node) === "EntryCard").map(node => [node.props.item.id, node.props.layout]), [["a", "grid"], ["b", "grid"]]);
    assert.deepEqual(a.part("AddForm").props.protocols, ["openai_compatible", "deepgram"]);
});

test("a card says it is the user's, its state, where it points, its model and where its key is", async context => {
    const a = await apiEntries(context);
    const draw = (entry: Record<string, unknown>, layout = "list") => {
        a.state.catalog = { api: [entry], protocols: [] };
        const element = a.part("EntryCard");
        return a.draw(element.type, { item: entry, layout });
    };
    // The badges in their order: the user's own (the kit's Badge, dashed), and the state (the catalogs' state badge).
    const badges = (node: TreeNode) => nodesIn(node).filter(badge => badge.type === kitStandIns.Badge || badge.type === "catalog-state")
        .map(badge => badge.type === "catalog-state" ? ["state", badge.props.state, textOf(badge)] : [`${badge.props.tone} ${badge.props.variant}`, textOf(badge)]);
    let shown = draw(item("a"));
    // The kit's Card, an item of the list, not the one in use.
    assert.deepEqual([shown.type, shown.props.as, shown.props.active, shown.props["data-catalog-item"], shown.props["data-status"], shown.props.tabIndex,
        shown.props.role, shown.props["aria-label"]], [kitStandIns.Card, "li", false, "a", "ready", -1, "group", "API a"]);
    assert.deepEqual(ofType(shown, kitStandIns.CardTitle).map(textOf), ["API a"]);
    assert.deepEqual(badges(shown), [["strong dashed", "translation_catalog.badge.user"], ["state", "ready", "translation_catalog.state.ready"]]);
    const facts = (node: TreeNode) => ofType(node, "div").filter(row => find(row, inner => inner.type === "dt") !== null && ofType(row, "div").length === 1)
        .map(row => [textOf(findIn(row, inner => inner.type === "dt")), textOf(findIn(row, inner => inner.type === "dd"))]);
    assert.deepEqual(facts(shown), [["translation_catalog.fact.url", "https://a.example/v1"], ["translation_catalog.fact.model", "whisper-1"], ["translation_catalog.fact.key", "translation_catalog.key_kept"]]);
    assert.equal(findIn(shown, node => node.type === "catalog-facts").props.layout, "list");
    assert.deepEqual(classesOf(findIn(shown, node => node.type === "dl")), ["facts"], "the catalogs' facts");
    assert.deepEqual(ofType(shown, "p").map(textOf), []);
    // In the grid the mark is under the name.
    assert.deepEqual(badges(draw(item("a"), "grid")), [["state", "ready", "translation_catalog.state.ready"], ["strong dashed", "translation_catalog.badge.user"]]);
    // No model: the first the server offers. A key kept only until the app closes, or none.
    shown = draw(item("b", { model: "", has_key: false, key_in_memory: true }));
    assert.deepEqual(facts(shown).slice(1), [["translation_catalog.fact.model", "translation_catalog.model_first"], ["translation_catalog.fact.key", "translation_catalog.key_memory"]]);
    assert.deepEqual(ofType(shown, "p").map(node => [node.props.role, textOf(node)]), [[undefined, "translation_catalog.key_memory_help"]]);
    shown = draw(item("c", { has_key: false }));
    assert.deepEqual([shown.props["data-status"], badges(shown)[1], facts(shown)[2][1]], ["no_key", ["state", "missing", "translation_catalog.state.no_key"], "translation_catalog.key_none"]);
    assert.deepEqual(ofType(shown, "p").map(node => [node.props.role, textOf(node)]), [["alert", "translation_catalog.state_help.no_key"]]);
    shown = draw(item("d", { status: "unsupported" }));
    assert.deepEqual([badges(shown)[1], ofType(shown, "p").map(textOf)], [["state", "unsupported", "translation_catalog.state.unsupported"], ["translation_catalog.state_help.unsupported"]]);
    shown = draw(item("e", { in_use: true }));
    // The entry in use carries the active frame.
    assert.deepEqual([shown.props.active, badges(shown)[1], ofType(shown, "p").map(textOf)], [true, ["state", "in_use", "translation_catalog.state.in_use"], []]);
});

test("Use points the custom Whisper server at a ready entry, and Remove asks first in the card", async context => {
    const a = await apiEntries(context, { catalog: { api: [item("a")], protocols: [] } });
    const element = a.part("EntryCard"), runtime = hooks();
    const card = (entry: Record<string, unknown> = item("a")) => a.draw(element.type, { item: entry, layout: "list" }, runtime);
    let shown = card();
    const use = buttonNamed(shown, "config_page.transcription.api_entries.use");
    assert.deepEqual([use.props.tone, use.props.disabled], ["primary", false]);
    // Remove takes something away: the kit's danger, here and when it asks first. It opens the
    // kit's confirmation inside the card (H-07), which returns the focus to it after the way back.
    assert.deepEqual([buttonNamed(shown, "translation_catalog.remove").type, buttonNamed(shown, "translation_catalog.remove").props.tone],
        [kitStandIns.InlineConfirmTrigger, "danger"]);
    assert.ok(find(findIn(shown, node => node.type === kitStandIns.InlineConfirm, "the root"), node => textOf(node) === "translation_catalog.remove"));
    const help = findIn(shown, node => node.type === "span" && node.props.id === use.props["aria-describedby"]);
    assert.deepEqual([help.props.hidden, textOf(help)], [true, "config_page.transcription.api_entries.use_help"]);
    use.props.onClick();
    assert.deepEqual(a.sent.at(-1), ["/run/use_transcription_catalog_entry", { id: "a" }]);
    assert.equal(buttonNamed(card(item("a", { has_key: false })), "config_page.transcription.api_entries.use").props.disabled, true, "not without a key");
    assert.equal(find(card(item("a", { in_use: true })), node => textOf(node) === "config_page.transcription.api_entries.use" && node.type === kitStandIns.Button), null);
    a.state.pending = { endpoint: "/run/remove_transcription_catalog_entry" };
    shown = card();
    assert.deepEqual([buttonNamed(shown, "config_page.transcription.api_entries.use").props.disabled, buttonNamed(shown, "translation_catalog.remove").props.disabled], [true, true]);
    a.state.pending = null;
    buttonNamed(card(), "translation_catalog.remove").props.onClick();
    shown = card();
    const confirm = findIn(shown, isConfirm);
    assert.deepEqual([confirm.props["aria-label"], ofType(confirm, kitStandIns.InlineConfirmDescription).map(textOf)],
        [`translation_catalog.remove_confirm_label {"name":"API a"}`, ["config_page.transcription.api_entries.remove_confirm"]]);
    // The way back: the kit's, plain and focused when it opens; the removal: the kit's danger one.
    assert.deepEqual([buttonNamed(confirm, "translation_catalog.back").type, buttonNamed(confirm, "translation_catalog.remove_do").type],
        [kitStandIns.InlineConfirmCancel, kitStandIns.InlineConfirmAction]);
    buttonNamed(confirm, "translation_catalog.back").props.onClick();
    assert.equal(find(card(), isConfirm), null);
    buttonNamed(card(), "translation_catalog.remove").props.onClick();
    a.state.pending = { endpoint: "/run/use_transcription_catalog_entry" };
    assert.equal(buttonNamed(card(), "translation_catalog.remove_do").props.disabled, true);
    a.state.pending = null;
    buttonNamed(card(), "translation_catalog.remove_do").props.onClick();
    assert.deepEqual(a.sent.at(-1), ["/run/remove_transcription_catalog_entry", { id: "a" }]);
    assert.equal(find(card(), isConfirm), null);
});

test("the add form names its fields, offers the protocols the backend has, and says what is sent once the entry is used", async context => {
    const a = await apiEntries(context, { catalog: { api: [], protocols: ["deepgram", "openai_compatible"] } });
    let tree = a.form();
    assert.deepEqual([tree.type, tree.props["data-catalog-add"], tree.props.summary, tree.props.hint], ["fold", "asr_api", "config_page.transcription.api_entries.add", undefined]);
    const group = findIn(tree, node => node.type === "div" && node.props.role === "group");
    assert.equal(group.props["aria-label"], "config_page.transcription.api_entries.add");
    assert.deepEqual(ofType(group, "p").map(textOf)[0], "config_page.transcription.api_entries.add_help");
    assert.deepEqual(ofType(tree, "label").map(label => [label.props.children].flat()[0]), ["translation_catalog.field.name", "translation_catalog.field.protocol",
        "translation_catalog.field.url", "translation_catalog.field.model", "translation_catalog.field.key"]);
    const [name, url, model, key] = ofType(tree, kitStandIns.TextField).map(node => node.props);
    // The kit's TextField is a text field unless it says otherwise; the address and the key are in
    // its monospaced font (#476).
    assert.deepEqual([name.type, name.mono, name.maxLength, name.spellCheck, name.placeholder, name.disabled], [undefined, undefined, translationCatalog.ENTRY_NAME_LIMIT, false,
        "config_page.transcription.api_entries.placeholder_name", false]);
    assert.deepEqual([url.type, url.mono, url.maxLength, url.spellCheck, url.placeholder], ["url", true, 2048, false, "http://192.168.1.10:8000/v1"]);
    assert.deepEqual([model.type, model.mono, model.maxLength, model.spellCheck, model.placeholder], [undefined, undefined, 200, false, "translation_catalog.placeholder.model"]);
    assert.deepEqual([key.type, key.mono, key.autoComplete, key.spellCheck, key["aria-describedby"]], ["password", true, "off", false, undefined]);
    const protocol = findIn(tree, node => node.type === kitStandIns.Select).props;
    assert.deepEqual([protocol.value, protocol.disabled], ["deepgram", false]);
    assert.deepEqual(ofType(tree, kitStandIns.SelectOption).map(option => [option.props.value, textOf(option)]), [["deepgram", "config_page.transcription.api_entries.protocol.deepgram"],
        ["openai_compatible", "config_page.transcription.api_entries.protocol.openai_compatible"]]);
    // D-14 (decided on 2026-11-25): the protocol is the kit's Select, with the kit's options.
    assert.deepEqual([...ofType(tree, "select"), ...ofType(tree, "option")], []);
    const lead = findIn(tree, node => node.type === "lead").props;
    assert.deepEqual([lead.id, lead.text, lead.details], [url["aria-describedby"], "config_page.transcription.api_entries.url_lead", "translation_catalog.url_details"]);
    const row = findIn(tree, node => node.type === "div" && find(node, inner => inner.type === kitStandIns.Button) !== null && [node.props.children].flat().length === 1);
    assert.equal(classesOf(row).length, 2, "the button's row in the control column");
    // Plain HTTP on the LAN: a note the address points to.
    ofType(tree, kitStandIns.TextField)[1].props.onChange({ target: { value: "http://192.168.1.10:8000/v1" } });
    tree = a.form();
    const warning = findIn(tree, node => node.type === "p" && node.props.role === "note");
    assert.equal(textOf(warning), "network_privacy.http_warning");
    assert.equal(ofType(tree, kitStandIns.TextField)[1].props["aria-describedby"], `${lead.id} ${warning.props.id}`);
    // One protocol or none known: nothing to choose, the default one.
    const one = await apiEntries(context, { catalog: { api: [], protocols: ["absent_kind"] } });
    const select = findIn(one.form(), node => node.type === kitStandIns.Select).props;
    assert.deepEqual([select.value, select.disabled, ofType(one.form(), kitStandIns.SelectOption).map(textOf)], ["absent_kind", true, ["absent_kind"]], "a protocol without words is named as it is");
    const none = await apiEntries(context, { catalog: { api: [], protocols: [] } });
    assert.deepEqual([findIn(none.form(), node => node.type === kitStandIns.Select).props.value, ofType(none.form(), kitStandIns.SelectOption).map(option => option.props.value)], ["openai_compatible", ["openai_compatible"]]);
    // On a page that shows descriptions as hints, what to fill in is the title's hint.
    const hinted = await apiEntries(context, {}, { hints: true });
    const fold = hinted.form();
    assert.deepEqual([fold.props.hint, ofType(findIn(fold, node => node.type === "div" && node.props.role === "group"), "p").map(textOf)],
        ["config_page.transcription.api_entries.add_help", []]);
});

test("the form refuses what cannot pass, then sends the entry, and clears only once its own request came back without a refusal", async context => {
    const a = await apiEntries(context, { catalog: { api: [], protocols: ["openai_compatible", "deepgram"] } });
    const type = (index: number, value: string) => { ofType(a.form(), kitStandIns.TextField)[index].props.onChange({ target: { value } }); };
    const problem = () => {
        const tree = a.form();
        const line = find(tree, node => node.type === "p" && node.props.role === "alert");
        return line && [textOf(line), ofType(tree, kitStandIns.TextField)[3].props["aria-describedby"] === line.props.id];
    };
    buttonNamed(a.form(), "translation_catalog.add_do").props.onClick();
    assert.deepEqual(problem(), ["translation_catalog.problem.name_missing", true]);
    type(0, " Mine ");
    type(1, "https://asr.example/v1");
    type(2, "whisper-large");
    type(3, " key ");
    findIn(a.form(), node => node.type === kitStandIns.Select).props.onChange({ target: { value: "deepgram" } });
    buttonNamed(a.form(), "translation_catalog.add_do").props.onClick();
    assert.equal(problem(), null);
    assert.deepEqual(a.sent.at(-1), [REGISTER, { name: "Mine", protocol: "deepgram", url: "https://asr.example/v1", model: "whisper-large", auth_key: "key" }]);
    // Another request finishing does not clear it; the refusal of its own keeps what was typed.
    a.state.pending = { endpoint: "/run/remove_transcription_catalog_entry" };
    a.form();
    a.state.pending = null;
    a.form();
    assert.equal(ofType(a.form(), kitStandIns.TextField)[0].props.value, " Mine ");
    a.state.pending = { endpoint: REGISTER };
    a.form();
    assert.deepEqual(ofType(a.form(), kitStandIns.TextField).map(node => node.props.disabled), [true, true, true, true], "nothing to change while it is sent");
    assert.equal(buttonNamed(a.form(), "translation_catalog.add_do").props.disabled, true);
    a.state.pending = null;
    a.state.error = "entry_exists";
    a.form();
    assert.equal(ofType(a.form(), kitStandIns.TextField)[0].props.value, " Mine ");
    // Sent again and accepted: the form is empty again, with the first protocol.
    a.state.error = null;
    a.state.pending = { endpoint: REGISTER };
    a.form();
    a.state.pending = null;
    a.form();
    assert.deepEqual([...ofType(a.form(), kitStandIns.TextField).map(node => node.props.value), findIn(a.form(), node => node.type === kitStandIns.Select).props.value],
        ["", "", "", "", "openai_compatible"]);
    // What is typed next stays.
    type(0, "Next");
    a.form();
    assert.equal(ofType(a.form(), kitStandIns.TextField)[0].props.value, "Next");
});

test("Enter in a field adds as a form would, except while something is sent; Enter elsewhere and other keys do nothing", async context => {
    const a = await apiEntries(context);
    let prevented = 0;
    const key = (name: string, target: object) => findIn(a.form(), node => node.type === "div" && node.props.role === "group").props
        .onKeyDown({ key: name, target, preventDefault: () => { prevented++; } });
    key("Enter", { tagName: "SELECT" });
    key("Tab", { tagName: "INPUT" });
    key("Enter", {});
    assert.deepEqual([prevented, find(a.form(), node => node.props?.role === "alert")], [0, null]);
    key("Enter", { tagName: "INPUT" });
    assert.deepEqual([prevented, textOf(findIn(a.form(), node => node.props?.role === "alert"))], [1, "translation_catalog.problem.name_missing"]);
    for (const [index, value] of [[0, "Mine"], [1, "https://asr.example/v1"], [3, "key"]] as const) ofType(a.form(), kitStandIns.TextField)[index].props.onChange({ target: { value } });
    a.state.pending = { endpoint: "/run/use_transcription_catalog_entry" };
    key("Enter", { tagName: "INPUT" });
    assert.equal(prevented, 2);
    assert.equal(a.sent.some(call => call[0] === REGISTER), false);
});

// D-14 and H-07 on one page: the add form's protocol is the kit's Select and a card asks before a
// removal with the kit's confirmation inside it. Asking in a card leaves the form's choice as it
// is, and while the removal is sent the form's list waits too, as all of the page's requests do.
test("the form's protocol list and a card's confirmation work side by side", async context => {
    const a = await apiEntries(context, { catalog: { api: [item("a")], protocols: ["deepgram", "openai_compatible"] } });
    const protocol = () => findIn(a.form(), node => node.type === kitStandIns.Select, "the protocol list").props;
    protocol().onChange({ target: { value: "openai_compatible" } });
    assert.deepEqual([protocol().value, protocol().disabled], ["openai_compatible", false]);
    const element = a.part("EntryCard"), runtime = hooks();
    const card = () => a.draw(element.type, { item: item("a"), layout: "list" }, runtime);
    buttonNamed(card(), "translation_catalog.remove").props.onClick();
    assert.ok(find(card(), isConfirm), "the card asks first");
    assert.deepEqual([protocol().value, protocol().disabled], ["openai_compatible", false], "the form keeps its choice");
    buttonNamed(card(), "translation_catalog.remove_do").props.onClick();
    assert.deepEqual(a.sent.at(-1), ["/run/remove_transcription_catalog_entry", { id: "a" }]);
    a.state.pending = { endpoint: "/run/remove_transcription_catalog_entry" };
    assert.deepEqual([protocol().value, protocol().disabled], ["openai_compatible", true], "the list waits while the removal is sent");
    a.state.pending = null;
    assert.equal(protocol().disabled, false);
});
