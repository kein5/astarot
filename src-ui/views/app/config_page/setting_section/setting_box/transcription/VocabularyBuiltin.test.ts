import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as vocabularyTerms from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { Vocabulary } from "../../../../../../logics/transcription/vocabularyTerms.ts";

// #792: the built-in terms listed to change their readings, take them out and put them back. Each
// change goes to the form's draft, saved with the save bar like the rest of the dictionary.
const BUILTIN = ["VRChat=ブイアールチャット,ブイチャ", "Friends+=フレンドプラス,フレプラ", "Quest=クエスト"];

// hints: whether the page keeps descriptions out of sight (#614).
async function setup(vocabulary: Vocabulary, { hints = false }: { hints?: boolean } = {}) {
    const runtime = hooks(), given: Vocabulary[] = [];
    const { VocabularyBuiltin } = await loadModule<typeof import("./VocabularyBuiltin.tsx")>(new URL("./VocabularyBuiltin.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key }) },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
        "../../../../../../logics/transcription/vocabularyTerms.ts": vocabularyTerms,
    });
    const props = { builtin: BUILTIN, vocabulary, disabled: false,
        onVocabulary: (next: Vocabulary) => { given.push(next); props.vocabulary = next; } };
    const render = () => runtime.render(VocabularyBuiltin, props);
    // The row of a written form, and a button in it by its accessible name.
    const row = (tree: unknown, written: string) => findIn(tree, node => node.type === "li" && nodesIn(node).some(child => child.props?.children === written));
    const button = (scope: unknown, label: string) => findIn(scope, node => node.type === "button" && String(node.props["aria-label"] ?? node.props.children).startsWith(label));
    return { render, row, button, props, given };
}

const words = (node: TreeNode): string[] => nodesIn(node).flatMap(child => typeof child.props?.children === "string" ? [child.props.children] : []);

test("the rows say the readings in use and the user's change; the summary counts the changes", async () => {
    const s = await setup({ builtin: true, terms: ["Friends+=ふれぷら"], removed: ["Quest"] });
    const tree = s.render();
    const states = nodesIn(tree).filter(node => node.type === "li").map(node => node.props["data-state"]);
    assert.deepEqual(states, ["builtin", "changed", "removed"]);
    assert.ok(words(s.row(tree, "Friends+")).includes("ふれぷら"));
    assert.ok(words(s.row(tree, "Friends+")).includes("realtime.vocabulary_state_changed"), "the state is said in words, not by color alone");
    const summary = findIn(tree, node => node.type === "summary");
    assert.deepEqual(words(summary), ["realtime.vocabulary_builtin_list:{\"count\":3}",
        "realtime.vocabulary_changed_count:{\"count\":1}", "realtime.vocabulary_removed_count:{\"count\":1}"]);
    // A term taken out keeps its place with the one way back; the others can be changed or taken out.
    const removed = s.row(tree, "Quest");
    assert.deepEqual(nodesIn(removed).filter(node => node.type === "button").map(node => node.props["aria-label"]),
        ["realtime.vocabulary_put_back_of:{\"term\":\"Quest\"}"]);
    assert.deepEqual(nodesIn(s.row(tree, "Friends+")).filter(node => node.type === "button").map(node => node.props["aria-label"]), [
        "realtime.vocabulary_change_readings_of:{\"term\":\"Friends+\"}", "realtime.vocabulary_restore_of:{\"term\":\"Friends+\"}",
        "realtime.vocabulary_take_out_of:{\"term\":\"Friends+\"}"]);
});

test("the readings are changed in the row, applied with Enter or the button and dropped with Escape", async () => {
    const s = await setup({ builtin: true, terms: [] });
    let tree = s.render();
    s.button(s.row(tree, "VRChat"), "realtime.vocabulary_change_readings_of").props.onClick();
    tree = s.render();
    const input = () => findIn(s.row(s.render(), "VRChat"), node => node.type === "input").props;
    assert.equal(input().value, "ブイアールチャット、ブイチャ", "the readings in use, as they are typed");
    assert.equal(input()["aria-label"], "realtime.vocabulary_readings_of:{\"term\":\"VRChat\"}");
    // What the rules refuse is said, and cannot be applied.
    input().onChange({ target: { value: "ぶい=ちゃ" } });
    tree = s.render();
    assert.equal(s.button(s.row(tree, "VRChat"), "realtime.vocabulary_readings_apply").props.disabled, true);
    assert.ok(find(s.row(tree, "VRChat"), node => node.props?.role === "status" && node.props.children === "realtime.vocabulary_readings_invalid"));
    // Escape leaves the dictionary as it was.
    input().onKeyDown({ key: "Escape", preventDefault() {} });
    tree = s.render();
    assert.equal(find(s.row(tree, "VRChat"), node => node.type === "input"), null);
    assert.deepEqual(s.given, []);
    // Enter applies.
    s.button(s.row(tree, "VRChat"), "realtime.vocabulary_change_readings_of").props.onClick();
    s.render();
    input().onChange({ target: { value: "ぶいちゃ" } });
    s.render();
    input().onKeyDown({ key: "Enter", preventDefault() {} });
    tree = s.render();
    assert.deepEqual(s.given, [{ builtin: true, terms: ["VRChat=ぶいちゃ"] }]);
    assert.equal(s.row(tree, "VRChat").props["data-state"], "changed");
});

test("a term is taken out and put back, and all of them are restored at once", async () => {
    const s = await setup({ builtin: true, terms: ["猫丸"] });
    let tree = s.render();
    const restoreAll = () => findIn(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_restore_all");
    assert.equal(restoreAll().props.disabled, true, "nothing to restore");
    s.button(s.row(tree, "Quest"), "realtime.vocabulary_take_out_of").props.onClick();
    tree = s.render();
    assert.deepEqual(s.props.vocabulary, { builtin: true, terms: ["猫丸"], removed: ["Quest"] });
    s.button(s.row(tree, "Quest"), "realtime.vocabulary_put_back_of").props.onClick();
    assert.deepEqual(s.props.vocabulary, { builtin: true, terms: ["猫丸"] });
    s.button(s.row(s.render(), "Friends+"), "realtime.vocabulary_take_out_of").props.onClick();
    restoreAll().props.onClick();
    assert.deepEqual(s.props.vocabulary, { builtin: true, terms: ["猫丸"] }, "the user's own terms stay");
});

test("on a page that keeps descriptions out of sight, how the changes follow an update is the list's hint", async () => {
    const hinted = await setup({ terms: [] }, { hints: true });
    assert.ok(find(hinted.render(), node => node.type === "hint" && node.props.text === "realtime.vocabulary_builtin_help"));
    const plain = await setup({ terms: [] });
    const tree = plain.render();
    assert.equal(find(tree, node => node.type === "hint"), null);
    assert.ok(find(tree, node => node.type === "p" && node.props.children === "realtime.vocabulary_builtin_help"));
});
