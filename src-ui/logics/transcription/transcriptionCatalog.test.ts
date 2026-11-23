import assert from "node:assert/strict";
import { test } from "vitest";
import { asrApiRequest, asrEntryState, isTranscriptionCatalog } from "./transcriptionCatalog.ts";
import type { AsrApiItem } from "./transcriptionCatalog.ts";

// #414: the form of a speech recognition API the user adds refuses what cannot pass before it is
// sent, and an entry's card says whether it can be used.
const form = { name: " Home ", url: " http://192.168.1.5:8000/v1 ", model: " whisper-large ", auth_key: " sk-1 ", protocol: "openai_compatible" };

test("a whole form becomes the request; a missing or too long field is said before sending", () => {
    assert.deepEqual(asrApiRequest(form), { request: { name: "Home", protocol: "openai_compatible", url: "http://192.168.1.5:8000/v1", model: "whisper-large", auth_key: "sk-1" } });
    assert.deepEqual(asrApiRequest({ ...form, model: "" }), { request: { name: "Home", protocol: "openai_compatible", url: "http://192.168.1.5:8000/v1", model: "", auth_key: "sk-1" } });
    for (const [change, problem] of [
        [{ name: " " }, "name_missing"], [{ name: "x".repeat(81) }, "name_long"],
        [{ url: "" }, "url_missing"], [{ url: "ftp://x" }, "url_invalid"], [{ url: "http://a b" }, "url_invalid"],
        [{ model: "m".repeat(201) }, "model_long"], [{ auth_key: "  " }, "key_missing"],
    ] as const) {
        assert.deepEqual(asrApiRequest({ ...form, ...change }), { problem }, JSON.stringify(change));
    }
    // No protocol chosen: the one this version has.
    assert.deepEqual(asrApiRequest({ ...form, protocol: "" }), asrApiRequest(form));
});

test("an entry's state: unsupported, no key, in use or ready", () => {
    const item = (extra: Partial<AsrApiItem>): AsrApiItem => ({ id: "asr-1", origin: "user", name: "Home", protocol: "openai_compatible", url: "u", model: "", has_key: true, ...extra });
    assert.equal(asrEntryState(item({})), "ready");
    assert.equal(asrEntryState(item({ in_use: true })), "in_use");
    assert.equal(asrEntryState(item({ has_key: false })), "no_key");
    assert.equal(asrEntryState(item({ has_key: false, key_in_memory: true })), "ready", "held until the app closes");
    assert.equal(asrEntryState(item({ status: "unsupported", in_use: true })), "unsupported");
    assert.equal(isTranscriptionCatalog({ api: [], protocols: [] }), true);
    assert.equal(isTranscriptionCatalog({ protocols: [] }), false);
    assert.equal(isTranscriptionCatalog(null), false);
});
