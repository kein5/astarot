import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { isSameLanguageSelected } from "./sameLanguage.ts";

const slot = (language, country, enable = true) => ({ language, country, enable });

test("a target in the spoken language is the same language whatever its country", () => {
    assert.equal(isSameLanguageSelected(slot("English", "United States"), { 1: slot("English", "United Kingdom") }), true);
    assert.equal(isSameLanguageSelected(slot("English", "United States"), { 1: slot("English", "United States") }), true);
    assert.equal(isSameLanguageSelected(slot("Japanese", "Japan"), { 1: slot("English", "United States"), 2: slot("Japanese", "Japan") }), true);
});

test("a turned-off target or another language is not the same language", () => {
    assert.equal(isSameLanguageSelected(slot("English", "United States"), { 1: slot("Japanese", "Japan"), 2: slot("English", "United Kingdom", false) }), false);
    assert.equal(isSameLanguageSelected(slot("", ""), { 1: slot("", "") }), false);
    assert.equal(isSameLanguageSelected(undefined, undefined), false);
});

test("the sidebar uses this rule", () => {
    const source = readFileSync(new URL("../../views/app/main_page/sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton.jsx", import.meta.url), "utf8");
    assert.match(source, /isSameLanguageSelected\(/);
    assert.doesNotMatch(source, /\.country/);
});
