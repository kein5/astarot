import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// #391: RECORD_TIMEOUT is the longest single recording (the energy listener's
// phrase_time_limit); PHRASE_TIMEOUT is how long after the last speech the gathered audio
// becomes one message. The strings once described each as the other.
// One level down a locale file's tree; a key that is not there reads as undefined.
const child = (value: unknown, key: string): unknown => typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
// A text in the tree. A missing key, or a value that is not text, fails here as matching it did.
const textAt = (value: unknown, ...keys: string[]): string => {
    const found = keys.reduce(child, value);
    assert.ok(typeof found === "string", keys.join("."));
    return found;
};
const strings = (language: string) =>
    child(child(yaml.load(readFileSync(new URL(`../../../../../../../locales/${language}.yml`, import.meta.url), "utf8")), "config_page"), "transcription");

test("the record and phrase timeouts are described as what they do, in both languages", () => {
    const expected = {
        en: { record: /longest single recording/, phrase: /after the last speech|after your last speech/ },
        ja: { record: /上限/, phrase: /最後に.*この秒数が過ぎると/ },
    };
    for (const [language, { record, phrase }] of Object.entries(expected)) {
        const text = strings(language);
        for (const source of ["mic", "speaker"]) {
            assert.match(textAt(text, `${source}_record_timeout`, "desc"), record, `${language} ${source} record`);
            assert.match(textAt(text, `${source}_phrase_timeout`, "desc"), phrase, `${language} ${source} phrase`);
            assert.doesNotMatch(textAt(text, `${source}_record_timeout`, "label"), /無音/, `${language} ${source} record label`);
        }
        // The fold's line names each value by what it does.
        assert.match(textAt(text, "timing_status"), /\{\{record\}\}.*\{\{phrase\}\}.*\{\{queue\}\}/, language);
    }
});
