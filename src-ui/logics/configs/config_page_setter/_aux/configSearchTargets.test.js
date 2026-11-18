import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";
import yaml from "js-yaml";
import { NOT_SETTINGS, settingTarget } from "./configSearchTargets.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const box = "../../../../views/app/config_page/setting_section/setting_box/";
const pageSource = dir => readdirSync(new URL(box + dir, import.meta.url))
    .filter(name => name.endsWith(".jsx") && !name.includes(".test.")).map(name => read(`${box}${dir}/${name}`)).join("\n");
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The search lists every labelled text under config_page.<page> (useConfigSearch.ts) and leads
// to the element whose data-setting-id is its target, or else whose data-setting-label is its
// label. A text listed but found nowhere on its page is a result that goes nowhere.
for (const page of ["vr", "hotkeys", "ocr"]) test(`every ${page} result in the settings search has a place on its page`, () => {
    const texts = yaml.load(read("../../../../../locales/en.yml")).config_page[page];
    const source = pageSource(page);
    const labelled = value => typeof value === "string" || (value && (value.label || value.label_for_automatic || value.label_for_manual));
    const keys = Object.keys(texts).filter(key => labelled(texts[key]) && !NOT_SETTINGS.has(`${page}.${key}`)
        // A section's description belongs to its title.
        && !(/_desc$/.test(key) && typeof texts[key] === "string" && (texts[key.replace(/_desc$/, "_title")] || texts[key.replace(/_desc$/, "_label")])));
    assert.ok(keys.length > 8, `${page}: ${keys.length} texts`);
    for (const key of keys) {
        const id = escape(settingTarget(page, key));
        // By id: data-setting-id, or a template's setting_id / hotkey_id / dropdown_id, or a row list entry.
        const byId = new RegExp(`(data-setting-id|setting_id|hotkey_id|dropdown_id|settingId)[=:]\\s*\\{?["']${id}["']|\\[["']${id}["'],`).test(source);
        // By label: a template, form row or section heading given this text as its label.
        const byLabel = new RegExp(`label(=\\{|:\\s*)t\\(["\`]config_page\\.${page}\\.${escape(key)}(\\.label)?["\`]\\)`).test(source);
        assert.ok(byId || byLabel, `config_page.${page}.${key} -> ${settingTarget(page, key)}`);
    }
});

test("texts that are not settings are not results", () => {
    for (const key of ["hotkeys.input_placeholder", "hotkeys.error_in_use", "vr.hmd"]) assert.ok(NOT_SETTINGS.has(key), key);
});
