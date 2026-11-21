import assert from "node:assert/strict";
import { test } from "vitest";
import { LOCAL_TRANSLATION_ENGINE_NAME_KEY, translatorLabel, translatorName } from "./translatorLabel.ts";

// Test data: a translation that names a key by itself.
const t = (key: string) => `t:${key}`;

test("the local translation is named as its section of Settings, the other engines by their services (#565)", () => {
    assert.equal(translatorLabel({ id: "CTranslate2", label: "AI translation (local)" }, t), `t:${LOCAL_TRANSLATION_ENGINE_NAME_KEY}`);
    assert.equal(translatorLabel({ id: "DeepL_API", label: "DeepL API" }, t), "DeepL API");
    assert.equal(translatorLabel(null, t), "");
});

test("a notice names a local model by its model name and an engine as the UI does", () => {
    assert.equal(translatorName("nllb-200-distilled-600M-ct2-int8", "CTranslate2", t), "NLLB-200 distilled 600M · int8");
    assert.equal(translatorName("nllb-200-3.3B-ct2-int8", null, t), "NLLB-200 3.3B · int8", "a model no longer offered keeps its name");
    assert.equal(translatorName(undefined, "CTranslate2", t), `t:${LOCAL_TRANSLATION_ENGINE_NAME_KEY}`);
    assert.equal(translatorName(undefined, "Gemini_API", t), "Gemini API");
    assert.equal(translatorName(undefined, "Unknown_API", t), "Unknown_API");
    assert.equal(translatorName(undefined, undefined, t), undefined);
});
