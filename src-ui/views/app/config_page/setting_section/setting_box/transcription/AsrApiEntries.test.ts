import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, drawWith, findIn, hooks, loadModule, nodesIn, unchecked, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as transcriptionCatalog from "../../../../../../logics/transcription/transcriptionCatalog.ts";
import * as translationCatalog from "../../../../../../logics/translation/translationCatalog.ts";
import * as endpointPrivacy from "../../../../../../logics/common/endpointPrivacy.ts";
import type { TranscriptionCatalog } from "../../../../../../logics/transcription/transcriptionCatalog.ts";

// #414: the speech recognition APIs the user added, in the API group: a card each with where it
// points, Use (the custom Whisper server) and Remove, and the form that adds one.
const CATALOG = unchecked<TranscriptionCatalog>({
    api: [
        { id: "asr-home", origin: "user", name: "Home", protocol: "openai_compatible", url: "http://192.168.1.5:8000/v1", model: "", has_key: true, in_use: true, status: "ok" },
        { id: "asr-work", origin: "user", name: "Work", protocol: "openai_compatible", url: "https://asr.example.org/v1", model: "whisper-large", has_key: true, in_use: false, status: "ok" },
        { id: "asr-lost", origin: "user", name: "Lost key", protocol: "openai_compatible", url: "https://x.example/v1", model: "", has_key: false, in_use: false, status: "ok" },
    ],
    protocols: ["openai_compatible"],
});

async function entries(context: TestContext, catalog: TranscriptionCatalog | null = CATALOG, hints = true) {
    const runtime = hooks(), sent: [string, unknown][] = [];
    context.onTestFinished(() => runtime.unmount());
    const module = await loadModule<typeof import("./AsrApiEntries.tsx")>(new URL("./AsrApiEntries.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string | string[]) => Array.isArray(key) ? key[0] : key }) },
        "../../../../../../logics/transcription/useTranscriptionCatalog": {
            useTranscriptionCatalog: () => ({ catalog, error: null, pending: null, send: (endpoint: string, data?: unknown) => { sent.push([endpoint, data]); } }) },
        "../../../../../../logics/transcription/transcriptionCatalog.ts": transcriptionCatalog,
        "../../../../../../logics/translation/translationCatalog.ts": translationCatalog,
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "../advanced_settings/catalogLayout": { useCatalogLayout: () => "list", CatalogList: "ul", CatalogFacts: "catalog-facts" },
        "../_components/hint/Hint": { useHintDescriptions: () => hints },
        "../_components/fold/Fold": { Fold: "fold" },
        "../_components/lead/Lead": { Lead: "lead" },
    });
    const drawn = (node: TreeNode) => { runtime.remount(); return drawWith(runtime, node); };
    const tree = runtime.render(module.AsrApiEntries);
    const cards = nodesIn(tree).filter(node => componentName(node) === "EntryCard").map(drawn);
    const form = nodesIn(tree).filter(node => componentName(node) === "AddForm").map(drawn)[0];
    return { tree, cards, form, sent };
}
// The card's buttons: the kit's, Remove being the trigger of the kit's confirmation inside the card.
const buttons = (node: TreeNode) => nodesIn(node).filter(child => child.type === kitStandIns.Button || child.type === kitStandIns.InlineConfirmTrigger);

test("asks for the entries when the page opens, and draws a card each with where it points", async context => {
    const { cards, sent } = await entries(context);
    assert.deepEqual(sent, [["/get/data/transcription_catalog", undefined]]);
    assert.deepEqual(cards.map(card => [card.props["data-catalog-item"], card.props["data-status"]]),
        [["asr-home", "in_use"], ["asr-work", "ready"], ["asr-lost", "no_key"]]);
    const facts = nodesIn(cards[1]).filter(node => node.type === "dd").map(node => nodesIn(node).filter(child => typeof child.props?.children === "string").map(child => child.props.children).join("") || node.props.children);
    assert.deepEqual(facts, ["https://asr.example.org/v1", "whisper-large", "translation_catalog.key_kept"]);
    // The one in use has no Use; one whose key is gone cannot be used and says why.
    assert.deepEqual(buttons(cards[0]).map(button => button.props.children), ["translation_catalog.remove"]);
    const lost = buttons(cards[2]);
    assert.equal(lost[0].props.disabled, true);
    assert.ok(nodesIn(cards[2]).some(node => node.props?.role === "alert" && node.props.children === "translation_catalog.state_help.no_key"));
});

test("Use points the custom Whisper server at the entry, and says so in its description", async context => {
    const { cards, sent } = await entries(context);
    const use = buttons(cards[1])[0];
    assert.equal(use.props.children, "config_page.transcription.api_entries.use");
    const help = findIn(cards[1], node => node.props?.id === use.props["aria-describedby"]);
    assert.deepEqual([help.props.hidden, help.props.children], [true, "config_page.transcription.api_entries.use_help"]);
    use.props.onClick();
    assert.deepEqual(sent.at(-1), ["/run/use_transcription_catalog_entry", { id: "asr-work" }]);
});

test("the form refuses what cannot pass, then adds; what is sent once used is one sentence in view", async context => {
    const { form, sent } = await entries(context, CATALOG);
    assert.equal(form.type, "fold");
    assert.deepEqual([form.props.summary, form.props.hint], ["config_page.transcription.api_entries.add", "config_page.transcription.api_entries.add_help"]);
    const lead = findIn(form, node => node.type === "lead");
    assert.deepEqual([lead.props.text, lead.props.details], ["config_page.transcription.api_entries.url_lead", "translation_catalog.url_details"]);
    const add = buttons(form).find(button => button.props.children === "translation_catalog.add_do");
    assert.ok(add);
    const before = sent.length;
    add.props.onClick();
    assert.equal(sent.length, before, "an empty form sends nothing");
});

test("no entry yet: only the form, and nothing else in the way", async context => {
    const { cards, form } = await entries(context, unchecked<TranscriptionCatalog>({ api: [], protocols: ["openai_compatible"] }));
    assert.equal(cards.length, 0);
    assert.ok(form);
});
