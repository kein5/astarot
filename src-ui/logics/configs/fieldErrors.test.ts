import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import { INLINE_ANSWER_WAIT_MS, awaitInlineAnswer, errorCodeOf, refusalKeys, saveSaidInline, takeInlineRefusal } from "./fieldErrors.ts";

// #1111: only the refusal of a field's own save is said under the field instead of as a notice.
test("a refusal is taken once for each save a field waits for, and never otherwise", () => {
    const endpoint = "/set/data/lmstudio_url";
    assert.equal(takeInlineRefusal(endpoint), false, "a start-up repair keeps its notice");
    awaitInlineAnswer(endpoint);
    awaitInlineAnswer(endpoint);
    assert.equal(takeInlineRefusal(endpoint), true);
    assert.equal(takeInlineRefusal(endpoint), true);
    assert.equal(takeInlineRefusal(endpoint), false);
    const settle = awaitInlineAnswer(endpoint);
    settle();
    assert.equal(takeInlineRefusal(endpoint), false, "an accepted save leaves nothing to take");
    assert.equal(takeInlineRefusal(undefined), false);
});

// #1324: a wait belongs to one save. Ending it twice, or after its refusal was taken, leaves
// another save's wait alone.
test("each save's wait ends once, and only its own", () => {
    const endpoint = "/set/data/ollama_url";
    const first = awaitInlineAnswer(endpoint);
    awaitInlineAnswer(endpoint);
    first();
    first();
    assert.equal(takeInlineRefusal(endpoint), true, "the second save still waits");
    assert.equal(takeInlineRefusal(endpoint), false);
    const refused = awaitInlineAnswer(endpoint);
    assert.equal(takeInlineRefusal(endpoint), true);
    awaitInlineAnswer(endpoint);
    refused();
    assert.equal(takeInlineRefusal(endpoint), true, "the late end of a refused save leaves the next one waiting");
});

// #1324: a save that is never answered stops waiting when the field gives up on it, so it cannot
// keep a later notice back.
test("a wait runs out after the time a field waits for its save", context => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    context.onTestFinished(() => { vi.useRealTimers(); });
    const endpoint = "/set/data/osc_port";
    awaitInlineAnswer(endpoint);
    vi.advanceTimersByTime(INLINE_ANSWER_WAIT_MS - 1);
    assert.equal(takeInlineRefusal(endpoint), true, "still waiting just before the time runs out");
    awaitInlineAnswer(endpoint);
    vi.advanceTimersByTime(INLINE_ANSWER_WAIT_MS);
    assert.equal(takeInlineRefusal(endpoint), false, "no longer waiting once it has");
    // The fields give up on a save after the same time: a text field and a form's draft.
    for (const file of ["./config_page_setter/useSettingsLogics.ts", "../voice/useSettingsDraft.tsx"]) {
        const gives_up = /setTimeout\(\(\) => \{[^\n]*(?:save_failed|save_unconfirmed)[^\n]*\}, (\d+)\)/.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
        assert.equal(Number(gives_up?.[1]), INLINE_ANSWER_WAIT_MS, file);
    }
});

test("a refusal is said in its code's words, or as could not be saved", () => {
    assert.deepEqual(refusalKeys("AUTH_DEEPL_LENGTH"),
        ["common_error.deepl_auth_key_invalid_length", "backend_errors.AUTH_DEEPL_LENGTH", "config_page.auto_save.save_failed"]);
    assert.deepEqual(refusalKeys("AUTH_OPENAI_FAILED"), ["backend_errors.AUTH_OPENAI_FAILED", "config_page.auto_save.save_failed"]);
    assert.deepEqual(refusalKeys(undefined), ["config_page.auto_save.save_failed"]);
    assert.equal(errorCodeOf({ error_code: "X" }), "X");
    assert.equal(errorCodeOf({ data: "old" }), undefined);
    assert.equal(errorCodeOf(null), undefined);
});

// #1111: a form's save says its own refusal: the refusal skips the notice, and the words come from
// its code. An accepted save takes the words away.
test("a form's save says its refusal under the form and skips the notice", async () => {
    const said: (string[] | null)[] = [];
    const say = (keys: string[] | null) => { said.push(keys); };
    let refused = false;
    await saveSaidInline("/set/data/form_a", () => {
        refused = takeInlineRefusal("/set/data/form_a");
        return { status: 400, result: { error_code: "VALIDATION_INVALID_IP" } };
    }, say);
    assert.equal(refused, true, "the notice is skipped while the form waits");
    assert.equal(takeInlineRefusal("/set/data/form_a"), false, "and not after");
    await saveSaidInline("/set/data/form_a", () => ({ status: 200, result: [] }), say);
    assert.equal(takeInlineRefusal("/set/data/form_a"), false, "an accepted save leaves nothing waiting");
    await assert.rejects(saveSaidInline("/set/data/form_a", () => { throw new Error("gone"); }, say));
    assert.equal(takeInlineRefusal("/set/data/form_a"), false);
    assert.deepEqual(said, [["backend_errors.VALIDATION_INVALID_IP", "config_page.auto_save.save_failed"], null, ["config_page.auto_save.save_failed"]]);
});
