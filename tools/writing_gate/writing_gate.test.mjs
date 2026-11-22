// Tests of the writing gate (tools/writing_gate/check.mjs). Run with Vitest (vitest.config.js).
import assert from "node:assert/strict";
import { test } from "vitest";

import { audienceOf, inventory, loadExceptions, scanDocument } from "./check.mjs";
import { localeProse, markdownProse } from "./prose.mjs";

const kinds = (file, text, options) => scanDocument(file, text, options).findings.map((item) => item.kind);

test("code, links, URLs, quotes and front matter are not read as prose", () => {
    const text = [
        "---",
        "title: サーバ",
        "---",
        "```sh",
        "サーバを起動する",
        "```",
        "`サーバ` は [フォルダー](https://example.com/サーバ) です。",
        "> サーバの話を引用します。",
        "<!-- サーバ -->",
    ].join("\n");
    assert.deepEqual(kinds("docs/a.md", text), []);
});

test("an exempt marker leaves out its lines and needs a reason", () => {
    const text = [
        "<!-- writing-exempt-start: examples of what to avoid -->",
        "| サーバ | サーバー |",
        "<!-- writing-exempt-end -->",
        "<!-- writing-exempt: quotes the wrong form -->",
        "「メモリー」とは書きません。",
        "<!-- writing-exempt-start -->",
        "サーバ",
    ].join("\n");
    const result = scanDocument("docs/a.md", text);
    // The marker without a reason leaves nothing out: the line after it is read.
    assert.deepEqual(
        result.findings.map((item) => [item.line, item.kind]),
        [[7, "ja-long-vowel-er"]],
    );
    assert.deepEqual(
        result.errors.map((item) => item.line),
        [6],
    );
});

test("a marker written as inline code is text, not a marker", () => {
    const result = scanDocument("docs/a.md", "目印は `<!-- writing-exempt-start: 理由 -->` と書きます。\nサーバ");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
        result.findings.map((item) => item.line),
        [2],
    );
});

test("a marker at the end of a line leaves out that line only", () => {
    const text = "| サーバ | サーバー | <!-- writing-exempt: the wrong form, as an example -->\nサーバ";
    assert.deepEqual(
        scanDocument("docs/a.md", text).findings.map((item) => item.line),
        [2],
    );
});

test("Japanese rules read Japanese lines, English rules read English lines", () => {
    assert.deepEqual(kinds("docs/a.md", "サーバの設定を保存することができます。"), [
        "ja-roundabout",
        "ja-long-vowel-er",
    ]);
    assert.deepEqual(kinds("docs/a.md", "The server is robust."), ["en-promotional"]);
    // An English word in a Japanese line is not an English sentence.
    assert.deepEqual(kinds("docs/a.md", "robust という語を使います。"), []);
});

test("the long vowel rules follow the guideline's lists", () => {
    assert.deepEqual(kinds("docs/a.md", "サーバー、フォルダー、ユーザビリティ、メモリを使います。"), []);
    assert.deepEqual(kinds("docs/a.md", "サーバ側のメモリーを使います。"), ["ja-long-vowel-er", "ja-long-vowel-y"]);
});

test("words a kanji is right for are not flagged as kana words", () => {
    assert.deepEqual(kinds("docs/a.md", "変更に合わせて、同等の起動時刻を使います。"), []);
    assert.deepEqual(kinds("docs/a.md", "次の通り、他のアプリ等を閉じて下さい。"), [
        "ja-kana-words",
        "ja-kana-words",
        "ja-kana-words",
        "ja-kana-words",
    ]);
});

test("a dash alone in a table cell is an empty cell, not a dash", () => {
    assert.deepEqual(kinds("docs/a.md", "| 項目 | — |"), []);
    assert.deepEqual(kinds("docs/a.md", "設定を保存します——すぐに。"), ["ja-dash", "ja-dash"]);
    assert.deepEqual(kinds("docs/a.md", "| item | – |\n| range | 1–3 |"), []);
    assert.deepEqual(kinds("docs/a.md", "It saves – then stops."), ["en-dash"]);
});

test("user-facing rules read only user-facing text", () => {
    assert.equal(audienceOf("site/ja/guide/install.mdx"), "user");
    assert.equal(audienceOf("locales/ja.yml"), "user");
    assert.equal(audienceOf("docs/release-notes/0.6.0.md"), "user");
    assert.equal(audienceOf("docs/release-notes/README.md"), "dev");
    assert.equal(audienceOf("docs/development.md"), "dev");
    assert.deepEqual(kinds("site/ja/a.md", "このPCで ASTAROT を動かします。"), [
        "ja-this-pc",
        "ja-latin-spacing",
        "ja-latin-spacing",
    ]);
    assert.deepEqual(kinds("docs/a.md", "このPCで ASTAROT を動かします。"), []);
    assert.deepEqual(kinds("site/en/a.md", "Click Save, e.g. on this PC."), ["en-eg-ie", "en-this-pc", "en-click"]);
});

test("a heading with both languages puts English first", () => {
    assert.deepEqual(kinds("docs/a.md", "## Summary / 概要"), []);
    assert.deepEqual(kinds("docs/a.md", "## 概要 / Summary"), ["both-language-order"]);
    // Two things named side by side in a table or a list are no pair of languages.
    assert.deepEqual(kinds("docs/a.md", "| 大きさ / SHA-256 |"), []);
});

test("emoji: none, but release notes decide for themselves and © is no emoji", () => {
    assert.deepEqual(kinds("docs/a.md", "保存しました 🎉"), ["emoji"]);
    assert.deepEqual(kinds("docs/release-notes/0.6.0.md", "## 🔒 プライバシー"), []);
    assert.deepEqual(kinds("docs/a.md", "VRChat © VRChat Inc."), []);
});

test("a question mark is fine in a UI confirmation, not in a document", () => {
    assert.deepEqual(kinds("locales/ja.yml", 'title: "変更を破棄しますか？"'), []);
    assert.deepEqual(kinds("docs/a.md", "どうしますか？"), ["ja-question"]);
});

test("locale files are read by their values", () => {
    const { prose } = localeProse('a:\n  b: "サーバの設定"\n  # サーバ\n  c: |\n');
    assert.deepEqual(
        prose.map((line) => line.line),
        [2],
    );
    assert.ok(markdownProse("::: warning サーバ\n").prose[0].text.includes("サーバ"));
    assert.ok(!markdownProse("::: warning サーバ\n").prose[0].text.includes("warning"));
});

test("every excepted path needs a reason, and the inventory counts by rule and area", () => {
    assert.deepEqual(loadExceptions("paths:\n  - path: CHANGELOG.md\n").problems.length, 1);
    const counts = inventory([
        { file: "docs/spec/a.md", kind: "x" },
        { file: "docs/spec/b.md", kind: "x" },
        { file: "AGENTS.md", kind: "y" },
    ]);
    assert.deepEqual(counts, { byRule: { x: 2, y: 1 }, byArea: { "docs/spec": 2, "AGENTS.md": 1 } });
});
