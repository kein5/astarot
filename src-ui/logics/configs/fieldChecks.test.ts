import assert from "node:assert/strict";
import { test } from "vitest";
import { instructionsProblem, papagoClientIdProblem, serverUrlProblem, temperatureProblem } from "./fieldChecks.ts";

// #1111: the checks a field runs before it saves by itself, which keep the core's rules
// (native/core/src/config/schema.rs): a value the core would refuse is said, not sent.
test("the temperature is empty, or 0 to 2 with at most two places", () => {
    for (const ok of ["", "0", "2", "0.3", "1.25", "2.0"]) assert.equal(temperatureProblem(ok), null, ok);
    for (const bad of ["2.01", "3", "-1", "0.333", ".5", "1.", "10", "a", "1e0"]) assert.equal(temperatureProblem(bad), "config_page.translation.llm_translation_temperature.errors.invalid", bad);
});

test("the extra instructions are one line of at most 500 characters", () => {
    assert.equal(instructionsProblem(""), null);
    assert.equal(instructionsProblem("あ".repeat(500)), null);
    assert.equal(instructionsProblem("😀".repeat(500)), null, "characters, not UTF-16 units");
    assert.equal(instructionsProblem("あ".repeat(501)), "config_page.translation.llm_translation_instructions.errors.invalid");
    assert.equal(instructionsProblem("one\ntwo"), "config_page.translation.llm_translation_instructions.errors.invalid");
});

test("Papago's Client ID is at most 256 characters without control characters", () => {
    assert.equal(papagoClientIdProblem(""), null);
    assert.equal(papagoClientIdProblem("x".repeat(256)), null);
    assert.equal(papagoClientIdProblem("x".repeat(257)), "config_page.translation.papago_client_id.errors.invalid");
    assert.equal(papagoClientIdProblem("id\t"), "config_page.translation.papago_client_id.errors.invalid");
});

test("a server address is one word starting with http:// or https://", () => {
    const check = serverUrlProblem("key");
    for (const ok of ["http://127.0.0.1:1234/v1", " https://lm.example.org/v1 ", "HTTP://localhost:11434"]) assert.equal(check(ok), null, ok);
    for (const bad of ["", "127.0.0.1:1234", "ftp://x", "http://a b", "http://"]) assert.equal(check(bad), "key", bad);
});
