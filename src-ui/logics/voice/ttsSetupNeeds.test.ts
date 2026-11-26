import assert from "node:assert/strict";
import { test } from "vitest";
import { ttsModelsNeeded } from "./ttsSetupNeeds.ts";

// #1230: the TTS page's 「モデルとサーバー」 starts open while a voice that the bundled speech.cpp
// makes has no model, as the page reads the settings.
test("text to speech needs a model while a voice of the bundled server has none", () => {
    const none = { japanese: { model: "" }, multilingual: { model: "  " } };
    // The defaults: both voices from the bundled server, no model.
    assert.equal(ttsModelsNeeded({}, none), true);
    assert.equal(ttsModelsNeeded({}, {}), true, "a role without a profile has no model");
    assert.equal(ttsModelsNeeded({}, { japanese: { model: "/models/ja.gguf" }, multilingual: { model: "/models/multi.gguf" } }), false);
    // One voice without its model is enough.
    assert.equal(ttsModelsNeeded({}, { japanese: { model: "/models/ja.gguf" }, multilingual: { model: "" } }), true);
});

test("a voice from a server of the user's own, or from an installed engine, needs no model here", () => {
    const none = { japanese: { model: "" }, multilingual: { model: "" } };
    assert.equal(ttsModelsNeeded({ japanese_server: "external", multilingual_server: "external" }, none), false);
    // Japanese read by an engine the user installed (ADR-008); the other languages from their server.
    assert.equal(ttsModelsNeeded({ japanese_engine: "voicevox", multilingual_server: "external" }, none), false);
    assert.equal(ttsModelsNeeded({ japanese_engine: "voicevox" }, none), true, "the other languages still need theirs");
    assert.equal(ttsModelsNeeded({ japanese_engine: "speechcpp", multilingual_server: "external" }, none), true);
});

test("nothing is needed before the settings are known", () => {
    assert.equal(ttsModelsNeeded(null, {}), false);
    assert.equal(ttsModelsNeeded({}, null), false);
    assert.equal(ttsModelsNeeded(undefined, undefined), false);
});
