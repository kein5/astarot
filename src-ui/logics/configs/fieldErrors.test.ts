import assert from "node:assert/strict";
import { test } from "vitest";
import { awaitInlineAnswer, errorCodeOf, refusalKeys, settleInlineAnswer, takeInlineRefusal } from "./fieldErrors.ts";

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
