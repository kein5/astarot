import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, componentName, unchecked } from "../test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../test/hookHarness.ts";
import { loadBridgeRoutes } from "../test/bridgeHarness.ts";
import * as polledState from "../common/polledState.ts";
import * as languageNames from "../common/languageNames.ts";
import * as modelCatalog from "./modelCatalog.ts";
import * as modelHardwareWarning from "./modelHardwareWarning.ts";
import * as modelRestrictions from "./modelRestrictions.ts";
import type { ModelDownloadCatalog, ModelDownloadState } from "./useModelDownloads.ts";

const apply = "/run/apply_model_download", cancel = "/run/cancel_model_download";
const request = { id: "model", job_id: "job" };
type Call = [string, ...unknown[]];
// Test data: download states and catalogs with only the fields the code under test reads.
const downloadState = (value: object) => unchecked<ModelDownloadState>(value);
const catalog = (value: object) => unchecked<ModelDownloadCatalog>(value);

async function setup(t: TestContext, transport: (...args: Call) => Promise<boolean> = async () => true) {
    const runtime = hooks(), calls: Call[] = [];
    const { useModelDownloads } = await loadModule<typeof import("./useModelDownloads.ts")>(new URL("./useModelDownloads.ts", import.meta.url), runtime, {
        "../common/polledState.ts": polledState,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (...args: Call) => {
            calls.push(args); return transport(...args);
        } }) },
    });
    const render = () => runtime.render(useModelDownloads);
    t.onTestFinished(() => runtime.unmount());
    return { runtime, render, calls };
}

for (const first of [apply, cancel]) for (const failed of [false, true]) {
    test(`Apply and Cancel retain the other pending request after ${first} ${failed ? "fails" : "succeeds"}`, async t => {
        const s = await setup(t);
        await s.render().send(apply, request);
        await s.render().send(cancel, request);
        assert.equal(s.calls.length, 2);
        s.render().updateState(downloadState({ observation_id: "20", jobs: { model: { ...request, phase: "cancelled" } } }));
        if (failed) s.render().updateError("download_cancelled", first);
        else s.render().acknowledge(downloadState({ observation_id: "19", jobs: {} }), first);
        assert.ok(s.render().pending, "the other operation is still pending");
        assert.equal(s.render().state.observation_id, "20");
        await s.render().send(apply, { id: "other", job_id: "other-job" });
        await s.render().send("/run/start_model_download", { id: "other" });
        assert.equal(s.calls.length, 2, "competing actions stay blocked");
        s.render().acknowledge(downloadState({ observation_id: "21", jobs: {} }), first === apply ? cancel : apply);
        assert.equal(s.render().pending, null);
    });
}

test("only the matching job can cancel pending Apply; polls and error replies cannot release it", async t => {
    const s = await setup(t);
    await s.render().send(apply, request);
    await s.render().send(cancel, { ...request, job_id: "old-job" });
    await s.render().send(cancel, { ...request, id: "other" });
    assert.equal(s.calls.length, 1);
    s.render().updateError("download_failed", "/get/data/model_download_state");
    s.render().updateError("request_unconfirmed");
    assert.ok(s.render().pending);
    await s.render().send(cancel, request);
    await s.render().send(cancel, request);
    assert.equal(s.calls.length, 2, "duplicate Cancel is blocked");
    s.render().backendStopped();
    assert.equal(s.render().pending, null);
});

// #431-7: a start that never got a reply blocked every later download command, silently.
test("an unanswered start or Apply is released when it times out", async t => {
    const s = await setup(t);
    await s.render().send("/run/start_model_download", { id: "model" });
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 1, "blocked while the first start waits for its reply");
    s.render().expireUnconfirmed();
    assert.equal(s.render().pending, null);
    assert.equal(s.render().error, "request_unconfirmed");
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 2, "the user can act again");
    s.render().acknowledge(downloadState({ observation_id: "1", jobs: {} }), "/run/start_model_download");
    await s.render().send(apply, request);
    await s.render().send(cancel, request);
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 4, "competing actions stay blocked while Apply waits for its reply");
    s.render().expireUnconfirmed();
    assert.equal(s.render().pending, null, "Apply and its Cancel are let go with the rest");
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 5, "the user can act again");
});

// #563: an Apply whose reply was lost kept every other download command blocked. The timeout
// lets it go even while the polls show its job verifying; the core refuses a start or another
// Apply that would overlap it (download_busy).
test("an unanswered Apply is released when it times out, even while its job is verifying", async t => {
    const s = await setup(t);
    s.render().updateState(downloadState({ observation_id: "1", jobs: { model: { ...request, phase: "ready" } } }));
    await s.render().send(apply, request);
    s.render().updateState(downloadState({ observation_id: "2", jobs: { model: { ...request, phase: "verifying" } } }));
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 1, "competing actions stay blocked until the timeout");
    s.render().expireUnconfirmed();
    assert.equal(s.render().pending, null);
    assert.equal(s.render().error, "request_unconfirmed", "the missing reply is reported");
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 2, "the user can act again");
});

test("a poll does not release an Apply that has not timed out", async t => {
    const s = await setup(t);
    await s.render().send(apply, request);
    s.render().updateState(downloadState({ observation_id: "1", jobs: { model: { ...request, phase: "applied" } } }));
    assert.ok(s.render().pending, "the reply may still come: only the timeout lets it go");
});

test("a failed Cancel write retains pending Apply", async t => {
    const s = await setup(t, async endpoint => endpoint !== cancel);
    await s.render().send(apply, request);
    await s.render().send(cancel, request);
    assert.ok(s.render().pending);
    s.render().acknowledge(downloadState({ observation_id: "1", jobs: {} }), apply);
    assert.equal(s.render().pending, null);
});

test("the receive router correlates Apply and Cancel acknowledgements", async t => {
    const s = await setup(t);
    const bridge = await loadBridgeRoutes(undefined, null, { useModelDownloads: s.render });
    t.onTestFinished(() => bridge.runtime.unmount());
    await s.render().send(apply, request);
    await s.render().send(cancel, request);
    bridge.receiveRoutes({ status: 200, endpoint: cancel, result: { observation_id: "1", jobs: {} } });
    assert.ok(s.render().pending);
    bridge.receiveRoutes({ status: 200, endpoint: apply, result: { observation_id: "2", jobs: {} } });
    assert.equal(s.render().pending, null);
});

// The catalog's headings as they are, with the hint mark as a name: the catalog draws them in place.
const loadHeading = (runtime: HookRuntime) => loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/catalogHeading.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/catalogHeading.tsx", import.meta.url), runtime,
    { "../_components/hint/Hint": { Hint: "hint" } });
// hints: whether the page has been reviewed against #614 (HintDescriptions), so its descriptions are hints.
// layout: the catalogs' layout chosen (catalogLayout.tsx). counted: words that show their values
// (a key and its options), for a test that reads them.
const counted = { "@useI18n": { useI18n: () => ({ i18n: { language: "en" },
    t: (key: string | string[], options?: object) => `${[key].flat()[0]}${options && !("defaultValue" in options) ? `:${JSON.stringify(options)}` : ""}` }) } };
const loadCatalog = async (s: { render: () => object }, ui: HookRuntime, hints = false, layout = "list", words: object = {}) => loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/ModelDownloads.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/ModelDownloads.tsx", import.meta.url), ui, {
    "@tauri-apps/api/core": { isTauri: () => false },
    "@tauri-apps/plugin-opener": {},
    "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: s.render },
    "../../../../../../logics/voice/modelHardwareAdvice": { modelAdvice: () => ({}) },
    "../../../../../../logics/voice/modelCatalog": modelCatalog,
    "../../../../../../logics/voice/modelHardwareWarning": modelHardwareWarning,
    "../../../../../../logics/voice/modelRestrictions": modelRestrictions,
    "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null } }) },
    "../../../../../../logics/common/languageNames": languageNames,
    "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
    "./EngineCatalog": { EngineCatalog: "engines" },
    "./UserModels": { UserModelCards: "user-model-cards", UserModelRegistration: "user-model-registration" },
    "./VoiceAudition": { AuditionButton: "audition-button", AuditionNote: "audition-note" },
    "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
    "../_components/fold/Fold": { Fold: "fold" },
    "./catalogHeading": await loadHeading(ui),
    "./catalogLayout": { useCatalogLayout: () => layout, CatalogList: "ul", CatalogFacts: "catalog-facts", CatalogLayoutSwitch: "catalog-layout-switch",
        CatalogSection: "catalog-section" },
    ...words,
});

test("the cards take the layout chosen on the heading's line, and one model asked about stays a list", async t => {
    const s = await setup(t), ui = hooks();
    t.onTestFinished(() => ui.unmount());
    const { ModelDownloads } = await loadCatalog(s, ui, false, "grid");
    s.render().updateCatalog(catalog({ models: [
        { id: "model-q8", target: "asr", name: "Model · Q8_0", total_bytes: 2 * 1073741824, profile: { recommended_for: ["ja", "en", "ko"], summary: "model" },
            speech: { name: "model", label: "Model", type: "q8_0", default: true, languages: ["ja"], start: [] } },
        { id: "model-q4", target: "asr", name: "Model · Q4_K", total_bytes: 1073741824,
            speech: { name: "model", label: "Model", type: "q4_k", default: false, languages: ["ja"], start: [] } },
        { id: "other", target: "asr", name: "Other", total_bytes: 10, profile: { recommended_for: ["ja"] } },
    ] }));
    const draw = (only?: string[]) => ui.render(ModelDownloads, { targets: ["asr"], expected: { asr: {} }, only });
    const cards = (tree: object) => nodesIn(tree).filter(node => node.props?.["data-model-download"] !== undefined);
    const parts = (card: TreeNode) => [card.props.children].flat(2).filter(Boolean).map(part => String(part.type === "catalog-facts" ? "catalog-facts" : part.props.className));
    let tree = draw();
    assert.ok(find(tree, node => node.type === "catalog-layout-switch"), "the layout buttons on the heading's line");
    assert.equal(findIn(tree, node => node.type === "ul").props.layout, "grid");
    // A grid card is four parts: what the model is, its size and hardware, its details folded,
    // and its actions.
    const [model, other] = cards(tree);
    assert.deepEqual(parts(model), ["card_intro", "card_key", "catalog-facts", "card_foot"]);
    assert.equal(findIn(model, node => node.props?.className === "card_key").props.part, "key", "the size and the hardware on the card");
    const details = findIn(model, node => node.type === "catalog-facts");
    assert.equal(details.props.summary, "model_catalog.layout.facts_of", "the fold names the file type");
    assert.equal(findIn(other, node => node.type === "catalog-facts").props.summary, undefined, "one file of the model's name: Details");
    assert.ok(find(details, node => node.type === "select"), "the choice of the file is in the fold");
    assert.equal(findIn(details, node => componentName(node) === "ModelFacts").props.part, "rest", "the languages and the terms in the fold");
    assert.equal(find(findIn(model, node => node.props?.className === "card_intro"), node => node.type === "select"), null);
    assert.ok(find(findIn(model, node => node.props?.className === "card_foot"), node => node.type === "button"), "the actions stay on the card");
    // Whom it is suggested for is one short word: how many languages, or the one.
    const badge = (card: TreeNode) => findIn(card, node => node.props?.["data-tone"] === "recommended").props.children;
    assert.equal(badge(model), "model_catalog.recommended_for_count");
    assert.equal(badge(other), "model_catalog.recommended_for");
    assert.equal(findIn(tree, node => node.type === "user-model-cards").props.layout, "grid");
    // The translation review asks about one model: no choice, and its card is a list's.
    tree = draw(["model-q8", "model-q4"]);
    assert.equal(find(tree, node => node.type === "catalog-layout-switch"), null);
    assert.equal(findIn(tree, node => node.type === "ul").props.layout, "list");
    assert.deepEqual(parts(cards(tree)[0]), ["card_intro", "card_spec", "card_foot"]);
    assert.equal(find(tree, node => node.type === "catalog-facts"), null);
    assert.equal(badge(cards(tree)[0]), "model_catalog.recommended_for");
});

test("the production model card enables matching Cancel during Apply verification", async t => {
    const s = await setup(t), ui = hooks();
    t.onTestFinished(() => ui.unmount());
    const { ModelDownloads } = await loadCatalog(s, ui);
    s.render().updateCatalog(catalog({ models: [{ id: "model", target: "rvc", name: "Model", total_bytes: 10 }] }));
    s.render().updateState(downloadState({ observation_id: "1", jobs: { model: { job_id: "job", phase: "ready" } } }));
    const render = () => ui.render(ModelDownloads, { targets: ["rvc"], expected: { rvc: {} } });
    const button = (name: string) => findIn(render(), node => node.type === "button" && node.props.children === `model_downloads.${name}`);
    button("apply").props.onClick();
    s.render().updateState(downloadState({ observation_id: "2", jobs: { model: { job_id: "job", phase: "verifying" } } }));
    assert.equal(button("cancel").props.disabled, false);
    assert.equal(button("review").props.disabled, true);
    button("cancel").props.onClick();
    assert.equal(button("cancel").props.disabled, true);
    // The page's own GPU probe (for the per-model warnings) is not a model action.
    assert.deepEqual(s.calls.filter(([endpoint]) => endpoint.startsWith("/run/") && !endpoint.includes("hardware")), [
        [apply, { ...request, expected: {} }], [cancel, request],
    ]);
});

test("the catalog groups models by use, one card per recognizer with its file types", async t => {
    const s = await setup(t), ui = hooks();
    t.onTestFinished(() => ui.unmount());
    const { ModelDownloads } = await loadCatalog(s, ui);
    const row = (id: string, name: string, type: string, isDefault: boolean, languages: string[]) => ({ id, target: "asr", name: `${name} · ${type}`, total_bytes: 1,
        speech: { name, label: name, type: type.toLowerCase(), default: isDefault, languages, start: [] } });
    s.render().updateCatalog(catalog({ models: [
        row("qwen-q8", "qwen", "Q8_0", true, ["en", "ja"]), row("qwen-q4", "qwen", "Q4_K", false, ["en", "ja"]),
        row("v3-f16", "v3", "F16", true, ["de"]), row("v3-q8", "v3", "Q8_0", false, ["de"]),
        { id: "vad", target: "vad", name: "VAD", total_bytes: 1 },
    ] }));
    const render = () => ui.render(ModelDownloads, { targets: ["asr", "vad"], expected: {} });
    // Each use is a part of the catalog of its own (catalogLayout.tsx's CatalogSection), named by it.
    const groups = () => nodesIn(render()).filter(node => node.type === "catalog-section").map(node => node.props.title);
    const cards = () => nodesIn(render()).filter(node => node.props?.["data-model-download"] !== undefined);
    const select = (card: TreeNode) => find(card, node => node.type === "select");
    const choice = (card: TreeNode) => findIn(card, node => node.type === "select");
    const values = (node: TreeNode) => [node.props.children].flat(2).filter(Boolean).map(option => option.props.value);
    assert.deepEqual(groups(), ["model_catalog.group.asr", "model_catalog.group.vad"]);
    assert.deepEqual(cards().map(card => card.props["aria-label"]), ["qwen", "v3", "VAD"]);
    const [qwen, v3, vad] = cards();
    assert.deepEqual(values(choice(qwen)), ["qwen-q8", "qwen-q4"]);
    assert.equal(choice(qwen).props.value, "qwen-q8", "a recognizer starts at the file speech.cpp fetches");
    assert.equal(choice(v3).props.value, "v3-f16");
    assert.equal(select(vad), null, "a model with one file has no choice");
    choice(v3).props.onChange({ target: { value: "v3-q8" } });
    assert.equal(choice(cards()[1]).props.value, "v3-q8");
    assert.equal(choice(cards()[0]).props.value, "qwen-q8", "each card keeps its own choice");
    // The facts come from speech.cpp's catalog when a row has no profile.
    const facts = findIn(cards()[1], node => componentName(node) === "ModelFacts");
    assert.equal(facts.props.entry.id, "v3-q8");
    assert.equal(s.calls.filter(([endpoint]) => endpoint.startsWith("/run/") && !endpoint.includes("hardware")).length, 0, "choosing starts nothing");
});

test("a model downloaded before a restart says so, and in use only when its file is the saved path", async t => {
    const s = await setup(t), ui = hooks();
    t.onTestFinished(() => ui.unmount());
    const { ModelDownloads } = await loadCatalog(s, ui);
    const model = (id: string) => ({ id, target: "rvc", name: `${id} · RVC v2`, total_bytes: 1, licenses: [], artifacts: [] });
    s.render().updateCatalog(catalog({ catalog_version: "v", models: [model("a"), model("b"), model("c")] }));
    s.render().updateState(downloadState({ observation_id: "1", jobs: {}, downloaded: { a: { model: "/m/a.pth" }, b: { model: "/m/b.pth" } } }));
    const render = () => ui.render(ModelDownloads, { targets: ["rvc"], expected: { rvc: { model: "/m/a.pth" } } });
    const status = (card: TreeNode) => findIn(card, node => componentName(node) === "StatusBadge").props.status;
    const cards = nodesIn(render()).filter(node => node.props?.["data-model-download"] !== undefined);
    assert.deepEqual(cards.map(status), ["in_use", "downloaded", "not_downloaded"]);
    const action = (card: TreeNode) => findIn(card, node => node.type === "button" && node.props.children?.startsWith?.("model_"));
    const actionOf = (card: TreeNode) => nodesIn(card).find(node => node.type === "button" && node.props.children?.startsWith?.("model_"))?.props.children ?? null;
    // In use, it is ready: nothing to check or prepare, so no button offers it (#947). On the PC but
    // not set, it still needs its check and its path; not on the PC, its review.
    assert.deepEqual(cards.map(actionOf), [null, "model_catalog.prepare", "model_downloads.review"]);
    assert.ok(!nodesIn(cards[0]).some(node => node.props?.children === "model_catalog.prepare_hint"));
    assert.ok(nodesIn(cards[1]).some(node => node.props?.children === "model_catalog.prepare_hint"));
    // Getting a downloaded file ready still goes through the review and consent.
    action(cards[1]).props.onClick();
    assert.equal(s.calls.filter(([endpoint]) => endpoint.startsWith("/run/") && !endpoint.includes("hardware")).length, 0);
    const dialog = find(render(), node => node.type === "dialog");
    assert.ok(find(dialog, node => node.props?.children === "model_catalog.prepare_notice"));
    // The audition (#415) follows the card's own action in its row, with the card's status and
    // model id; the RVC form's values and the chosen input reach it when the page has them.
    const row = findIn(cards[1], node => node.props?.className === "actions");
    assert.deepEqual(row.props.children.map((child: TreeNode | null) => child?.type), ["button", "audition-button"]);
    // In use, the audition is the row's only control.
    const used = findIn(cards[0], node => node.props?.className === "actions");
    assert.deepEqual(used.props.children.filter(Boolean).map((child: TreeNode) => child.type), ["audition-button"]);
    const none = { values: undefined, input: undefined };
    assert.deepEqual(cards.map(card => findIn(card, node => node.type === "audition-note").props), [
        { target: "rvc", status: "in_use", entry: "a", ...none }, { target: "rvc", status: "downloaded", entry: "b", ...none },
        { target: "rvc", status: "not_downloaded", entry: "c", ...none }]);
    const audition = { values: { pitch: 2, index_rate: 0.5 }, input: { cookie: "1", serial: "42", name: "Mic (Realtek)", media_class: "Audio/Source" } };
    const withValues = nodesIn(ui.render(ModelDownloads, { targets: ["rvc"], expected: { rvc: { model: "/m/a.pth" } }, audition }))
        .filter(node => node.props?.["data-model-download"] !== undefined);
    assert.deepEqual(findIn(withValues[1], node => node.type === "audition-button").props, { target: "rvc", status: "downloaded", entry: "b", ...audition });
});

test("the time of a GPU reading is written in the display language", async t => {
    const ui = hooks();
    t.onTestFinished(() => ui.unmount());
    const { measuredTime } = await loadCatalog({ render: () => ({}) }, ui);
    const at = Date.UTC(2026, 0, 10, 16, 5, 9);
    assert.equal(measuredTime(at, "ja"), new Date(at).toLocaleTimeString("ja"));
    assert.equal(measuredTime(at, "en"), new Date(at).toLocaleTimeString("en"));
    assert.doesNotMatch(measuredTime(at, "ja"), /AM|PM/);
});

test("each use is a part of the catalog with what it is for and its readout, folded but in the translation review", async t => {
    const s = await setup(t);
    const row = (id: string, target: string) => ({ id, target, name: `${id} · Q8_0`, total_bytes: 1 });
    s.render().updateCatalog(catalog({ models: [row("asr-model", "asr"), row("asr-other", "asr"), row("vad-model", "vad")] }));
    s.render().updateState(downloadState({ observation_id: "1", jobs: {}, downloaded: { "vad-model": { model: "/vad" } } }));
    for (const hints of [true, false]) {
        const ui = hooks();
        t.onTestFinished(() => ui.unmount());
        const { ModelDownloads } = await loadCatalog(s, ui, hints, "list", counted);
        const parts = (only?: string[]) => nodesIn(ui.render(ModelDownloads, { targets: ["asr", "vad"], expected: {}, only }))
            .filter(node => node.type === "catalog-section").map(node => node.props);
        const [asr, vad] = parts();
        // What the use is for and how to choose in it; the part shows them as its name's hint or as
        // lines (catalogLayout.test.ts).
        assert.deepEqual([asr.title, asr.level, asr.id, asr.fold], ["model_catalog.group.asr", 4, "model-catalog-asr", true]);
        assert.deepEqual(asr.help, ["model_catalog.group_help.asr", "model_downloads.asr_choice", "model_downloads.asr_requirements"]);
        assert.deepEqual(vad.help, ["model_catalog.group_help.vad", "model_downloads.vad_requirements"]);
        // Its bar reads out how many models it has and how many are on the PC.
        assert.equal(asr.readout, 'model_catalog.group_readout:{"count":2,"obtained":0}');
        assert.equal(vad.readout, 'model_catalog.group_readout:{"count":1,"obtained":1}');
        // The translation review asks about one model: no part of it is folded.
        assert.ok(parts(["asr-model"]).every(part => part.fold === false));
    }
});

test("a card says its state at the end of its name's line, and what speaks for it under the name", async t => {
    const s = await setup(t), ui = hooks();
    t.onTestFinished(() => ui.unmount());
    const { ModelDownloads } = await loadCatalog(s, ui);
    const model = (id: string, suggested: string[]) => ({ id, target: "asr", name: `${id} · Q8_0`, total_bytes: 1,
        profile: { recommended_for: suggested, languages: ["ja"] } });
    s.render().updateCatalog(catalog({ models: [model("a", ["ja"]), model("b", [])] }));
    s.render().updateState(downloadState({ observation_id: "1", jobs: {}, downloaded: { a: { model: "/m/a.gguf" } } }));
    const cards = nodesIn(ui.render(ModelDownloads, { targets: ["asr"], expected: { asr: { model: "/m/a.gguf" } } }))
        .filter(node => node.props?.["data-model-download"] !== undefined);
    // The card in use is told by its frame, as well as by its badge.
    assert.deepEqual(cards.map(card => card.props["data-status"]), ["in_use", "not_downloaded"]);
    for (const card of cards) {
        const head = findIn(card, node => node.props?.className === "card_head");
        assert.deepEqual(head.props.children.map((child: TreeNode) => child.type === "strong" ? "name" : componentName(child)), ["name", "StatusBadge"]);
    }
    const badges = findIn(cards[0], node => node.props?.className === "card_badges");
    assert.ok(find(badges, node => node.props?.children === "model_catalog.recommended_for"));
    assert.equal(find(cards[1], node => node.props?.className === "card_badges"), null, "no empty line of badges");
});

// #566: the manual lists every speech model with its check, and the voice changer's model was
// checked; their cards say so even without a measured memory.
test("a model checked, or a speech model not checked yet, says so without a figure; other models say nothing", async t => {
    const s = await setup(t);
    const row = (id: string, target: string, state: string, scope: string | null) => ({ id, target, name: `${id} · Q8_0`, total_bytes: 1,
        guidance: { tier: id === "rvc" ? "voice" : "unknown", reference_memory_bytes: null, validation: { state, scope, device: null } } });
    s.render().updateCatalog(catalog({ models: [row("rvc", "rvc", "passed", "rvc_runtime"), row("tts", "multilingual", "pending", null),
        row("asr", "asr", "pending", null)] }));
    const ui = hooks();
    t.onTestFinished(() => ui.unmount());
    // The words a key falls back to (the last of a list), as the locales have them.
    const { ModelDownloads } = await loadCatalog(s, ui, false, "list", { "@useI18n": { useI18n: () => ({ i18n: { language: "en" },
        t: (key: string | string[]) => [key].flat().at(-1) }) } });
    const cards = nodesIn(ui.render(ModelDownloads, { targets: ["rvc", "multilingual", "asr"], expected: {} }))
        .filter(node => node.props?.["data-model-download"] !== undefined);
    const record = (card: TreeNode) => {
        const fold = find(card, node => node.type === "fold");
        return fold && [fold.props.summary, nodesIn(fold).filter(node => node.type === "p").map(node => node.props.children)];
    };
    assert.deepEqual(Object.fromEntries(cards.map(card => [card.props["aria-label"] ?? card.key, record(card)])), {
        // Checked with no device: what the check covered, under "Testing", with no GPU line.
        "rvc": ["model_downloads.validation_summary", ["model_downloads.scope_rvc_runtime"]],
        "tts": ["model_downloads.validation_summary", ["model_downloads.validation_pending"]],
        "asr": null,
    });
});

test("a model's measured memory is the hardware term's hint on a reviewed page, a fold elsewhere", async t => {
    const s = await setup(t);
    s.render().updateCatalog(catalog({ models: [{ id: "tts", target: "rvc", name: "TTS · F16", total_bytes: 1,
        profile: { tier: "medium", cpu: "impractical", gpu: "recommended", languages: ["ja"] },
        guidance: { tier: "medium", reference_memory_bytes: 1024 ** 3, validation: { state: "passed", device: "GPU" } } }] }));
    for (const hints of [true, false]) {
        const ui = hooks();
        t.onTestFinished(() => ui.unmount());
        const { ModelDownloads } = await loadCatalog(s, ui, hints);
        const card = findIn(ui.render(ModelDownloads, { targets: ["rvc"], expected: {} }), node => node.props?.["data-model-download"] !== undefined);
        const facts = findIn(card, node => componentName(node) === "ModelFacts");
        // A link of the app's one fold.
        const fold = find(card, node => node.type === "fold");
        if (hints) {
            assert.equal(facts.props.guidance.length, 2, "the memory and where it was checked");
            assert.equal(fold, null);
        } else {
            assert.equal(facts.props.guidance, undefined);
            assert.ok(fold);
            assert.deepEqual([fold.props.size, fold.props.summary], ["link", "model_downloads.guidance_summary"]);
        }
    }
});
