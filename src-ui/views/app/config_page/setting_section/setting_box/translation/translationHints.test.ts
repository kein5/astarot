import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

// #614: the translation page shows its rows' general descriptions as hints. What is read before
// acting stays on screen: a model's license, a warning, who a provider charges, what is sent out.
const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const page = read("Translation.tsx");
// The code of one of the page's own components.
const component = (name: string) => {
    const start = page.indexOf(`const ${name} = `);
    assert.ok(start >= 0, name);
    return page.slice(start, page.indexOf("\n};\n", start));
};

test("the whole translation page is inside HintDescriptions", () => {
    const body = component("Translation");
    assert.match(body, /<HintDescriptions>\s*<div className=\{styles\.container\}>[\s\S]*<TranslationCatalogSection \/>\s*<\/div>\s*<\/HintDescriptions>/);
});

test("a model's license and the note on a model of one's own stay under their options", () => {
    const options = component("CTranslate2WeightType_Box").split("const c_translate2_weight_types_object")[1].split("return (")[0];
    // Both kinds of option: a built-in model with its license, and a model the user added.
    assert.equal([...options.matchAll(/keep_desc: true/g)].length, 2);
    assert.match(options, /ctranslate2_weight_type\.custom_model"\),\s*keep_desc: true/);
    assert.match(options, /desc_tone: non_commercial \? "warning" : undefined,[\s\S]*keep_desc: true/);
});

test("who is charged, the retired folder and the unavailable models stay on screen", () => {
    assert.match(component("GoogleCloudAuthKey_Box"), /google_cloud_auth_key\.desc"\)\}[\s\S]*?\n\s*keep_desc\n/);
    assert.match(component("RetiredModelsFolderNote"), /<FormRow group [^>]*fold=\{false\} keepDescription>/);
    assert.match(component("OpenAICompatibleCredentials"), /<CredentialPair [^>]*section="translation" keepUrlDescription \/>/);
    // Drawn by themselves, so the page's hints do not reach them.
    assert.match(component("AITranslation_Container"), /nothingToGet && <Description text=\{t\("config_page\.translation\.models_unavailable"\)\} fold=\{false\} \/>/);
    assert.match(component("TranslationComputeDevice_Box"), /<p role="status">\{t\("config_page\.translation\.translation_compute_device\.restart_note"\)\}<\/p>/);
});

test("what an LLM engine is sent is said once, in the fold: the sentence on screen, its details as the hint", () => {
    const leads = [...page.matchAll(/<Lead text=\{t\("config_page\.translation\.llm_privacy_lead"\)\} details=\{t\("config_page\.translation\.llm_privacy_desc"\)\} \/>/g)];
    assert.equal(leads.length, 1);
    assert.equal([...page.matchAll(/llm_privacy_(lead|desc)/g)].length, 2, "nowhere else on the page");
    // Inside 「詳細設定」, before the APIs and the local servers it is about.
    const fold = page.split("<AdvancedSection")[1].split("</AdvancedSection>")[0];
    assert.ok(fold.indexOf("<Lead ") > 0 && fold.indexOf("<Lead ") < fold.indexOf("<ExternalTranslationAPI_Container />"));
    // The form that adds an API says it the same way, read before anything is added (decided in #951).
    const catalog = read("TranslationCatalog.tsx");
    assert.equal([...catalog.matchAll(/<Lead text=\{t\("config_page\.translation\.llm_privacy_lead"\)\} details=\{t\("config_page\.translation\.llm_privacy_desc"\)\} \/>/g)].length, 1);
    assert.doesNotMatch(catalog, /<p>\{t\("config_page\.translation\.llm_privacy/);
});

test("the general descriptions are left to become hints", () => {
    // No keep on these rows: their words are what the setting is, the same on every PC.
    for (const [name, key] of [["CTranslate2WeightType_Box", "ctranslate2_weight_type.desc"], ["PapagoClientID_Box", "papago_client_id.desc"]]) {
        const body = component(name);
        assert.ok(body.includes(`desc={t("config_page.translation.${key}")}`), name);
        assert.doesNotMatch(body.split(`config_page.translation.${key}`)[1].split("/>")[0], /keep_desc/, name);
    }
    const deepl = component("DeepLAuthKey_Box");
    assert.match(deepl, /"config_page\.translation\.deepl_auth_key\.desc"/);
    assert.doesNotMatch(deepl, /keep_desc/);
    // What the LLM engines are asked besides the text (#392): what Temperature is, and examples
    // of instructions, are the labels' hints, not kept on screen.
    for (const [name, key] of [["LLMTranslationTemperature_Box", "llm_translation_temperature.desc"], ["LLMTranslationInstructions_Box", "llm_translation_instructions.desc"]]) {
        const body = component(name);
        assert.ok(body.includes(`desc={t("config_page.translation.${key}")}`), name);
        assert.doesNotMatch(body, /keep_desc|lead=/, name);
    }
});

test("the local servers are set up in order: the address, whether it answers, then the model", () => {
    const servers = component("LocalLLM_Container");
    for (const name of ["LMStudio", "Ollama"]) {
        assert.match(servers, new RegExp(`<Provider id="${name}">\\s*<${name}URL_Box \\/>\\s*<${name}ConnectionCheck_Box \\/>\\s*<${name}ModelContainer \\/>`), name);
    }
});
