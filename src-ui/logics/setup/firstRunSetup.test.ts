import assert from "node:assert/strict";
import { test } from "vitest";
import { recognitionState, recommendedAsr, vadEntry, setupPlan, planModels, planBytes, nextAction, stepState,
    setupSuggested, setupWork, hasSetupWork } from "./firstRunSetup.ts";
import type { RunView, SetupCatalog } from "./firstRunSetup.ts";
import { unchecked } from "../test/hookHarness.ts";

const asr = (id: string, recommended: string[], size = 600, isDefault = true) => ({ id, target: "asr", name: id, total_bytes: size,
    speech: { name: id.split("-q")[0], label: id, type: "q8_0", default: isDefault }, profile: { recommended_for: recommended } });
// Test data: the entries carry only the fields of the catalog the setup reads.
const catalog = unchecked<NonNullable<SetupCatalog>>({
    catalog_version: "v1",
    models: [
        asr("qwen-q8", ["en", "zh"], 800),
        asr("qwen-q4", [], 500, false),
        asr("reazon-q8", ["ja"], 660),
        asr("parakeet-f16", ["uk"], 1200),
        { id: "silero", target: "vad", name: "Silero", total_bytes: 1, profile: { recommended_for: [] } },
        { id: "irodori", target: "japanese", name: "Irodori", total_bytes: 9, profile: { recommended_for: ["ja"] } },
    ],
});
const empty = { model: "", vad_model: "" };

test("the recognition is ready only with the bundled server and both models; another engine is left alone", () => {
    assert.equal(recognitionState({ engine: null, server: "external", paths: empty }), "needs_setup");
    assert.equal(recognitionState({ engine: "SpeechCpp", server: "bundled", paths: { model: "/m/a.gguf", vad_model: "" } }), "needs_setup");
    assert.equal(recognitionState({ engine: "SpeechCpp", server: "bundled", paths: { model: "/m/a.gguf", vad_model: "/m/v.gguf" } }), "ready");
    assert.equal(recognitionState({ engine: "SpeechCpp", server: "external", paths: empty }), "own_server");
    assert.equal(recognitionState({ engine: "Deepgram", server: "external", paths: empty }), "cloud");
    // Settings not arrived yet: it says nothing, so the setup does not open on a guess.
    assert.equal(recognitionState({ engine: undefined, server: "bundled", paths: empty }), "unknown");
    assert.equal(recognitionState({ engine: "SpeechCpp", server: undefined, paths: empty }), "unknown");
});

test("the recommended model follows the UI language, with English's as the fallback", () => {
    assert.equal(recommendedAsr(catalog, "ja")?.id, "reazon-q8");
    assert.equal(recommendedAsr(catalog, "ja-JP")?.id, "reazon-q8");
    assert.equal(recommendedAsr(catalog, "en")?.id, "qwen-q8");
    assert.equal(recommendedAsr(catalog, "tlh")?.id, "qwen-q8");
    assert.equal(recommendedAsr(null, "ja"), null);
    assert.equal(vadEntry(catalog)?.id, "silero");
});

test("the plan keeps paths the user set and lists what it downloads", () => {
    const plan = setupPlan({ catalog, language: "ja", engine: null, server: "external", paths: empty });
    assert.ok(plan);
    assert.deepEqual(plan.map(step => step.kind === "model" ? step.entry.id : step.kind), ["reazon-q8", "silero", "server", "engine"]);
    assert.deepEqual(planModels(plan).map(entry => entry.id), ["reazon-q8", "silero"]);
    assert.equal(planBytes(plan), 661);
    const kept = setupPlan({ catalog, language: "ja", engine: "SpeechCpp", server: "bundled", paths: { model: "/mine.gguf", vad_model: "" } });
    assert.ok(kept);
    assert.deepEqual(kept.map(step => step.kind === "model" ? step.entry.id : step.kind), ["silero"]);
    // Without the catalog or the saved paths there is no plan to consent to.
    assert.equal(setupPlan({ catalog: null, language: "ja", engine: null, server: "external", paths: empty }), null);
    assert.equal(setupPlan({ catalog, language: "ja", engine: null, server: "external", paths: null }), null);
});

const plan = setupPlan({ catalog, language: "ja", engine: null, server: "external", paths: empty });
// The plan the tests below run, there for each of them; and the model of one of its steps.
const steps = () => {
    assert.ok(plan);
    return plan;
};
const entryAt = (index: number) => {
    const step = steps()[index];
    assert.ok(step?.kind === "model");
    return step.entry;
};
const view = (values?: Partial<RunView>): RunView => ({ engine: null, server: "external", paths: empty, jobs: {}, started: {}, applied: [], ...values });

test("the run downloads, applies, then switches the server and the engine, in that order", () => {
    assert.deepEqual(nextAction(steps(), view()), { kind: "start", entry: entryAt(0) });
    // Asked: wait for the job, whatever an older job of the same model said.
    assert.equal(nextAction(steps(), view({ started: { "reazon-q8": null } })).kind, "wait");
    assert.equal(nextAction(steps(), view({ started: { "reazon-q8": "old" }, jobs: { "reazon-q8": { job_id: "old", phase: "failed" } } })).kind, "wait");
    assert.equal(nextAction(steps(), view({ started: { "reazon-q8": null }, jobs: { "reazon-q8": { job_id: "j1", phase: "downloading" } } })).kind, "wait");
    // Verified: applied once, against the path saved now.
    assert.deepEqual(nextAction(steps(), view({ started: { "reazon-q8": null }, jobs: { "reazon-q8": { job_id: "j1", phase: "ready" } } })),
        { kind: "apply", entry: entryAt(0), jobId: "j1", expected: { model: "" } });
    assert.equal(nextAction(steps(), view({ started: { "reazon-q8": null }, applied: ["j1"], jobs: { "reazon-q8": { job_id: "j1", phase: "applied" } } })).kind, "wait");
    // The saved path ends the step; the next model follows.
    const asrSet = { model: "/m/reazon.gguf", vad_model: "" };
    assert.deepEqual(nextAction(steps(), view({ paths: asrSet })), { kind: "start", entry: entryAt(1) });
    const both = { model: "/m/reazon.gguf", vad_model: "/m/vad.gguf" };
    assert.deepEqual(nextAction(steps(), view({ paths: both })), { kind: "server" });
    assert.deepEqual(nextAction(steps(), view({ paths: both, server: "bundled" })), { kind: "engine" });
    assert.deepEqual(nextAction(steps(), view({ paths: both, server: "bundled", engine: "SpeechCpp" })), { kind: "done" });
});

test("a download that fails or is cancelled stops the run at its step, and a new run asks again", () => {
    const failed = view({ started: { "reazon-q8": null }, jobs: { "reazon-q8": { job_id: "j1", phase: "failed", error_code: "disk_full" } } });
    assert.deepEqual(nextAction(steps(), failed), { kind: "failed", step: 0, code: "disk_full" });
    assert.equal(stepState(steps(), 0, failed, 0), "failed");
    const cancelled = view({ started: { "reazon-q8": null }, jobs: { "reazon-q8": { job_id: "j1", phase: "cancelled" } } });
    assert.deepEqual(nextAction(steps(), cancelled), { kind: "failed", step: 0, code: "cancelled" });
    // "やり直す": a new run with nothing asked yet starts the same model again.
    assert.deepEqual(nextAction(steps(), view({ jobs: failed.jobs })), { kind: "start", entry: entryAt(0) });
    // A model already verified by an earlier run is applied without downloading again.
    assert.equal(nextAction(steps(), view({ jobs: { "reazon-q8": { job_id: "j0", phase: "ready" } } })).kind, "apply");
});

test("each step shows whether it is done, under way, waiting or failed", () => {
    const running = view({ started: { "reazon-q8": null }, paths: empty });
    assert.deepEqual(steps().map((_, i) => stepState(steps(), i, running, null)), ["working", "waiting", "waiting", "waiting"]);
    assert.deepEqual(steps().map((_, i) => stepState(steps(), i, view(), null)), ["waiting", "waiting", "waiting", "waiting"]);
    const half = view({ paths: { model: "/m/a.gguf", vad_model: "" }, applied: ["j1"] });
    assert.deepEqual(steps().map((_, i) => stepState(steps(), i, half, null)), ["done", "working", "waiting", "waiting"]);
});

test("the first screen's line stands out only while pending and something the setup prepares is left", () => {
    assert.equal(setupSuggested(true, setupWork("needs_setup", undefined)), true);
    for (const state of ["ready", "cloud", "own_server", "unknown"] as const) assert.equal(setupSuggested(true, setupWork(state, undefined)), false);
    assert.equal(setupSuggested(false, setupWork("needs_setup", undefined)), false);
    assert.equal(setupSuggested(null, setupWork("needs_setup", undefined)), false);
    // #936: the recognition ready and the translation's model missing (and fetchable): the setup prepares it.
    assert.equal(setupSuggested(true, setupWork("ready", "review")), true);
    assert.equal(setupSuggested(true, setupWork("ready", "choose")), false, "a model it cannot fetch is not its work");
});

test("what the setup has left: the recognition, the translation's model, or both", () => {
    assert.deepEqual(setupWork("needs_setup", "review"), { recognition: true, translation: true });
    assert.deepEqual(setupWork("cloud", "review"), { recognition: false, translation: true });
    assert.deepEqual(setupWork("ready", undefined), { recognition: false, translation: false });
    assert.equal(hasSetupWork(setupWork("ready", undefined)), false);
    assert.equal(hasSetupWork(setupWork("own_server", "review")), true);
});
