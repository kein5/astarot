import assert from "node:assert/strict";
import { test } from "node:test";

import { checkLocales, keyIndex, parseLocale } from "./locales.mjs";
import { makeNeedsTranslation, scanSource } from "./source.mjs";
import { compareBaseline, countFindings } from "./baseline.mjs";
import { loadExceptions } from "./check.mjs";

const locales = (en, ja) => [parseLocale(en, "en"), parseLocale(ja, "ja")];
const messages = (problems) => problems.map(p => `${p.file} ${p.key}: ${p.message}`);

test("matching locales pass", () => {
    const en = 'a:\n  title: "Hello {{name}}"\n  items_one: "{{count}} item"\n  items_other: "{{count}} items"\n  see: "$t(a.title)"\n';
    const ja = 'a:\n  title: "こんにちは{{name}}"\n  items_one: "{{count}}件"\n  items_other: "{{count}}件"\n  see: "$t(a.title)"\n';
    assert.deepEqual(checkLocales(locales(en, ja)), []);
});

test("a key only one language has is reported on the other", () => {
    const problems = messages(checkLocales(locales('a:\n  b: "B"\n  c: "C"\n', 'a:\n  b: "ビー"\n  d: "ディー"\n')));
    assert.ok(problems.some(m => m.startsWith("locales/ja.yml a.c: missing")));
    assert.ok(problems.some(m => m.startsWith("locales/ja.yml a.d: not in locales/en.yml")));
});

test("empty and non-text values are reported; whitespace separators are allowed", () => {
    const problems = messages(checkLocales(locales('a: ""\nb: ~\nc: "; "\n', 'a: "ア"\nb: "ビー"\nc: "　"\n')));
    assert.ok(problems.some(m => m === "locales/en.yml a: value is empty"));
    assert.ok(problems.some(m => m.startsWith("locales/en.yml b: value is empty (null)")));
    assert.ok(!problems.some(m => / c: /.test(m)));
});

test("interpolation variables must match the reference language", () => {
    const problems = messages(checkLocales(locales('a: "{{count}} of {{total, number}}"\n', 'a: "{{count}}／{{totl}}"\n')));
    assert.deepEqual(problems, ["locales/ja.yml a: interpolation differs from en: missing {{total}}; unknown {{totl}}"]);
});

test("each language needs its own plural forms", () => {
    // English needs _one and _other; a group without _one fails there but not in Japanese.
    const problems = messages(checkLocales(locales('n_other: "{{count}} files"\n', 'n_other: "{{count}}件"\n')));
    assert.deepEqual(problems, ["locales/en.yml n: plural forms missing: n_one"]);
});

test("$t() nesting must point at a key", () => {
    const problems = messages(checkLocales(locales('a: "$t(b)"\n', 'a: "$t(b)"\n')));
    assert.ok(problems.some(m => m === "locales/en.yml a: $t(b) points at no key"));
});

const index = keyIndex(parseLocale('main:\n  title: "Title"\n  list:\n    - "One"\n  files_one: "{{count}} file"\n  files_other: "{{count}} files"\nvoice:\n  ok: "OK"\n', "en"));
const scan = (code, { file = "src-ui/A.jsx", terms = ["ASTAROT"] } = {}) =>
    scanSource(file, code, { index, needsTranslation: makeNeedsTranslation(terms) });

test("keys named in the code must exist", () => {
    const { keys } = scan(`
        t("main.title"); t("main.files", { count: 2 }); i18n.t("main.list", { returnObjects: true });
        t("main.missing"); t("main.list"); t(\`main.\${id}\`); t(\`nope.\${id}\`);
        const KEYS = { a: "voice.ok", b: "voice.gone" }; const file = "voice.pth";
        const el = <Trans i18nKey="main.absent" />;
    `);
    assert.deepEqual(keys.map(k => k.message), [
        '"main.missing" is not defined in the reference locale',
        '"main.list" names a group of keys, not one text',
        // A template key is checked by its fixed part.
        '"nope.${...}" starts with "nope", which is not a group in the reference locale',
        '"voice.gone" is not defined in the reference locale',
        '"main.absent" is not defined in the reference locale',
    ]);
});

test("text written into JSX, user-facing attributes and option labels is found", () => {
    const { hardcoded } = scan(`
        const options = [{ id: "a", label: "First choice" }, { id: "b", label: t("main.title") }];
        export const A = () => <div title="Close window" aria-label={busy ? "Busy" : t("main.title")} className="Some class">
            Hello there
            {"Inline text"}
            {t("main.title")}
            <img alt="ASTAROT" />
            <input placeholder="settings_id" />
        </div>;
    `);
    assert.deepEqual(hardcoded.map(h => `${h.line}:${h.kind}:${h.text}`), [
        "2:property:label:First choice",
        "3:attribute:title:Close window",
        "3:attribute:aria-label:Busy",
        "4:jsx-text:Hello there",
        "5:jsx-expression:Inline text",
    ]);
});

test("terms of exceptions.yml and i18n-exempt comments with a reason are allowed", () => {
    const { hardcoded, errors } = scan(`
        export const A = () => <div>
            <span>ASTAROT</span>
            {/* i18n-exempt: shown in English on purpose */}
            <span>UI Language</span>
            <span>Still flagged</span>
            <span>Symbol</span>{/* i18n-exempt: covers this line only */}
            <span>Next line</span>
        </div>;
        // i18n-exempt-start: service names
        const names = [{ label: "DeepL API" },
            { label: "Gemini API" }];
        // i18n-exempt-end
        // i18n-exempt
        const x = { label: "No reason" };
    `);
    assert.deepEqual(hardcoded.map(h => h.text), ["Still flagged", "Next line", "No reason"]);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /needs a reason/);
});

test("TypeScript files parse, and a file that does not parse is an error", () => {
    assert.deepEqual(scan("const a: string = t('main.title') as string;", { file: "src-ui/a.ts" }).errors, []);
    assert.match(scan("const = ;").errors[0].message, /cannot parse/);
});

test("the baseline lets known text stay but catches new and removed text", () => {
    const item = (text, line = 1) => ({ file: "src-ui/A.jsx", line, column: 1, kind: "jsx-text", text });
    const baseline = countFindings([item("Old"), item("Gone")]);
    assert.deepEqual(baseline, { "src-ui/A.jsx": { "jsx-text|Gone": 1, "jsx-text|Old": 1 } });
    const { added, fixed } = compareBaseline([item("Old", 9), item("New", 10)], baseline);
    assert.deepEqual(added.map(a => a.text), ["New"]);
    assert.deepEqual(fixed.map(f => f.text), ["Gone"]);
    // A second copy of known text is new text.
    assert.deepEqual(compareBaseline([item("Old"), item("Old", 2)], baseline).added.length, 2);
});

test("every exception needs a reason", () => {
    const { terms, problems } = loadExceptions("terms:\n  - text: ASTAROT\n    reason: product name\n  - text: Foo\npaths: []\n");
    assert.deepEqual(terms, ["ASTAROT"]);
    assert.equal(problems.length, 1);
});

test("allowed terms are whole words", () => {
    const needs = makeNeedsTranslation(["ms", "VRChat"]);
    assert.equal(needs("120 ms"), false);
    assert.equal(needs("VRChat"), false);
    assert.equal(needs("items"), true);
    assert.equal(needs("VRChat settings"), true);
    assert.equal(needs("→ 0.5"), false);
});
