import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// #391: Seed-VC ran on the Python backend and ended with it. The settings no longer offer it,
// RVC is the default engine, and a conversion moved from Seed-VC to RVC is explained once.
const source = readFileSync(new URL("./DirectVoiceSettings.tsx", import.meta.url), "utf8");
// One level down a locale file's tree; a key that is not there reads as undefined.
const child = (value: unknown, key: string): unknown => typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
// A text in the tree. A missing key, or a value that is not text, fails here as matching it did.
const textAt = (value: unknown, ...keys: string[]): string => {
    const found = keys.reduce(child, value);
    assert.ok(typeof found === "string", keys.join("."));
    return found;
};
const strings = (language: string) => yaml.load(readFileSync(new URL(`../../../../../../../locales/${language}.yml`, import.meta.url), "utf8"));

test("the direct voice settings offer no Seed-VC and default to RVC", () => {
    assert.doesNotMatch(source, /<option value="seed-vc">/);
    assert.match(source, /const defaults = \{[^}]*engine: "rvc"/);
    // Input forwarding only forwards: its old conversion was Seed-VC's. It shows forwarding
    // without rewriting the saved mode (#429, directVoiceDraft.test.js).
    assert.match(source, /const converted = directShowsConversion\(draft, variant\)/);
    assert.match(source, /\{variant === "all" && <label>\{t\("voice\.direct_mode"\)\}/);
    assert.match(source, /directState\.notice === "seed_vc_moved_to_rvc" && <p role="status">\{t\("voice_ui\.seed_vc_moved_to_rvc"\)\}/);
});

test("the strings shown with the voice settings no longer offer Seed-VC, in both languages", () => {
    for (const language of ["en", "ja"]) {
        const text = strings(language);
        assert.equal(typeof child(child(text, "voice_ui"), "seed_vc_moved_to_rvc"), "string", language);
        for (const key of ["input_description", "conversion_hint", "monitor_hint"]) {
            assert.doesNotMatch(textAt(text, "voice", key), /Seed-VC/, `${language} voice.${key}`);
        }
        assert.doesNotMatch(textAt(text, "voice", "input_errors", "vc_gpu_unavailable"), /Seed-VC/, language);
    }
});
