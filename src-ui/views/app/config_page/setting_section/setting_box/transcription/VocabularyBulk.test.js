import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";
import * as vocabularyTerms from "../../../../../../logics/transcription/vocabularyTerms.ts";

// #446: several terms at once, and the user's terms copied as the lines the field takes back.
// hints: whether the page keeps descriptions out of sight (#614).
async function setup({ hints = false } = {}) {
    const runtime = hooks(), copied = [], given = [];
    const copy = { is_copied: false, copyToClipboard: async text => { copied.push(text); } };
    const { VocabularyBulk } = await loadModule(new URL("./VocabularyBulk.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key, options) => options ? `${key}:${JSON.stringify(options)}` : key }) },
        "@logics_common": { useCopyToClipboard: () => copy },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
        "../../../../../../logics/transcription/vocabularyTerms.ts": vocabularyTerms,
    });
    const props = { terms: ["VRChat=ブイチャ"], disabled: false, onTerms: terms => { given.push(terms); props.terms = terms; } };
    const render = () => runtime.render(VocabularyBulk, props);
    const button = (tree, key) => find(tree, node => node.type === "button" && node.props.children === key);
    return { render, button, props, copied, given, copy };
}

test("the lines are added after the user's terms, and the lines left over stay to be put right", async () => {
    const s = await setup();
    let tree = s.render();
    assert.equal(s.button(tree, "realtime.vocabulary_bulk_add").props.disabled, true, "nothing typed yet");
    find(tree, node => node.type === "textarea").props.onChange({ target: { value: "猫丸=ねこまる\nvrchat\n=bad\n\nMidnight Rooftop" } });
    tree = s.render();
    s.button(tree, "realtime.vocabulary_bulk_add").props.onClick();
    tree = s.render();
    assert.deepEqual(s.given, [["VRChat=ブイチャ", "猫丸=ねこまる", "Midnight Rooftop"]]);
    assert.equal(find(tree, node => node.type === "textarea").props.value, "=bad");
    const status = find(tree, node => node.props?.role === "status");
    const lines = [];
    find(status, node => { if (node.type === "p") lines.push(node.props.children); return false; });
    // Only the reasons that happened are named.
    assert.deepEqual(lines, [
        "realtime.vocabulary_bulk_added:{\"count\":2}",
        "realtime.vocabulary_bulk_skipped:{\"parts\":\"realtime.vocabulary_bulk_duplicates:{\\\"count\\\":1}realtime.vocabulary_bulk_separatorrealtime.vocabulary_bulk_invalid:{\\\"count\\\":1}\"}",
        "realtime.vocabulary_bulk_rest",
    ]);
    // Every line added: nothing is said about skipped lines.
    find(tree, node => node.type === "textarea").props.onChange({ target: { value: "お砂糖=おさとう" } });
    tree = s.render();
    s.button(tree, "realtime.vocabulary_bulk_add").props.onClick();
    tree = s.render();
    const after = [];
    find(find(tree, node => node.props?.role === "status"), node => { if (node.type === "p") after.push(node.props.children); return false; });
    assert.deepEqual(after, ["realtime.vocabulary_bulk_added:{\"count\":1}"]);
});

test("the user's terms are copied one a line, and nothing can be added while the form saves", async () => {
    const s = await setup();
    let tree = s.render();
    s.button(tree, "realtime.vocabulary_copy").props.onClick();
    assert.deepEqual(s.copied, ["VRChat=ブイチャ\n"]);
    s.props.terms = [];
    tree = s.render();
    assert.equal(s.button(tree, "realtime.vocabulary_copy").props.disabled, true, "nothing to copy");
    s.props.disabled = true;
    find(tree, node => node.type === "textarea").props.onChange({ target: { value: "猫丸" } });
    tree = s.render();
    assert.equal(find(tree, node => node.type === "textarea").props.readOnly, true);
    assert.equal(s.button(tree, "realtime.vocabulary_bulk_add").props.disabled, true);
});

// #614: how to write the lines is the hint after the field's name, still the field's description.
for (const hints of [false, true]) test(`${hints ? "hints" : "no hints"}: how to write the lines describes the field`, async () => {
    const s = await setup({ hints });
    const tree = s.render();
    const field = find(tree, node => node.type === "textarea");
    const help = find(tree, node => node.props?.id === field.props["aria-describedby"]);
    if (hints) {
        assert.equal(help.type, "hint");
        assert.deepEqual([help.props.text, help.props.row], ["realtime.vocabulary_bulk_help", true]);
        // The pointer on the name, or focus in the field, opens it.
        assert.equal(find(tree, node => node.type === "label").props["data-hint-row"], true);
        assert.ok(find(tree, node => node.props?.["data-hint-host"] && find(node, inner => inner.type === "hint")));
    } else {
        assert.equal(help.type, "p");
        assert.equal(help.props.children, "realtime.vocabulary_bulk_help");
    }
});
