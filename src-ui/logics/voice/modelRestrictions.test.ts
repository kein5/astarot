import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { TestContext } from "vitest";
import yaml from "js-yaml";
import { hooks, loadModule, find, unchecked } from "../test/hookHarness.ts";
import type { TreeNode } from "../test/hookHarness.ts";
import * as languageNames from "../common/languageNames.ts";
import * as modelCatalog from "./modelCatalog.ts";
import * as modelHardwareWarning from "./modelHardwareWarning.ts";
import * as modelRestrictions from "./modelRestrictions.ts";
import { RESTRICTIONS, canStart, restrictionsOf, startRequest } from "./modelRestrictions.ts";

// A translation entry under NLLB-200's license, as the catalog row comes from the backend.
const nllb = { id: "nllb-200-distilled-600m-onnx-int8", target: "translation", name: "NLLB-200 distilled 600M · int8",
    provider: "Meta / ASTAROT", license: "CC-BY-NC-4.0", licenses: ["https://creativecommons.org/licenses/by-nc/4.0/"],
    notice: "translation", total_bytes: 643, artifacts: [{ filename: "manifest.json", size: 1 }], destination: "/models/nllb",
    source: "https://huggingface.co/test/nllb/tree/rev", repo: "test/nllb", restrictions: ["non_commercial"] };
const m2m = { ...nllb, id: "m2m100-418m-onnx-int8", name: "M2M100 418M · int8", license: "MIT", restrictions: [] };

test("the start request carries the acknowledgement only for a restricted model", () => {
    const seen = { ...nllb, catalog_version: "reviewed" };
    assert.deepEqual(startRequest(seen, ["non_commercial"]),
        { id: nllb.id, consent: true, catalog_version: "reviewed", acknowledged: ["non_commercial"] });
    // What was not ticked is not sent, so the backend refuses rather than assumes.
    assert.deepEqual(startRequest(seen, []), { id: nllb.id, consent: true, catalog_version: "reviewed", acknowledged: [] });
    // A model without restrictions sends exactly the request it sent before.
    assert.deepEqual(startRequest({ ...m2m, catalog_version: "reviewed" }, ["non_commercial"]),
        { id: m2m.id, consent: true, catalog_version: "reviewed" });
    assert.deepEqual(startRequest({ id: "old-row", catalog_version: "reviewed" }), { id: "old-row", consent: true, catalog_version: "reviewed" });
});

test("starting needs the consent and every restriction ticked; an unknown kind cannot be ticked", () => {
    assert.equal(canStart(m2m, true, []), true);
    assert.equal(canStart(m2m, false, []), false);
    assert.equal(canStart(nllb, true, []), false);
    assert.equal(canStart(nllb, false, ["non_commercial"]), false);
    assert.equal(canStart(nllb, true, ["non_commercial"]), true);
    assert.equal(canStart({ restrictions: ["non_commercial", "future_terms"] }, true, ["non_commercial", "future_terms"]), false);
    assert.deepEqual(restrictionsOf({ restrictions: ["non_commercial", 3, "non_commercial"] }), ["non_commercial"]);
    assert.deepEqual(restrictionsOf({ restrictions: "non_commercial" }), []);
    assert.deepEqual(restrictionsOf(null), []);
});

// A key of a mapping in a locale tree, or undefined.
const child = (node: unknown, key: string): unknown =>
    typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined;

for (const language of ["en", "ja"]) test(`${language}: every restriction and its refusal have words`, () => {
    const locale = yaml.load(readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8"));
    const section = child(locale, "model_downloads");
    for (const kind of RESTRICTIONS) {
        const restriction = child(child(section, "restriction"), kind);
        for (const key of ["title", "note", "acknowledge"]) assert.equal(typeof child(restriction, key), "string", `${kind}.${key}`);
        const note = child(restriction, "note");
        assert.ok(typeof note === "string");
        assert.match(note, /\{\{license\}\}/, "the note names the license");
    }
    for (const key of ["title", "note"]) assert.equal(typeof child(child(child(section, "restriction"), "other"), key), "string");
    assert.equal(typeof child(child(section, "errors"), "model_download_restriction_unacknowledged"), "string");
});

async function dialog(context: TestContext, entry: object) {
    const runtime = hooks(), sent: [string, unknown][] = [];
    const downloads = { catalog: { models: [entry], catalog_version: "reviewed-catalog" }, state: { jobs: {} }, hardware: {},
        ensureHardware: () => {}, send: (endpoint: string, data?: unknown) => sent.push([endpoint, data]) };
    const { ModelDownloads } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/ModelDownloads.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/ModelDownloads.tsx", import.meta.url), runtime, {
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": {},
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => downloads },
        "../../../../../../logics/voice/modelHardwareAdvice": { modelAdvice: () => ({}) },
        "../../../../../../logics/voice/modelCatalog": modelCatalog,
        "../../../../../../logics/voice/modelHardwareWarning": modelHardwareWarning,
        "../../../../../../logics/voice/modelRestrictions": modelRestrictions,
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => {} }) },
        "../../../../../../logics/common/languageNames": languageNames,
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "./EngineCatalog": { EngineCatalog: "engines" },
        "./UserModels": { UserModelCards: "user-model-cards", UserModelRegistration: "user-model-registration" },
        "./VoiceAudition": { AuditionButton: "audition-button", AuditionNote: "audition-note" },
    });
    context.onTestFinished(() => runtime.unmount());
    const render = () => runtime.render(ModelDownloads, { targets: ["translation"], expected: { translation: {} } });
    found(render(), node => node.type === "button" && node.props.children === "model_downloads.review").props.onClick();
    return { render, sent };
}

// The node find finds; none fails here, as reading its props would.
const found = (tree: unknown, predicate: (node: TreeNode) => boolean) => {
    const node = find(tree, predicate);
    assert.ok(node);
    return node;
};
// A component's name, as `type?.name` read it: a tag's type has none.
const typeName = (node: TreeNode) => typeof node.type === "function" ? node.type.name : undefined;
const all = (tree: unknown, predicate: (node: TreeNode) => boolean, matches: TreeNode[] = []) => {
    if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, matches));
    else if (tree && typeof tree === "object") {
        // An object in the rendered tree is an element, as find reads it.
        const node = unchecked<TreeNode>(tree);
        if (predicate(node)) matches.push(node);
        all(node.props?.children, predicate, matches);
    }
    return matches;
};
const checkboxes = (tree: unknown) => all(tree, node => node.type === "input" && node.props.type === "checkbox");
const start = (tree: unknown) => found(tree, node => node.type === "button" && node.props.children === "model_downloads.start");

test("the review of a non-commercial model asks for a second checkbox and sends what was ticked", async context => {
    const s = await dialog(context, nllb);
    let tree = s.render();
    // The note says it, marked like a warning, before the consent.
    const note = found(tree, node => typeName(node) === "RestrictionNote");
    assert.deepEqual([note.props.kind, note.props.license], ["non_commercial", "CC-BY-NC-4.0"]);
    const [consent, acknowledgement] = checkboxes(tree);
    assert.equal(checkboxes(tree).length, 2);
    assert.equal(acknowledgement.props["aria-describedby"], note.props.id, "the checkbox is described by the note");
    assert.equal(start(tree).props.disabled, true);
    consent.props.onChange({ target: { checked: true } });
    tree = s.render();
    assert.equal(start(tree).props.disabled, true, "the consent alone does not start it");
    start(tree).props.onClick();
    assert.equal(s.sent.filter(([endpoint]) => endpoint.startsWith("/run/")).length, 0);
    checkboxes(tree)[1].props.onChange({ target: { checked: true } });
    tree = s.render();
    checkboxes(tree)[0].props.onChange({ target: { checked: false } });
    tree = s.render();
    assert.equal(start(tree).props.disabled, true, "nor does the acknowledgement alone");
    checkboxes(tree)[0].props.onChange({ target: { checked: true } });
    tree = s.render();
    assert.equal(start(tree).props.disabled, false);
    start(tree).props.onClick();
    assert.deepEqual(s.sent.filter(([endpoint]) => endpoint.startsWith("/run/")), [["/run/start_model_download",
        { id: nllb.id, consent: true, catalog_version: "reviewed-catalog", acknowledged: ["non_commercial"] }]]);
});

// A translation model under the Gemma Terms of Use (TranslateGemma), and one that carries both
// kinds. Only translation entries carry `gemma_terms`; the backend leaves it out of a speech
// model such as Irodori-TTS v4 Large.
const gemma = { ...m2m, id: "translategemma-4b-q4km", name: "TranslateGemma 4B · Q4_K_M", target: "translation",
    license: "Gemma Terms of Use", restrictions: ["gemma_terms"] };

test("the Gemma terms are a checkbox of their own, apart from the consent", async context => {
    assert.equal(canStart(gemma, true, []), false);
    assert.equal(canStart(gemma, true, ["non_commercial"]), false);
    assert.equal(canStart(gemma, true, ["gemma_terms"]), true);
    const both = { ...gemma, restrictions: ["non_commercial", "gemma_terms"] };
    assert.equal(canStart(both, true, ["gemma_terms"]), false);
    assert.equal(canStart(both, true, ["gemma_terms", "non_commercial"]), true);
    assert.deepEqual(startRequest({ ...both, catalog_version: "v" }, ["gemma_terms", "non_commercial"]).acknowledged, ["non_commercial", "gemma_terms"]);
    const s = await dialog(context, gemma);
    let tree = s.render();
    const note = found(tree, node => typeName(node) === "RestrictionNote");
    assert.deepEqual([note.props.kind, note.props.license], ["gemma_terms", gemma.license]);
    const boxes = checkboxes(tree);
    assert.equal(boxes.length, 2);
    assert.equal(boxes[1].props["aria-describedby"], note.props.id);
    boxes[0].props.onChange({ target: { checked: true } });
    tree = s.render();
    assert.equal(start(tree).props.disabled, true, "the consent alone does not accept the terms");
    checkboxes(tree)[1].props.onChange({ target: { checked: true } });
    tree = s.render();
    start(tree).props.onClick();
    assert.deepEqual(s.sent.filter(([endpoint]) => endpoint.startsWith("/run/")), [["/run/start_model_download",
        { id: gemma.id, consent: true, catalog_version: "reviewed-catalog", acknowledged: ["gemma_terms"] }]]);
});

test("the review of an unrestricted model keeps its one checkbox and its request", async context => {
    const s = await dialog(context, m2m);
    let tree = s.render();
    assert.equal(find(tree, node => typeName(node) === "RestrictionNote"), null);
    assert.equal(checkboxes(tree).length, 1);
    checkboxes(tree)[0].props.onChange({ target: { checked: true } });
    tree = s.render();
    start(tree).props.onClick();
    assert.deepEqual(s.sent.filter(([endpoint]) => endpoint.startsWith("/run/")), [["/run/start_model_download",
        { id: m2m.id, consent: true, catalog_version: "reviewed-catalog" }]]);
});

test("reopening the review clears an earlier acknowledgement", async context => {
    const s = await dialog(context, nllb);
    let tree = s.render();
    checkboxes(tree).forEach(box => box.props.onChange({ target: { checked: true } }));
    tree = s.render();
    found(tree, node => node.type === "button" && node.props.autoFocus).props.onClick();
    tree = s.render();
    found(tree, node => node.type === "button" && node.props.children === "model_downloads.review").props.onClick();
    tree = s.render();
    assert.deepEqual(checkboxes(tree).map(box => box.props.checked), [false, false]);
    assert.equal(start(tree).props.disabled, true);
});
