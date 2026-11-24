import assert from "node:assert/strict";
import { test } from "vitest";
import { awaitInlineAnswer, errorCodeOf, refusalKeys, saveSaidInline, settleInlineAnswer, takeInlineRefusal } from "./fieldErrors.ts";

// #1111: only the refusal of a field's own save is said under the field instead of as a notice.
test("a refusal is taken once for each save a field waits for, and never otherwise", () => {
    const endpoint = "/set/data/lmstudio_url";
    assert.equal(takeInlineRefusal(endpoint), false, "a start-up repair keeps its notice");
    awaitInlineAnswer(endpoint);
    awaitInlineAnswer(endpoint);
    assert.equal(takeInlineRefusal(endpoint), true);
    assert.equal(takeInlineRefusal(endpoint), true);
    assert.equal(takeInlineRefusal(endpoint), false);
    awaitInlineAnswer(endpoint);
    settleInlineAnswer(endpoint);
    assert.equal(takeInlineRefusal(endpoint), false, "an accepted save leaves nothing to take");
    assert.equal(takeInlineRefusal(undefined), false);
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
