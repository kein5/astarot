import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENGINE_FORM_SETTING_ID, apiRequest, engineRequest, entryState, isUsersWeight, languageCodes, weightLabel } from "./translationCatalog.ts";
import { isRelayAllowed } from "../common/vrPanelWire.ts";
import { featureResyncReads } from "../common/pendingRequestRecovery.ts";

const engineForm = (overrides = {}) => ({ name: " Mine ", folder: '"C:\\Models\\nllb"', runtime: "onnx", languages: "", ...overrides });
const apiForm = (overrides = {}) => ({ name: "Home", url: " http://192.168.1.5:8000/v1 ", model: " qwen ", auth_key: " k ", protocol: "openai_compatible", ...overrides });

test("an engine entry names its folder, its runtime and the languages it offers", () => {
    assert.deepEqual(engineRequest(engineForm()),
        { request: { group: "engine", name: "Mine", runtime: "onnx", folder: "C:\\Models\\nllb", languages: [] } });
    assert.deepEqual(engineRequest(engineForm({ languages: "ja, en  ja、eng_Latn" })).request.languages, ["ja", "en", "eng_Latn"]);
});

test("an engine entry that cannot pass is not sent", () => {
    assert.deepEqual(engineRequest(engineForm({ name: " " })), { problem: "name_missing" });
    assert.deepEqual(engineRequest(engineForm({ name: "x".repeat(81) })), { problem: "name_long" });
    assert.deepEqual(engineRequest(engineForm({ folder: "  " })), { problem: "folder_missing" });
    assert.deepEqual(engineRequest(engineForm({ languages: "ja, 日本語" })), { problem: "languages_invalid" });
    assert.equal(languageCodes("a/b"), null);
});

test("an API entry carries its key once, trimmed, with the address and model", () => {
    assert.deepEqual(apiRequest(apiForm()), { request: {
        group: "api", name: "Home", protocol: "openai_compatible", url: "http://192.168.1.5:8000/v1", model: "qwen", auth_key: "k" } });
    assert.equal(apiRequest(apiForm({ model: "" })).request.model, "");
    assert.deepEqual(apiRequest(apiForm({ url: "" })), { problem: "url_missing" });
    assert.deepEqual(apiRequest(apiForm({ url: "ftp://host" })), { problem: "url_invalid" });
    assert.deepEqual(apiRequest(apiForm({ url: "http://a b" })), { problem: "url_invalid" });
    assert.deepEqual(apiRequest(apiForm({ auth_key: " " })), { problem: "key_missing" });
    assert.deepEqual(apiRequest(apiForm({ model: "m".repeat(201) })), { problem: "model_long" });
});

test("a user's local weight shows the name it was added under", () => {
    const catalog = { engine: [
        { id: "m2m100_418M-ct2-int8", weight: "m2m100_418M-ct2-int8", origin: "builtin", name: "m2m100_418M-ct2-int8" },
        { id: "tr-1", weight: "user:tr-1", origin: "user", name: "My NLLB" },
    ], api: [], runtimes: ["onnx"], protocols: ["openai_compatible"] };
    assert.equal(weightLabel("user:tr-1", catalog), "My NLLB");
    assert.equal(weightLabel("user:tr-2", catalog), "user:tr-2");
    // A folder model of earlier versions is no longer the user's model (#597).
    assert.equal(weightLabel("custom:folder", null), "custom:folder");
    assert.equal(weightLabel("m2m100_418M-ct2-int8", catalog), "m2m100_418M-ct2-int8");
    assert.ok(isUsersWeight("user:tr-1") && !isUsersWeight("custom:x") && !isUsersWeight("m2m100_418M-ct2-int8"));
});

test("a card says a problem before whether it is in use", () => {
    const engine = (fields) => ({ id: "tr-1", origin: "user", name: "x", runtime: "onnx", weight: "user:tr-1", available: true, in_use: false, status: "ok", ...fields });
    assert.equal(entryState(engine({})), "ready");
    assert.equal(entryState(engine({ in_use: true })), "in_use");
    assert.equal(entryState(engine({ available: false })), "unavailable");
    assert.equal(entryState(engine({ status: "missing", in_use: true })), "missing");
    assert.equal(entryState({ id: "tr-2", origin: "user", name: "y", status: "unsupported" }), "unsupported");
    assert.equal(entryState({ id: "tr-3", origin: "user", name: "z", status: "ok", in_use: true }), "in_use");
});

test("an API entry whose key the store never took has no key once the app was closed", () => {
    const api = (fields) => ({ id: "tr-4", origin: "user", name: "Home", url: "http://192.168.1.5:8000/v1", status: "ok", has_key: true, key_in_memory: false, in_use: false, ...fields });
    assert.equal(entryState(api({})), "ready");
    // Held in memory for this run: usable until the app closes.
    assert.equal(entryState(api({ has_key: false, key_in_memory: true })), "ready");
    assert.equal(entryState(api({ has_key: false, key_in_memory: true, in_use: true })), "in_use");
    assert.equal(entryState(api({ has_key: false })), "no_key");
    assert.equal(entryState(api({ has_key: false, in_use: true })), "no_key", "a problem first");
    assert.equal(entryState(api({ has_key: false, status: "unsupported" })), "unsupported");
    // A built-in API says nothing about a key of its own.
    assert.equal(entryState({ id: "Ollama", origin: "builtin", name: "Ollama", kind: "local_server", available: true }), "ready");
});

test("the catalog routes stay out of the VR panel relay and resync after a failure", () => {
    for (const path of ["/get/data/translation_catalog", "/run/register_translation_catalog_entry",
        "/run/remove_translation_catalog_entry", "/run/use_translation_catalog_entry"])
        assert.equal(isRelayAllowed(path), false, path);
    for (const path of ["/run/register_translation_catalog_entry", "/run/remove_translation_catalog_entry", "/run/use_translation_catalog_entry"])
        assert.equal(featureResyncReads[path], "/get/data/translation_catalog");
});

// #597: the folder of earlier versions is no longer read. The translation page shows a note only
// while the core says that folder holds something, and its button leads to the add form.
test("the note about the translation-models folder follows the core's flag and leads to the add form", () => {
    const box = new URL("../../views/app/config_page/setting_section/setting_box/translation/", import.meta.url);
    const page = readFileSync(new URL("Translation.jsx", box), "utf8");
    const catalog = readFileSync(new URL("TranslationCatalog.jsx", box), "utf8");
    assert.match(page, /translationCatalog\?\.retired_folder_used === true && <RetiredModelsFolderNote \/>/);
    assert.match(page, /revealSetting\(\{ setting_id: ENGINE_FORM_SETTING_ID \}\)/);
    assert.match(catalog, /data-setting-id=\{ENGINE_FORM_SETTING_ID\}/);
    assert.equal(ENGINE_FORM_SETTING_ID, "translation_catalog_add_engine");
    // Nothing about folder items is left in the catalog's cards.
    assert.doesNotMatch(catalog, /origin === "folder"|folder_help|badge\.folder/);
    // The note is placed above the model list.
    assert.ok(page.indexOf("<RetiredModelsFolderNote />") < page.indexOf("<CTranslate2WeightType_Box />"));
});