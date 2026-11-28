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

test("an HTML comment ends at --> or --!>, on its line or a later one", () => {
    const text = ["<!-- サーバ --!> サーバ", "<!--", "サーバ", "--!> サーバ", "<!-- サーバ", "-->", "サーバ"].join(
        "\n",
    );
    assert.deepEqual(
        scanDocument("docs/a.md", text).findings.map((item) => item.line),
        [1, 4, 7],
    );
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

test("release notes: a sentence with four or more commas outside brackets is flagged", () => {
    const notes = "docs/release-notes/0.9.0.md";
    const many = "設定、ログ、モデル、辞書、資格情報を引き継ぎます。";
    assert.deepEqual(kinds(notes, many), ["ja-release-notes-commas"]);
    // Commas in brackets list names, and other documents are not checked for this.
    assert.deepEqual(kinds(notes, "6つのプリセット（Dark Plum、Midnight、Lagoon、Forest、Rose）から選べます。"), []);
    assert.deepEqual(kinds("docs/a.md", many), []);
    assert.deepEqual(kinds("docs/release-notes/README.md", many), []);
});

test("release notes: a comma after a short topic is flagged, one after a condition is not", () => {
    const notes = "docs/release-notes/0.9.0.md";
    assert.deepEqual(kinds(notes, "Windowsでは、仮想ケーブルを使います。"), ["ja-release-notes-pause-comma"]);
    assert.deepEqual(kinds(notes, "- `xdg-open`は、ホストのものを使います。"), ["ja-release-notes-pause-comma"]);
    assert.deepEqual(kinds(notes, "手で置いていた場合は、置き換えてください。"), []);
    assert.deepEqual(kinds(notes, "見つからないときは、既定のフォルダーに保存します。"), []);
    assert.deepEqual(kinds(notes, "設定を変えると、すぐに反映されます。"), []);
    assert.deepEqual(kinds(notes, "GPUで変換するには、実行環境を取得します。"), []);
    assert.deepEqual(kinds(notes, "設定によっては、時間がかかります。"), []);
    assert.deepEqual(kinds(notes, "この説明は、見出しの横に移しました。"), ["ja-release-notes-pause-comma"]);
});

test("release notes: a paragraph is one line, with one blank line between blocks", () => {
    const notes = "docs/release-notes/0.9.0.md";
    const breaks = (text) =>
        scanDocument(notes, text)
            .findings.filter((item) => item.kind === "release-notes-breaks")
            .map((item) => [item.line, item.text]);
    assert.deepEqual(breaks(["# ASTAROT 0.9.0", "", "一文目です。", "二文目です。"].join("\n")), [
        [4, "段落の途中の改行"],
    ]);
    assert.deepEqual(breaks(["## 🎨 題", "本文です。"].join("\n")), [[1, "見出しのあとに空行がない"]]);
    assert.deepEqual(breaks(["本文です。", "## 🎨 題", ""].join("\n")), [[2, "見出しの前に空行がない"]]);
    assert.deepEqual(breaks(["本文です。", "", "", "次です。"].join("\n")), [[3, "空行が2つ続く"]]);
    assert.deepEqual(breaks(["本文です。  "].join("\n")), [[1, "行末の空白"]]);
    assert.deepEqual(breaks(["次のとおりです："].join("\n")), [[1, "行末の「：」"]]);
    // Lists, tables, code blocks and a separator are blocks of their own lines.
    const fine = [
        "本文です。",
        "",
        "- 一つ目",
        "- 二つ目",
        "",
        "| a | b |",
        "|---|---|",
        "",
        "```sh",
        "a",
        "b",
        "```",
        "",
        "---",
    ];
    assert.deepEqual(breaks(fine.join("\n")), []);
    assert.deepEqual(
        scanDocument("docs/a.md", ["一文目です。", "二文目です。"].join("\n")).findings.map((item) => item.kind),
        [],
    );
});
