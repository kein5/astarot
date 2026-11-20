import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as vocabularyTerms from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { Vocabulary } from "../../../../../../logics/transcription/vocabularyTerms.ts";

// #792: the dictionary in use, one list: the user's own terms, then the built-in terms with the
// user's change over each. Terms are added at the head of the list; built-in terms have their
// readings changed, are taken out and put back. Each change goes to the form's draft, saved with
// the save bar like the rest of the dictionary.
const BUILTIN = ["VRChat=ブイアールチャット,ブイチャ", "Friends+=フレンドプラス,フレプラ", "Quest=クエスト"];

// hints: whether the page keeps descriptions out of sight (#614).
async function setup(vocabulary: Vocabulary, { hints = false, builtin = BUILTIN }: { hints?: boolean; builtin?: readonly string[] | null } = {}) {
    const runtime = hooks(), given: Vocabulary[] = [];
    const { VocabularyList } = await loadModule<typeof import("./VocabularyList.tsx")>(new URL("./VocabularyList.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key }) },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
        "../../../../../../logics/transcription/vocabularyTerms.ts": vocabularyTerms,
    });
    const props = { builtin, vocabulary, disabled: false,
        onVocabulary: (next: Vocabulary) => { given.push(next); props.vocabulary = next; } };
    const render = () => runtime.render(VocabularyList, props);
    // The row of a written form, and a button in it by its accessible name.
    const row = (tree: unknown, written: string) => findIn(tree, node => node.type === "li" && nodesIn(node).some(child => child.props?.children === written));
    const button = (scope: unknown, label: string) => findIn(scope, node => node.type === "button" && String(node.props["aria-label"] ?? node.props.children).startsWith(label));
    // The add row's fields, by their labels.
    const field = (label: string) => findIn(findIn(render(), node => node.type === "label" && node.props.children?.[0] === label), node => node.type === "input").props;
    const status = () => findIn(render(), node => node.type === "p" && node.props.role === "status").props.children;
    return { render, row, button, field, status, props, given };
}

const words = (node: TreeNode): string[] => nodesIn(node).flatMap(child => typeof child.props?.children === "string" ? [child.props.children] : []);

test("the rows say the readings in use and the user's change; the summary counts the terms in use and the changes", async () => {
    const s = await setup({ builtin: true, terms: ["猫丸=ねこまる", "Friends+=ふれぷら"], removed: ["Quest"] });
    const tree = s.render();
    const states = nodesIn(tree).filter(node => node.type === "li").map(node => node.props["data-state"]);
    assert.deepEqual(states, ["own", "builtin", "changed", "removed"], "the user's own terms come first, as the core uses them");
    assert.ok(words(s.row(tree, "Friends+")).includes("ふれぷら"));
    assert.ok(words(s.row(tree, "Friends+")).includes("realtime.vocabulary_state_changed"), "the state is said in words, not by color alone");
    assert.ok(words(s.row(tree, "猫丸")).includes("realtime.vocabulary_state_own"));
    const summary = findIn(tree, node => node.type === "summary");
    assert.deepEqual(words(summary), ["realtime.vocabulary_list:{\"count\":3}", "realtime.vocabulary_own_count:{\"count\":1}",
        "realtime.vocabulary_changed_count:{\"count\":1}", "realtime.vocabulary_removed_count:{\"count\":1}",
        "realtime.vocabulary_list_open", "realtime.vocabulary_list_close"]);
    // The bar's words of what it does are for the eye: the details element says whether it is open.
    const toggle = findIn(summary, node => node.props["aria-hidden"] === "true");
    assert.deepEqual(words(toggle), ["realtime.vocabulary_list_open", "realtime.vocabulary_list_close"]);
    assert.equal(findIn(tree, node => node.type === "details").props.open, undefined, "closed at first");
    // A term taken out keeps its place with the one way back; a term of the user's is deleted, a
    // built-in one taken out.
    const buttons = (written: string) => nodesIn(s.row(tree, written)).filter(node => node.type === "button").map(node => node.props["aria-label"]);
    assert.deepEqual(buttons("Quest"), ["realtime.vocabulary_put_back_of:{\"term\":\"Quest\"}"]);
    assert.deepEqual(buttons("Friends+"), ["realtime.vocabulary_change_readings_of:{\"term\":\"Friends+\"}",
        "realtime.vocabulary_restore_of:{\"term\":\"Friends+\"}", "realtime.vocabulary_take_out_of:{\"term\":\"Friends+\"}"]);
    assert.deepEqual(buttons("猫丸"), ["realtime.vocabulary_change_readings_of:{\"term\":\"猫丸\"}", "realtime.vocabulary_remove:{\"term\":\"猫丸\"}"]);
});

test("a term is added at the head of the list, with Enter or the button; what cannot be added is said", async () => {
    const s = await setup({ builtin: true, terms: ["猫丸"] });
    const add = () => findIn(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_add").props;
    assert.equal(add().disabled, true, "nothing typed yet");
    s.field("realtime.vocabulary_new_written").onChange({ target: { value: "Midnight Rooftop" } });
    s.field("realtime.vocabulary_new_readings").onChange({ target: { value: "みっどないと、るーふとっぷ" } });
    add().onClick();
    assert.deepEqual(s.given.at(-1), { builtin: true, terms: ["猫丸", "Midnight Rooftop=みっどないと,るーふとっぷ"] });
    assert.equal(s.status(), "realtime.vocabulary_add_done:{\"term\":\"Midnight Rooftop\"}");
    assert.equal(s.field("realtime.vocabulary_new_written").value, "", "the fields are emptied for the next term");
    // The written form of a built-in term changes its readings, and says so.
    s.field("realtime.vocabulary_new_written").onChange({ target: { value: "Quest" } });
    s.field("realtime.vocabulary_new_readings").onChange({ target: { value: "くえすと" } });
    s.field("realtime.vocabulary_new_readings").onKeyDown({ key: "Enter", preventDefault() {} });
    assert.deepEqual(s.given.at(-1)?.terms, ["猫丸", "Midnight Rooftop=みっどないと,るーふとっぷ", "Quest=くえすと"]);
    assert.equal(s.status(), "realtime.vocabulary_add_builtin:{\"term\":\"Quest\"}");
    assert.equal(s.row(s.render(), "Quest").props["data-state"], "changed");
    // A term in the dictionary already, or one the rules refuse, is kept in the fields to be put right.
    const count = s.given.length;
    s.field("realtime.vocabulary_new_written").onChange({ target: { value: "猫丸" } });
    add().onClick();
    assert.equal(s.status(), "realtime.vocabulary_add_duplicate:{\"term\":\"猫丸\"}");
    assert.equal(s.field("realtime.vocabulary_new_written").value, "猫丸");
    s.field("realtime.vocabulary_new_written").onChange({ target: { value: "a=b" } });
    assert.equal(s.status(), "", "typing again puts the message away");
    add().onClick();
    assert.equal(s.status(), "realtime.vocabulary_add_invalid:{\"term\":\"a=b\"}");
    assert.equal(s.given.length, count, "nothing was added");
});

test("the readings are changed in the row, applied with Enter or the button and dropped with Escape", async () => {
    const s = await setup({ builtin: true, terms: ["黒猫"] });
    let tree = s.render();
    s.button(s.row(tree, "VRChat"), "realtime.vocabulary_change_readings_of").props.onClick();
    const input = (written: string) => findIn(s.row(s.render(), written), node => node.type === "input").props;
    assert.equal(input("VRChat").value, "ブイアールチャット、ブイチャ", "the readings in use, as they are typed");
    assert.equal(input("VRChat")["aria-label"], "realtime.vocabulary_readings_of:{\"term\":\"VRChat\"}");
    // What the rules refuse is said, and cannot be applied.
    input("VRChat").onChange({ target: { value: "ぶい=ちゃ" } });
    tree = s.render();
    assert.equal(s.button(s.row(tree, "VRChat"), "realtime.vocabulary_readings_apply").props.disabled, true);
    assert.ok(find(s.row(tree, "VRChat"), node => node.props?.role === "status" && node.props.children === "realtime.vocabulary_readings_invalid"));
    // Escape leaves the dictionary as it was.
    input("VRChat").onKeyDown({ key: "Escape", preventDefault() {} });
    tree = s.render();
    assert.equal(find(s.row(tree, "VRChat"), node => node.type === "input"), null);
    assert.deepEqual(s.given, []);
    // Enter applies, to a built-in term and to one of the user's.
    s.button(s.row(tree, "VRChat"), "realtime.vocabulary_change_readings_of").props.onClick();
    input("VRChat").onChange({ target: { value: "ぶいちゃ" } });
    input("VRChat").onKeyDown({ key: "Enter", preventDefault() {} });
    assert.deepEqual(s.given.at(-1), { builtin: true, terms: ["黒猫", "VRChat=ぶいちゃ"] });
    assert.equal(s.row(s.render(), "VRChat").props["data-state"], "changed");
    s.button(s.row(s.render(), "黒猫"), "realtime.vocabulary_change_readings_of").props.onClick();
    input("黒猫").onChange({ target: { value: "くろねこ" } });
    s.button(s.row(s.render(), "黒猫"), "realtime.vocabulary_readings_apply").props.onClick();
    assert.deepEqual(s.given.at(-1), { builtin: true, terms: ["黒猫=くろねこ", "VRChat=ぶいちゃ"] }, "in its place");
});

test("a term is taken out and put back, one of the user's deleted, and all built-in ones restored at once", async () => {
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
    s.button(s.row(s.render(), "猫丸"), "realtime.vocabulary_remove").props.onClick();
    assert.deepEqual(s.props.vocabulary, { builtin: true, terms: [] });
});

test("with the built-in terms off, or before their list arrives, the list is the user's terms and adds to them", async () => {
    for (const [vocabulary, builtin] of [[{ builtin: false, terms: ["Quest=くえすと"] }, BUILTIN], [{ builtin: true, terms: ["Quest=くえすと"] }, null]] as const) {
        const s = await setup(vocabulary, { builtin });
        const tree = s.render();
        assert.deepEqual(nodesIn(tree).filter(node => node.type === "li").map(node => node.props["data-state"]), ["own"]);
        assert.equal(find(tree, node => node.type === "button" && node.props.children === "realtime.vocabulary_restore_all"), null);
        s.field("realtime.vocabulary_new_written").onChange({ target: { value: "黒猫" } });
        findIn(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_add").props.onClick();
        assert.deepEqual(s.given.at(-1)?.terms, ["Quest=くえすと", "黒猫"]);
    }
});

test("on a page that keeps descriptions out of sight, how the dictionary is built is the list's hint", async () => {
    const hinted = await setup({ terms: [] }, { hints: true });
    assert.ok(find(hinted.render(), node => node.type === "hint" && node.props.text === "realtime.vocabulary_list_help"));
    const plain = await setup({ terms: [] });
    const tree = plain.render();
    assert.equal(find(tree, node => node.type === "hint"), null);
    assert.ok(find(tree, node => node.type === "p" && node.props.children === "realtime.vocabulary_list_help"));
});
