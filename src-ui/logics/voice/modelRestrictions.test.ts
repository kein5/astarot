import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, componentName, kitStandIns } from "../test/hookHarness.ts";
import type { HookRuntime } from "../test/hookHarness.ts";
import { localeAt, readLocale, textAt } from "../test/locales.ts";
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
    const locale = readLocale(language);
    for (const kind of RESTRICTIONS) {
        const restriction = `model_downloads.restriction.${kind}`;
        for (const key of ["title", "note", "acknowledge"]) assert.equal(typeof localeAt(locale, `${restriction}.${key}`), "string", `${kind}.${key}`);
        assert.match(textAt(locale, `${restriction}.note`), /\{\{license\}\}/, "the note names the license");
    }
    for (const key of ["title", "note"]) assert.equal(typeof localeAt(locale, `model_downloads.restriction.other.${key}`), "string");
    assert.equal(typeof localeAt(locale, "model_downloads.errors.model_download_restriction_unacknowledged"), "string");
});

// The catalog's headings as they are, with the hint mark as a name: the catalog draws them in place.
const loadHeading = (runtime: HookRuntime) => loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/catalogHeading.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/catalogHeading.tsx", import.meta.url), runtime,
    { "../_components/hint/Hint": { Hint: "hint" } });

async function dialog(context: TestContext, entry: object, state: object = { jobs: {} }, open = true, usable: string[] = []) {
    const runtime = hooks(), sent: [string, unknown][] = [];
    const downloads = { catalog: { models: [entry], catalog_version: "reviewed-catalog" }, state, hardware: {},
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
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => false },
        "../_components/fold/Fold": { Fold: "fold" },
        "./catalogHeading": await loadHeading(runtime),
        "./catalogLayout": { useCatalogLayout: () => "list", CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch" },
    });
    context.onTestFinished(() => runtime.unmount());
    const render = () => runtime.render(ModelDownloads, { targets: ["translation"], expected: { translation: {} }, usable });
    if (open) findIn(render(), node => node.type === "button" && node.props.children === "model_downloads.review").props.onClick();
    return { render, sent };
}

// #947: a translation model holds no path; once it is on the PC and the app can use it (applied
// in this run, or found after a restart; the core checked its files), it is ready, and its card
// offers no check or preparation again.
test("a translation model on the PC that the app can use offers no check or preparation", async context => {
    const buttonWords = (tree: unknown) => nodesIn(tree).filter(node => node.type === "button").map(node => node.props.children);
    const words = (tree: unknown) => nodesIn(tree).flatMap(node => [node.props?.children].flat()).filter(child => typeof child === "string");
    const offersNothing = (tree: unknown) => !buttonWords(tree).some(word => word === "model_catalog.prepare" || word === "model_downloads.review")
        && !words(tree).includes("model_catalog.prepare_hint");
    const applied = await dialog(context, nllb, { jobs: { [nllb.id]: { job_id: "j1", phase: "applied", paths: {} } } }, false, [nllb.id]);
    assert.ok(offersNothing(applied.render()), "applied in this run");
    const restarted = await dialog(context, nllb, { jobs: {}, downloaded: { [nllb.id]: {} } }, false, [nllb.id]);
    assert.ok(offersNothing(restarted.render()), "found after a restart");
    // Its files there by their sizes but not usable (a damaged file): its check, as before.
    const damaged = await dialog(context, nllb, { jobs: {}, downloaded: { [nllb.id]: {} } }, false, []);
    assert.ok(buttonWords(damaged.render()).includes("model_catalog.prepare"));
    // Not on the PC: the review, as before.
    const missing = await dialog(context, nllb, { jobs: {} }, false);
    assert.ok(buttonWords(missing.render()).includes("model_downloads.review"));
});

const checkboxes = (tree: unknown) => nodesIn(tree).filter(node => node.type === "input" && node.props.type === "checkbox");
// The review's buttons are the kit's (D-23).
const start = (tree: unknown) => findIn(tree, node => node.type === kitStandIns.Button && node.props.children === "model_downloads.start");

test("the review of a non-commercial model asks for a second checkbox and sends what was ticked", async context => {
    const s = await dialog(context, nllb);
    let tree = s.render();
    // The note says it, marked like a warning, before the consent.
    const note = findIn(tree, node => componentName(node) === "RestrictionNote");
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
    const note = findIn(tree, node => componentName(node) === "RestrictionNote");
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
    assert.equal(find(tree, node => componentName(node) === "RestrictionNote"), null);
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
    checkboxes(tree).forEach(box => { box.props.onChange({ target: { checked: true } }); });
    tree = s.render();
    findIn(tree, node => node.type === kitStandIns.Button && node.props.autoFocus).props.onClick();
    tree = s.render();
    findIn(tree, node => node.type === "button" && node.props.children === "model_downloads.review").props.onClick();
    tree = s.render();
    assert.deepEqual(checkboxes(tree).map(box => box.props.checked), [false, false]);
    assert.equal(start(tree).props.disabled, true);
});
