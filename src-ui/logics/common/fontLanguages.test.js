import assert from "node:assert/strict";
import { test } from "node:test";
import { missingLanguagesText } from "./fontLanguages.js";

test("missing languages are named and joined in the UI language", () => {
    assert.equal(missingLanguagesText(["Japanese", "Korean"], "en"), "Japanese and Korean");
    assert.equal(missingLanguagesText(["Chinese Simplified"], "en"), "Simplified Chinese");
    assert.match(missingLanguagesText(["Japanese", "Korean"], "ja"), /日本語.*韓国語/);
});

test("without Intl the English names are joined", () => {
    assert.equal(missingLanguagesText(["Japanese", "Korean"], "ja", {}), "Japanese, Korean");
});
