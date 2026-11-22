import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { CLOUD_TRANSCRIPTION_ENGINES } from "./cloudTranscription.ts";
import { localeAt, readLocale } from "../test/locales.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const setter = read("./config_page_setter/ui_config_setter.ts");
// The backend's endpoints: the spec's list, which the core's endpoint_coverage test keeps equal
// to what the core serves.
const endpoints = read("../../../docs/spec/reference/ipc-endpoints.md");

// Base_Name -> base_endpoint_name for every generated setting.
const settings = Object.fromEntries([...setter.matchAll(/Base_Name: "(\w+)",[^{}]*?base_endpoint_name: "(\w+)"/gs)]
    .map(([, base, endpoint]) => [base, endpoint]));

test("each cloud engine's settings reach backend endpoints that exist", () => {
    for (const { base, key, has_url } of CLOUD_TRANSCRIPTION_ENGINES) {
        const expected = {
            [`${base}AuthKey`]: `${key}_auth_key`,
            [`Selectable${base}ModelList`]: `selectable_${key}_model_list`,
            [`Selected${base}Model`]: `selected_${key}_model`,
            ...(has_url ? { [`${base}URL`]: `${key}_url` } : {}),
        };
        for (const [setting, endpoint] of Object.entries(expected)) {
            assert.equal(settings[setting], endpoint, `${setting} should use ${endpoint}`);
            assert.ok(endpoints.includes(`\`/get/data/${endpoint}\``), `backend has no /get/data/${endpoint}`);
        }
    }
    assert.equal(settings.SelectableTranscriptionEngines, "selectable_transcription_engines");
});

test("each cloud engine id is one the backend knows", () => {
    // The OpenAI-compatible engines the core builds a recognizer for (`COMPATIBLE_ENGINES`).
    const core = read("../../../native/core/src/controller/transcription.rs");
    const compatible = core.match(/const COMPATIBLE_ENGINES: \[&str; \d+\] = \[([^\]]*)\]/)?.[1] ?? "";
    for (const { id } of CLOUD_TRANSCRIPTION_ENGINES) {
        assert.ok(id === "Deepgram" || compatible.includes(`"${id}"`), `unknown engine ${id}`);
    }
});

test("the API engines list the services the app provides, then the user's own server, marked as theirs", () => {
    // The settings page's API group (#414) and its engine choice draw them in this order.
    assert.deepEqual(CLOUD_TRANSCRIPTION_ENGINES.map(engine => [engine.id, !!engine.own]),
        [["Groq_Whisper", false], ["OpenAI_Whisper", false], ["Deepgram", false], ["Custom_Whisper", true]]);
    // Only the own server takes a URL: it is the user's connection, not a service of the app.
    assert.deepEqual(CLOUD_TRANSCRIPTION_ENGINES.filter(engine => engine.has_url).map(engine => engine.id), ["Custom_Whisper"]);
});

for (const language of ["en", "ja"]) {
    test(`${language}: every cloud engine has its labels`, () => {
        const strings = readLocale(language);
        const transcription = (path: string) => localeAt(strings, `config_page.transcription.${path}`);
        assert.ok(transcription("select_transcription_engine.desc"));
        assert.ok(transcription("cloud_section.label") && transcription("cloud_section.desc"));
        assert.ok(transcription("speechcpp_section.label") && transcription("speechcpp_section.desc"));
        assert.ok(transcription("select_transcription_engine.badge_own"));
        for (const { key, has_url } of CLOUD_TRANSCRIPTION_ENGINES) {
            assert.ok(transcription(`select_transcription_engine.engines.${key}`), `${language}: engine label ${key}`);
            assert.ok(transcription(`${key}_auth_key.label`), `${language}: ${key}_auth_key.label`);
            assert.ok(transcription(`select_${key}_model.label`), `${language}: select_${key}_model.label`);
            if (has_url) assert.ok(transcription(`${key}_url.label`), `${language}: ${key}_url.label`);
        }
    });
}
