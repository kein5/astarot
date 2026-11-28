import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, drawWith, find, findIn, hooks, loadModule, nodesIn, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as talkAi from "../../../../../../logics/talk_ai/talkAi.ts";
import { INITIAL_VIEW } from "../../../../../../logics/talk_ai/talkView.ts";
import type { TalkView } from "../../../../../../logics/talk_ai/talkView.ts";
import type { TalkProvider } from "../../../../../../logics/talk_ai/talkAi.ts";

// The Talk AI page (#388), drawn with stand-ins for what it reads: the session's view, the saved
// settings and the shared rows, which keep their props.

const t = (key: string) => key;
const provider = (id: string, cloud: boolean, vision = true): TalkProvider => ({ id, name: id, vision, cloud, destination: cloud ? "wss://api" : "ws://127.0.0.1:8091",
    recommended_model: null, minimum_gpu_memory_gib: null, recommended_gpu_memory_gib: null });
const CATALOG = [provider("openai", true), provider("omni", false)];

async function talkPage(context: TestContext, view: Partial<TalkView> = {}, chosen = "openai") {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const keys: (string | null)[] = [];
    const shown: TalkView = { ...INITIAL_VIEW, catalog: CATALOG, key: { configured: false, stored: false }, ...view };
    const setting = (data: unknown) => ({ state: "ok", data });
    const module = await loadModule<typeof import("./TalkAi.tsx")>(new URL("./TalkAi.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: async () => {} },
        "@useI18n": { useI18n: () => ({ t }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async () => true }) },
        "@logics_configs": {
            useTalkAi: () => ({ currentTalkAiProvider: setting(chosen), setTalkAiProvider: async () => {}, currentTalkAiLocalUrl: setting("ws://127.0.0.1:8091/v1/realtime"),
                setTalkAiLocalUrl: async () => {}, currentTalkAiScreenIntervalMs: setting(1000), setTalkAiScreenIntervalMs: async () => {},
                currentTalkAiScreenLongEdge: setting(1024), setTalkAiScreenLongEdge: async () => {}, currentTalkAiScreenDetail: setting("auto"), setTalkAiScreenDetail: async () => {} }),
            useSaveButtonLogic: (request: { variable: unknown }) => ({ variable: request.variable, onChangeFunction: "change", saveFunction: "save", leaveFunction: "leave", revert: "revert", error: null }),
        },
        "@ui_configs": { openai_auth_key_url: "https://platform.openai.com/api-keys" },
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: { routing: "managed" } }) },
        "../../../../../../logics/talk_ai/useTalkAiSession.ts": { useTalkAiSession: () => ({ view: shown, setKey: async (key: string | null) => { keys.push(key); },
            stop: async () => {}, interrupt: async () => {}, endTurn: async () => {}, setOutput: () => {}, stopScreen: async () => {}, setSource: () => {} }) },
        "../../../../../../logics/talk_ai/talkAi.ts": talkAi,
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../_components/lead/Lead": { Lead: "lead" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/page_pointer/PagePointer": { PageLinkButton: "page-link" },
        "../_templates/Templates": { EntryWithSaveButtonContainer: "entry" },
        "../advanced_settings/catalogLayout": { CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch", CatalogList: "ul", CatalogState: "catalog-state",
            useCatalogLayout: () => "list" },
        "./TalkAiDialogs": { TalkAiConsentDialog: "consent-dialog", TalkAiScreenDialog: "screen-dialog" },
    });
    // The page's own parts, drawn as React would, level by level.
    const drawAll = (node: unknown): TreeNode[] => nodesIn(node).flatMap(part => typeof part.type === "function" ? [part, ...drawAll(drawWith(runtime, part))] : [part]);
    const tree = () => drawAll(runtime.render(module.TalkAi));
    return { tree, keys, runtime };
}

const partNamed = (nodes: TreeNode[], name: string) => {
    const part = nodes.find(node => componentName(node) === name);
    assert.ok(part, name);
    return part;
};

// #1266 ★17: whom to talk with, in the speech recognition page's order: the local group and its
// server's address, then the API group and its key, each under its cards whichever is chosen.
test("the local group comes first with its address, then the API group with its key, each on the settings group's ground", async context => {
    for (const chosen of ["openai", "omni"]) {
        const page = await talkPage(context, {}, chosen);
        const nodes = page.tree();
        const groups = nodes.filter(node => node.props?.["data-catalog-group"]);
        assert.deepEqual(groups.map(group => group.props["data-catalog-group"]), ["local", "api"], chosen);
        const setting = (group: TreeNode) => {
            const ground = findIn(group, node => node.props?.["data-settings-group"] === true, "the setting's ground");
            return nodesIn(ground).filter(node => ["KeyRow", "LocalUrlRow"].includes(componentName(node) ?? "")).map(componentName);
        };
        assert.deepEqual(groups.map(setting), [["LocalUrlRow"], ["KeyRow"]], chosen);
    }
});

// #1266 K-1: the key saves by itself, on Enter or when focus leaves the field; no Save button.
test("the key has no Save button and is kept on Enter or when the field is left", async context => {
    const page = await talkPage(context);
    // The row as the key's component draws it now, with what was typed so far.
    const keyRow = () => findIn(drawWith(page.runtime, partNamed(page.tree(), "KeyRow")), node => node.type === "row");
    const row = keyRow();
    const buttons = nodesIn(row.props.actions).filter(node => node.type === kitStandIns.Button).map(node => node.props.children);
    assert.ok(!buttons.includes("talk_ai.key.save"), "no Save");
    const field = findIn(row, node => node.type === kitStandIns.TextField);
    field.props.onChange({ target: { value: " sk-typed " } });
    findIn(keyRow(), node => node.type === kitStandIns.TextField).props.onBlur();
    assert.deepEqual(page.keys, ["sk-typed"]);
    // An empty field keeps nothing when it is left.
    findIn(keyRow(), node => node.type === kitStandIns.TextField).props.onBlur();
    assert.deepEqual(page.keys, ["sk-typed"]);
});

// #1266 K-5: a missing key is said by the card's state and by why Start waits, once each.
test("a missing key is said by the card's state and under Start, and nowhere else", async context => {
    const page = await talkPage(context);
    const nodes = page.tree();
    const words = (key: string) => nodes.filter(node => node.props?.children === key || node.props?.status === key);
    assert.equal(words("talk_ai.state_help.not_set").length, 0);
    assert.equal(words("talk_ai.key.none").length, 0, "the key row says nothing while there is no key");
    const card = nodes.find(node => node.props?.["data-catalog-item"] === "openai");
    assert.ok(card);
    assert.equal(find(card, node => node.type === "dt" && node.props.children === "talk_ai.fact.key"), null, "no key fact without a key");
    assert.equal(findIn(card, node => node.type === "catalog-state").props.children, "talk_ai.state.not_set");
    const reason = nodes.find(node => node.props?.children === "talk_ai.start_needs_key");
    assert.ok(reason);
    assert.match(String(reason.props.className), /\breason\b/);
    assert.match(String(reason.props.className), /\bcontrol_column\b/);
    // With a key kept: where it is kept, on the card and on the row.
    const kept = await talkPage(context, { key: { configured: true, stored: true } });
    const keptNodes = kept.tree();
    const keptCard = keptNodes.find(node => node.props?.["data-catalog-item"] === "openai");
    assert.ok(keptCard);
    assert.ok(find(keptCard, node => node.type === "dd" && node.props.children === "talk_ai.key.stored"));
    const keyRow = drawWith(kept.runtime, partNamed(keptNodes, "KeyRow"));
    assert.equal(findIn(keyRow, node => node.type === "row").props.status, "talk_ai.key.stored");
});

// #1266 K-3: Start and the screen's start sit in the control column, at the rows' right end.
test("the conversation's and the screen's buttons sit in the control column", async context => {
    const page = await talkPage(context);
    const nodes = page.tree();
    for (const words of ["talk_ai.start", "talk_ai.screen.start"]) {
        const holder = nodes.find(node => String(node.props?.className ?? "").includes("actions")
            && find(node, item => item.type === kitStandIns.Button && item.props.children === words) !== null);
        assert.ok(holder, words);
        assert.match(String(holder.props.className), /\bcontrol_column\b/, words);
    }
});
