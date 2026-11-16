import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const locale = language => readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8");

// #437: the UI speaks to the user about their own PC ("お使いのPC", "your PC"), or leaves
// the PC out where it adds nothing. "This PC" reads as the developer's machine.
test("#437: user-facing strings do not say this PC", () => {
    for (const [language, phrase] of [["ja", /このPC/], ["en", /\bthis PC\b/i]]) {
        const lines = locale(language).split("\n").filter(line => phrase.test(line));
        assert.deepEqual(lines, [], language);
    }
});
