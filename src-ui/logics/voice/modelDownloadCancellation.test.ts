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

test("only the matching job can cancel pending Apply; polls, errors and timeouts cannot release it", async t => {
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
test("an unanswered start is released when it times out; a pending Apply stays with its Cancel", async t => {
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
    s.render().expireUnconfirmed();
    assert.deepEqual(s.render().pending?.map(item => item.endpoint), [apply]);
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 4, "competing actions stay blocked during Apply");
    await s.render().send(cancel, request);
    assert.equal(s.calls.length, 5, "its Cancel can be sent again");
});

// #563: an Apply whose reply was lost kept every other download command blocked, even after
// the polls showed it had ended.
test("an unanswered Apply is released once a later poll shows its job no longer verifying", async t => {
    const s = await setup(t);
    s.render().updateState(downloadState({ observation_id: "1", jobs: { model: { ...request, phase: "ready" } } }));
    await s.render().send(apply, request);
    s.render().expireUnconfirmed();
    s.render().updateState(downloadState({ observation_id: "2", jobs: { model: { ...request, phase: "verifying" } } }));
    assert.deepEqual(s.render().pending?.map(item => item.endpoint), [apply], "still verifying: it stays");
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 1, "competing actions stay blocked while it verifies");
    // An older observation than the one shown says nothing about it.
    s.render().updateState(downloadState({ observation_id: "1", jobs: { model: { ...request, phase: "applied" } } }));
    assert.ok(s.render().pending);
    s.render().updateState(downloadState({ observation_id: "3", jobs: { model: { ...request, phase: "applied" } } }));
    assert.equal(s.render().pending, null);
    assert.equal(s.render().error, "request_unconfirmed", "the missing reply is still reported");
    await s.render().send("/run/start_model_download", { id: "other" });
    assert.equal(s.calls.length, 2, "the user can act again");
});

test("a poll does not release an Apply that has not timed out, nor one of another job", async t => {
    const s = await setup(t);
    await s.render().send(apply, request);
    s.render().updateState(downloadState({ observation_id: "1", jobs: { model: { ...request, phase: "applied" } } }));
    assert.ok(s.render().pending, "the reply may still come: only a timed-out Apply is let go");
    s.render().expireUnconfirmed();
    s.render().updateState(downloadState({ observation_id: "2", jobs: { model: { ...request, job_id: "new-job", phase: "verifying" } } }));
    assert.equal(s.render().pending, null, "a job that was replaced is not this Apply's");
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

const loadCatalog = (s: { render: () => object }, ui: HookRuntime) => loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/ModelDownloads.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/ModelDownloads.tsx", import.meta.url), ui, {
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
    const groups = () => nodesIn(render()).filter(node => node.type === "h4").map(node => node.props.children);
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
    assert.deepEqual(cards.map(card => action(card).props.children), ["model_catalog.prepare", "model_catalog.prepare", "model_downloads.review"]);
    // Getting a downloaded file ready still goes through the review and consent.
    action(cards[1]).props.onClick();
    assert.equal(s.calls.filter(([endpoint]) => endpoint.startsWith("/run/") && !endpoint.includes("hardware")).length, 0);
    const dialog = find(render(), node => node.type === "dialog");
    assert.ok(find(dialog, node => node.props?.children === "model_catalog.prepare_notice"));
    // The audition (#415) follows the card's own action in its row, with the card's status.
    const row = findIn(cards[0], node => node.props?.className === "actions");
    assert.deepEqual(row.props.children.map((child: TreeNode | null) => child?.type), ["button", "audition-button"]);
    assert.deepEqual(cards.map(card => findIn(card, node => node.type === "audition-note").props), [
        { target: "rvc", status: "in_use" }, { target: "rvc", status: "downloaded" }, { target: "rvc", status: "not_downloaded" }]);
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