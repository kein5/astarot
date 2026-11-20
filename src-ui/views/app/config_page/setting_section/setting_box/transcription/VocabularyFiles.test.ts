import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import * as vocabularyTerms from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { Vocabulary } from "../../../../../../logics/transcription/vocabularyTerms.ts";

// #792: the dictionary in and out of a file. It is written out by the core, which names the file,
// and read back from a file the user picks into the draft.
const BUILTIN = ["VRChat=ブイアールチャット,ブイチャ", "Quest=クエスト"];

async function setup(reply: unknown = { status: 200, result: { file: "vocabulary-20261120-153000.txt" } }, builtin: readonly string[] | null = BUILTIN) {
    const runtime = hooks(), given: Vocabulary[] = [], sent: [string, unknown][] = [];
    const { VocabularyFiles } = await loadModule<typeof import("./VocabularyFiles.tsx")>(new URL("./VocabularyFiles.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key }) },
        "../../../../../../logics/transcription/vocabularyTerms.ts": vocabularyTerms,
    });
    const vocabulary: Vocabulary = { builtin: true, terms: ["猫丸=ねこまる"] };
    const props = { builtin, vocabulary, disabled: false,
        onVocabulary: (next: Vocabulary) => { given.push(next); props.vocabulary = { builtin: true, ...next }; },
        send: async (endpoint: string, data?: unknown) => { sent.push([endpoint, data]); return reply; } };
    const render = () => runtime.render(VocabularyFiles, props);
    const button = (label: string) => findIn(render(), node => node.type === "button" && node.props.children === label).props;
    const lines = () => nodesIn(findIn(render(), node => node.props?.role === "status")).filter(node => node.type === "p").map(node => node.props.children);
    // Settles the promises a click or a pick started.
    const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    const pick = async (text: string, size = text.length) => {
        const target = { files: [{ size, text: async () => text }], value: "C:\\fakepath\\vocabulary.txt" };
        findIn(render(), node => node.type === "input").props.onChange({ target });
        await settle();
        assert.equal(target.value, "", "the same file can be picked again");
    };
    return { render, button, lines, pick, settle, props, given, sent };
}

test("a file read in becomes the draft's dictionary and says what it holds", async () => {
    const s = await setup();
    const field = findIn(s.render(), node => node.type === "input").props;
    assert.deepEqual([field.type, field.accept, field.hidden], ["file", ".txt,text/plain", true]);
    await s.pick("# notes\n猫丸=ねこ\nMidnight Rooftop\nVRChat=ブイアールチャット,ブイチャ\nx,y\n");
    // Quest, which the file has no line for, is taken out; VRChat stays as it ships.
    assert.deepEqual(s.given, [{ builtin: true, terms: ["猫丸=ねこ", "Midnight Rooftop"], removed: ["Quest"] }]);
    assert.deepEqual(s.lines(), ["realtime.vocabulary_import_done", "realtime.vocabulary_import_counts:{\"own\":2,\"changed\":0,\"removed\":1}",
        "realtime.vocabulary_import_skipped:{\"parts\":\"realtime.vocabulary_import_invalid:{\\\"count\\\":1}\"}"]);
    // The same file again: the draft is left as it is.
    await s.pick("猫丸=ねこ\nMidnight Rooftop\nVRChat=ブイアールチャット,ブイチャ\n");
    assert.equal(s.given.length, 1);
    assert.deepEqual(s.lines(), ["realtime.vocabulary_import_nothing"]);
    // A file without a term changes nothing and says so as a problem.
    await s.pick("# notes only\n");
    assert.equal(s.given.length, 1);
    assert.deepEqual(s.lines(), ["realtime.vocabulary_import_empty"]);
    assert.equal(findIn(s.render(), node => node.props?.role === "status").props.className, "status problem");
});

test("a file is not read before the built-in terms are known", async () => {
    const s = await setup(undefined, null);
    assert.equal(s.button("realtime.vocabulary_import").disabled, true);
    assert.equal(s.button("realtime.vocabulary_export").disabled, false);
});

test("a file too large is not read", async () => {
    const s = await setup();
    await s.pick("猫丸=ねこ\n", vocabularyTerms.MAX_IMPORT_BYTES + 1);
    assert.deepEqual(s.given, []);
    assert.deepEqual(s.lines(), ["realtime.vocabulary_import_too_large"]);
});

test("the dictionary the page shows is written out, and its folder can be opened", async () => {
    const s = await setup();
    assert.equal(find(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_export_open"), null);
    s.button("realtime.vocabulary_export").onClick();
    await s.settle();
    assert.deepEqual(s.sent, [["/run/export_vocabulary", { builtin: true, terms: ["猫丸=ねこまる"] }]]);
    assert.deepEqual(s.lines(), ["realtime.vocabulary_export_done:{\"file\":\"vocabulary-20261120-153000.txt\"}"]);
    s.button("realtime.vocabulary_export_open").onClick();
    assert.deepEqual(s.sent.at(-1), ["/run/open_filepath_vocabulary_exports", undefined]);
});

test("a failed write-out says so", async () => {
    for (const reply of [false, { status: 400, result: { error_code: "realtime_vocabulary_invalid" } }]) {
        const s = await setup(reply);
        s.button("realtime.vocabulary_export").onClick();
        await s.settle();
        assert.deepEqual(s.lines(), ["realtime.vocabulary_export_failed"]);
        assert.equal(find(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_export_open"), null);
    }
});
