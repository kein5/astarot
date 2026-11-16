import test from "node:test";
import assert from "node:assert/strict";
import { createLanguageNames, isLanguagePickKey } from "./languageNames.ts";
import { languageCodes } from "./languageCodes.ts";

const japanese = Object.freeze({ language: "Japanese", country: "Japan" });
const english = Object.freeze({ language: "English", country: "United States" });
const locales = ["en", "ja", "ko", "zh-Hant", "zh-Hans"];

for (const locale of locales) {
    test(`${locale}: names use the current UI language and preserve the original identity`, () => {
        const names = createLanguageNames(locale);
        const language = new Intl.DisplayNames(locale, { type: "language" }).of("ja");
        const country = new Intl.DisplayNames(locale, { type: "region" }).of("JP");
        assert.deepEqual(names.name(japanese), { language, country, label: `${language} (${country})` });
        for (const query of [language, country, "Japanese", "japan", "jApAnEsE JAPAN"]) {
            assert.equal(names.matches(japanese, query), true, query);
        }
        assert.deepEqual(japanese, { language: "Japanese", country: "Japan" });
    });
}

test("Japanese search accepts either language, mixed tokens, case and width, and rejects unrelated entries", () => {
    const names = createLanguageNames("ja");
    assert.equal(names.name(japanese).label, "日本語 (日本)");
    for (const query of ["日本語", "日本", "Japanese", "japan", "日本語 japan", "ＪＡＰＡＮ", "  "]) {
        assert.equal(names.matches(japanese, query), true, query);
    }
    assert.equal(names.matches(japanese, "Korean"), false);
    assert.equal(names.matches(japanese, "日本語 Korea"), false);
    assert.equal(names.matches(english, "日本"), false);
});

test("sorting and filtering return original objects in visible order for Enter selection", () => {
    const entries = Object.freeze([japanese, english, Object.freeze({ language: "Arabic", country: "Algeria" })]);
    const names = createLanguageNames("ja");
    const sorted = names.sorted(entries);
    const expected = [...entries].sort((a, b) => new Intl.Collator("ja").compare(names.name(a).label, names.name(b).label));
    assert.deepEqual(sorted, expected);
    assert.strictEqual(sorted.filter(entry => names.matches(entry, "japan"))[0], japanese);
    assert.deepEqual(entries, [japanese, english, { language: "Arabic", country: "Algeria" }]);
});

test("a language code narrows the list, in either case, with - or _, and by its leading subtags", () => {
    const names = createLanguageNames("ja");
    const traditional = { language: "Chinese Traditional", country: "Taiwan" };
    for (const query of ["ja", "JA", "ja-jp", "ja_JP", " ja "]) assert.equal(names.matchesCode(japanese, query), true, query);
    for (const query of ["en", "en-us", "EN_US"]) assert.equal(names.matchesCode(english, query), true, query);
    for (const query of ["j", "jp", "ja-us", "en-gb", "japan", "ja jp", ""]) assert.equal(names.matchesCode(japanese, query), false, query);
    assert.equal(names.matchesCode(english, "ja"), false);
    // The stored tags are the speech engine's (cmn-Hant-TW, iw-IL); their canonical codes match as well.
    assert.equal(languageCodes[traditional.language][traditional.country], "cmn-Hant-TW");
    for (const query of ["zh", "zh-hant", "zh-Hant-TW", "cmn"]) assert.equal(names.matchesCode(traditional, query), true, query);
    assert.equal(names.matchesCode(traditional, "zh-hans"), false);
    const [hebrewCountry, hebrewTag] = Object.entries(languageCodes.Hebrew)[0];
    assert.match(hebrewTag, /^iw-/);
    for (const query of ["he", "iw"]) assert.equal(names.matchesCode({ language: "Hebrew", country: hebrewCountry }, query), true, query);
    // Code matching adds to the name search; it does not replace it.
    assert.equal(names.matches(japanese, "日本"), true);
    assert.equal(names.matches(english, "zh"), false);
});

test("the languages a code names come first, so Enter picks them over a name that contains the code", () => {
    const azerbaijani = Object.freeze({ language: "Azerbaijani", country: "Azerbaijan" });
    const entries = Object.freeze([azerbaijani, japanese, english]);
    for (const locale of ["en", "ja"]) {
        const names = createLanguageNames(locale);
        // In English, "Azerbaijani" contains "ja" and sorts before "Japanese".
        const shown = names.search(entries, "ja");
        assert.strictEqual(shown[0], japanese, locale);
        if (locale === "en") assert.deepEqual(shown, [japanese, azerbaijani]);
        // Without a code match the list is the name search in name order, as before.
        assert.deepEqual(names.search(entries, "japan"), names.sorted(entries).filter(entry => names.matches(entry, "japan")));
        assert.deepEqual(names.search(entries, ""), names.sorted(entries));
    }
    assert.deepEqual(createLanguageNames("en").search(entries, "en"), [english]);
});

test("all source tags are valid and localized in each supported UI locale", () => {
    let count = 0;
    for (const [language, countries] of Object.entries(languageCodes)) {
        for (const [country, code] of Object.entries(countries)) {
            const tag = new Intl.Locale(code);
            assert.ok(tag.region);
            for (const locale of locales) {
                const names = createLanguageNames(locale);
                const display = names.name({ language, country });
                assert.ok(display.language);
                assert.ok(display.country);
                assert.ok(names.matches({ language, country }, display.label));
            }
            count++;
        }
    }
    assert.ok(count > 0);
});

test("scripts, Cantonese, legacy Hebrew tags and lowercase country identities are handled", () => {
    const names = createLanguageNames("ja");
    const simplified = names.name({ language: "Chinese Simplified", country: "China" });
    const traditional = names.name({ language: "Chinese Traditional", country: "Taiwan" });
    assert.notEqual(simplified.language, traditional.language);
    assert.match(simplified.language, /簡体/);
    assert.match(traditional.language, /繁体/);
    assert.match(names.name({ language: "Chinese Traditional", country: "Hong Kong" }).language, /広東/);
    assert.match(names.name({ language: "Hebrew", country: "Israel" }).language, /ヘブライ/);
    assert.equal(names.name({ language: "Tamil", country: "malaysia" }).country, "マレーシア");
});

test("missing or invalid tags and absent Intl preserve English names", () => {
    const names = createLanguageNames("ja");
    const unknown = { language: "Future language", country: "Future region" };
    assert.equal(names.name(unknown).label, "Future language (Future region)");
    assert.equal(names.name({ ...japanese, code: "invalid_tag" }).label, "Japanese (Japan)");
    assert.equal(createLanguageNames("ja", {}).name(japanese).label, "Japanese (Japan)");
    assert.equal(createLanguageNames("ja", {}).fromCode("ja"), "ja");
    assert.equal(createLanguageNames("bad_locale").name(japanese).label, "Japanese (Japan)");
    assert.equal(names.name(null).label, "");
    assert.deepEqual(createLanguageNames("ja", {}).sorted([japanese, english]), [japanese, english]);
});

test("DisplayNames returning nothing or throwing falls back independently for each part", () => {
    for (const failType of ["language", "region"]) {
        for (const failure of [undefined, "", "throw"]) {
            const platform = { Locale: Intl.Locale, Collator: Intl.Collator, DisplayNames: class {
                constructor(locale, options) { this.type = options.type; this.real = new Intl.DisplayNames(locale, options); }
                of(code) {
                    if (this.type !== failType) return this.real.of(code);
                    if (failure === "throw") throw new RangeError();
                    return failure;
                }
            } };
            const names = createLanguageNames("ja", platform);
            assert.equal(names.name(japanese).label, failType === "language" ? "Japanese (日本)" : "日本語 (Japan)");
            assert.ok(names.matches(japanese, "Japanese Japan"));
        }
    }
});

test("unknown valid codes fall back to English instead of showing raw tags", () => {
    assert.equal(createLanguageNames("ja").name({ ...japanese, code: "qzz-QZ" }).label, "Japanese (Japan)");
});

test("language-only OCR, realtime codes and UI options use localized labels without changing IDs", () => {
    const names = createLanguageNames("ja");
    assert.equal(names.language("Korean"), "韓国語");
    assert.equal(names.name({ language: "Korean" }).label, "韓国語");
    assert.equal(names.matches({ language: "Korean" }, "韓国語"), true);
    assert.equal(names.language("Unknown"), "Unknown");
    assert.equal(names.language("Japanese"), "日本語"); // legacy OCR value
    assert.equal(names.fromCode("ja"), "日本語");
    assert.equal(names.fromCode("en-US"), "英語 (アメリカ合衆国)");
    assert.equal(names.fromCode("not_a_code"), "not_a_code");
    const options = Object.freeze([Object.freeze({ id: "ko", label: "한국어" })]);
    assert.deepEqual(names.uiOptions(options), [{ id: "ko", label: "韓国語 / 한국어" }]);
    assert.equal(createLanguageNames("ko").uiOptions(options)[0].label, "한국어");
});

test("changing UI language updates labels and search, including script-specific UI locales", () => {
    assert.notEqual(createLanguageNames("en").name(japanese).label, createLanguageNames("ja").name(japanese).label);
    assert.equal(createLanguageNames("ja").matches(japanese, "日本語"), true);
    assert.equal(createLanguageNames("en").matches(japanese, "日本語"), false);
    assert.notEqual(createLanguageNames("zh-Hans").fromCode("ko"), createLanguageNames("zh-Hant").fromCode("ko"));
});

test("Enter selects only after IME composition has ended", () => {
    assert.equal(isLanguagePickKey({ key: "Enter" }), true);
    assert.equal(isLanguagePickKey({ key: "Enter", nativeEvent: { isComposing: true } }), false);
    assert.equal(isLanguagePickKey({ key: "Enter", isComposing: true }), false);
    assert.equal(isLanguagePickKey({ key: "Enter", keyCode: 229 }), false);
    assert.equal(isLanguagePickKey({ key: "Escape" }), false);
});
