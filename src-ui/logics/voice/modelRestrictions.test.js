import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../test/hookHarness.js";
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

for (const language of ["en", "ja"]) test(`${language}: every restriction and its refusal have words`, () => {
    const locale = yaml.load(readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8"));
    const section = locale.model_downloads;
    for (const kind of RESTRICTIONS) {
        for (const key of ["title", "note", "acknowledge"]) assert.equal(typeof section.restriction[kind][key], "string", `${kind}.${key}`);
        assert.match(section.restriction[kind].note, /\{\{license\}\}/, "the note names the license");
    }
    for (const key of ["title", "note"]) assert.equal(typeof section.restriction.other[key], "string");
    assert.equal(typeof section.errors.model_download_restriction_unacknowledged, "string");
});

async function dialog(context, entry) {
    const runtime = hooks(), sent = [];
    const downloads = { catalog: { models: [entry], catalog_version: "reviewed-catalog" }, state: { jobs: {} }, hardware: {},
        ensureHardware: () => {}, send: (endpoint, data) => sent.push([endpoint, data]) };
    const { ModelDownloads } = await loadModule(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/ModelDownloads.jsx", import.meta.url), runtime, {
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
    find(render(), node => node.type === "button" && node.props.children === "model_downloads.review").props.onClick();
    return { render, sent };
}

const all = (tree, predicate, found = []) => {
    if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, found));
    else if (tree && typeof tree === "object") {
        if (predicate(tree)) found.push(tree);
        all(tree.props?.children, predicate, found);
    }
    return found;
};
const checkboxes = tree => all(tree, node => node.type === "input" && node.props.type === "checkbox");
const start = tree => find(tree, node => node.type === "button" && node.props.children === "model_downloads.start");

test("the review of a non-commercial model asks for a second checkbox and sends what was ticked", async context => {
    const s = await dialog(context, nllb);
    let tree = s.render();
    // The note says it, marked like a warning, before the consent.
    const note = find(tree, node => node.type?.name === "RestrictionNote");
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

test("the review of an unrestricted model keeps its one checkbox and its request", async context => {
    const s = await dialog(context, m2m);
    let tree = s.render();
    assert.equal(find(tree, node => node.type?.name === "RestrictionNote"), null);
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
    find(tree, node => node.type === "button" && node.props.autoFocus).props.onClick();
    tree = s.render();
    find(tree, node => node.type === "button" && node.props.children === "model_downloads.review").props.onClick();
    tree = s.render();
    assert.deepEqual(checkboxes(tree).map(box => box.props.checked), [false, false]);
    assert.equal(start(tree).props.disabled, true);
});
