import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, componentName } from "../../../logics/test/hookHarness.ts";
import { branchAt, localeAt, readLocale } from "../../../logics/test/locales.ts";
import * as logic from "../../../logics/setup/firstRunSetup.ts";

const CATALOG = {
    catalog_version: "2026-11-16.3",
    models: [
        { id: "reazonspeech-v2-q8", target: "asr", name: "ReazonSpeech v2 · Q8_0", provider: "Reazon Research / sakasegawa",
            license: "Apache-2.0", licenses: ["https://example.invalid/card"], total_bytes: 660910656,
            speech: { name: "reazonspeech-v2", default: true }, profile: { recommended_for: ["ja"] } },
        { id: "silero-vad-v62", target: "vad", name: "Silero VAD v6.2 · F32", provider: "Silero Team / sakasegawa",
            license: "MIT", licenses: ["https://example.invalid/vad"], total_bytes: 1238624, profile: { recommended_for: [] } },
    ],
};

// A world the dialog reads: the saved settings, the download state and what it sent.
interface World {
    notice: boolean;
    settled: boolean;
    opened: boolean;
    telemetryPending: boolean;
    engine: string | null;
    server: string;
    paths: { model: string; vad_model: string };
    catalog: object;
    jobs: Record<string, object>;
    downloadError: string | null;
    realtimeError: string | null;
    sent: [string, unknown][];
    calls: unknown[];
}

function world(values: Partial<World> = {}): World {
    return { notice: true, settled: false, opened: false, telemetryPending: false,
        engine: null, server: "external", paths: { model: "", vad_model: "" }, catalog: CATALOG, jobs: {},
        downloadError: null, realtimeError: null, sent: [], calls: [], ...values };
}

async function setup(context: TestContext, w = world()) {
    const runtime = hooks();
    const record = (endpoint: string, data: unknown) => { w.sent.push([endpoint, data]); };
    const { FirstRunSetupController } = await loadModule<typeof import("./FirstRunSetupController.tsx")>(new URL("./FirstRunSetupController.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string | string[]) => Array.isArray(key) ? key[0] : key, i18n: { language: "ja" } }) },
        "@tauri-apps/api/core": { isTauri: () => false },
        "@tauri-apps/plugin-opener": { openUrl: () => assert.fail("no link opens in this test") },
        "@logics_configs": {
            useOthers: () => ({ currentTelemetryNotice: { state: "ok", data: { pending: w.telemetryPending } } }),
            useTranscription: () => ({ setSelectedTranscriptionEngine: async (engine: unknown) => { record("/set/data/selected_transcription_engine", engine); return true; } }),
            useSettingValue: () => ({ state: "ok", data: "Microphone (USB)" }),
        },
        "@store": {
            useStore_IsBackendReady: () => ({ currentIsBackendReady: { data: true } }),
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => w.calls.push(["opened", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => w.calls.push(["tab", value]) }),
        },
        "../../../logics/common/useConsentDialog": { useConsentDialog: (open: unknown) => ({ dialog: { current: null, open }, close: () => w.calls.push("closed") }) },
        "../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => ({
            settings: { version: 1, server: w.server, base_url: "http://127.0.0.1:8080" }, error: w.realtimeError,
            send: async (endpoint: string, data: unknown) => { record(endpoint, data); w.realtimeError = null; return true; } }) },
        "../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({
            catalog: w.catalog, state: { jobs: w.jobs }, error: w.downloadError,
            send: async (endpoint: string, data: unknown) => { record(endpoint, data); if (endpoint.startsWith("/run/")) w.downloadError = null; } }) },
        "../../../logics/voice/useVirtualMic": { useVirtualMic: () => ({ status: { supported: true, cables: [], error: null }, openGuide: () => w.calls.push("guide") }) },
        "../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs: [] }) },
        "../../../logics/translation/useOpenTranslatorList": { useOpenTranslatorList: () => () => w.calls.push("translators") },
        "../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({
            notice: w.notice, opened: w.opened, settled: w.settled,
            dismissNotice: () => { w.calls.push("dismiss"); w.notice = false; },
            closeSetup: () => { w.calls.push("close"); w.opened = false; w.settled = true; },
            markSettled: () => { w.settled = true; } }) },
        "../../../logics/setup/useRecognitionState": { useRecognitionState: () => {
            const state = logic.recognitionState({ engine: w.engine, server: w.server, paths: w.paths });
            return { state, engine: w.engine, server: w.server, paths: w.paths };
        } },
        "../../../logics/setup/firstRunSetup.ts": logic,
        "../others/vrchat_presence/VrchatPresence": { VrchatPresence: () => null },
    });
    context.onTestFinished(() => runtime.unmount());
    // Renders until the effects stop changing what is drawn (each effect may set state).
    const render = () => { let tree: unknown; for (let i = 0; i < 4; i += 1) tree = runtime.render(FirstRunSetupController); return tree; };
    const buttons = (tree: unknown) => nodesIn(tree).filter(node => node.type === "button");
    const button = (tree: unknown, label: string) => {
        const found = buttons(tree).find(node => [node.props.children].flat().includes(label));
        assert.ok(found, label);
        return found;
    };
    // A part the dialog draws from a function of its own, found by that function's name.
    const part = (tree: unknown, name: string) => findIn(tree, node => componentName(node) === name, name);
    return { render, button, buttons, part };
}

test("it opens by itself only while pending, after the other notices, and when the recognition needs it", async context => {
    assert.notEqual((await setup(context)).render(), null);
    assert.equal((await setup(context, world({ notice: false }))).render(), null);
    assert.equal((await setup(context, world({ telemetryPending: true }))).render(), null);
    assert.equal((await setup(context, world({ engine: "Deepgram" }))).render(), null);
    assert.equal((await setup(context, world({ engine: "SpeechCpp", server: "external" }))).render(), null);
    // Opened from the first screen it shows whatever the notice says.
    assert.notEqual((await setup(context, world({ notice: false, opened: true }))).render(), null);
});

test("not needed this run: it settles at once, so the virtual microphone guide may open", async context => {
    const w = world({ engine: "Deepgram" });
    (await setup(context, w)).render();
    assert.equal(w.settled, true);
});

test("nothing downloads before the consent; the run downloads, applies and switches in order", async context => {
    const w = world();
    const s = await setup(context, w);
    let tree = s.render();
    const recognition = s.part(tree, "RecognitionSetup");
    assert.deepEqual(logic.planModels(recognition.props.plan).map(entry => entry.id), ["reazonspeech-v2-q8", "silero-vad-v62"]);
    const start = s.button(tree, "first_run_setup.recognition.start");
    assert.equal(start.props.disabled, true, "the start waits for the consent");
    start.props.onClick();
    s.render();
    // <unknown> keeps the assertion from narrowing w.sent, which the run goes on adding to.
    assert.deepEqual<unknown>(w.sent, []);

    recognition.props.setConsent(true);
    tree = s.render();
    s.button(tree, "first_run_setup.recognition.start").props.onClick();
    s.render();
    assert.deepEqual<unknown>(w.sent, [["/run/start_model_download", { id: "reazonspeech-v2-q8", consent: true, catalog_version: "2026-11-16.3" }]]);

    // Downloading, then verified: applied once against the saved (empty) path.
    w.jobs = { "reazonspeech-v2-q8": { job_id: "j1", phase: "downloading", received_bytes: 1, total_bytes: 2 } };
    s.render();
    assert.equal(w.sent.length, 1);
    w.jobs = { "reazonspeech-v2-q8": { job_id: "j1", phase: "ready" } };
    s.render();
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/run/apply_model_download", { id: "reazonspeech-v2-q8", job_id: "j1", expected: { model: "" } }]);
    assert.equal(w.sent.filter(([endpoint]) => endpoint === "/run/apply_model_download").length, 1);

    // The saved path comes back; the VAD model follows, then the server and the engine.
    w.paths = { model: "/m/reazon.gguf", vad_model: "" };
    w.jobs = { ...w.jobs, "reazonspeech-v2-q8": { job_id: "j1", phase: "applied" } };
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/run/start_model_download", { id: "silero-vad-v62", consent: true, catalog_version: "2026-11-16.3" }]);
    w.jobs = { ...w.jobs, "silero-vad-v62": { job_id: "v1", phase: "ready" } };
    s.render();
    const last = w.sent.at(-1);
    assert.ok(last);
    assert.deepEqual(last[0], "/run/apply_model_download");
    w.paths = { model: "/m/reazon.gguf", vad_model: "/m/vad.gguf" };
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/set/data/realtime_asr_settings", { version: 1, server: "bundled", base_url: "http://127.0.0.1:8080" }]);
    w.server = "bundled";
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/set/data/selected_transcription_engine", "SpeechCpp"]);
    w.engine = "SpeechCpp";
    tree = s.render();
    // No microphone, no recognition turned on: only these requests were sent.
    assert.deepEqual(w.sent.map(([endpoint]) => endpoint), ["/run/start_model_download", "/run/apply_model_download",
        "/run/start_model_download", "/run/apply_model_download", "/set/data/realtime_asr_settings", "/set/data/selected_transcription_engine"]);
    s.button(tree, "first_run_setup.done").props.onClick();
    assert.ok(w.calls.includes("dismiss"));
});

test("a failed download stops the run at its step; Try again continues from there", async context => {
    const w = world();
    const s = await setup(context, w);
    let tree = s.render();
    s.part(tree, "RecognitionSetup").props.setConsent(true);
    tree = s.render();
    s.button(tree, "first_run_setup.recognition.start").props.onClick();
    s.render();
    w.jobs = { "reazonspeech-v2-q8": { job_id: "j1", phase: "failed", error_code: "insufficient_space" } };
    tree = s.render();
    const recognition = s.part(tree, "RecognitionSetup");
    assert.deepEqual(recognition.props.run.failure, { step: 0, code: "insufficient_space" });
    assert.equal(w.sent.filter(([endpoint]) => endpoint === "/run/start_model_download").length, 1, "it does not retry by itself");
    // Nothing was applied: the settings stay as they were.
    assert.equal(w.sent.some(([endpoint]) => endpoint === "/run/apply_model_download"), false);

    s.button(tree, "first_run_setup.recognition.retry").props.onClick();
    s.render();
    assert.equal(w.sent.filter(([endpoint]) => endpoint === "/run/start_model_download").length, 2);
    // An outcome of the earlier job is not the new run's.
    assert.equal(s.part(s.render(), "RecognitionSetup").props.run.phase, "running");
});

test("a refused request stops the run with its reason, and a stale error does not", async context => {
    const stale = world({ downloadError: "download_busy" });
    const s = await setup(context, stale);
    let tree = s.render();
    s.part(tree, "RecognitionSetup").props.setConsent(true);
    tree = s.render();
    s.button(tree, "first_run_setup.recognition.start").props.onClick();
    tree = s.render();
    assert.equal(s.part(tree, "RecognitionSetup").props.run.phase, "running", "an error from before the run is not its own");
    stale.downloadError = "catalog_changed";
    tree = s.render();
    assert.deepEqual(s.part(tree, "RecognitionSetup").props.run.failure, { step: 0, code: "catalog_changed" });
});

test("Later puts it away for this run without dismissing it; Don't show again does", async context => {
    const w = world();
    let s = await setup(context, w);
    s.button(s.render(), "first_run_setup.later").props.onClick();
    assert.deepEqual(w.calls.filter(call => call === "dismiss" || call === "close"), ["close"]);
    const v = world();
    s = await setup(context, v);
    const alternative = find(s.render(), node => node.props?.className === "alternative");
    assert.ok(alternative);
    alternative.props.children.props.onClick();
    assert.ok(v.calls.includes("dismiss"));
});

test("every string it uses is in both languages", () => {
    const source = readFileSync(new URL("./FirstRunSetupController.tsx", import.meta.url), "utf8");
    const keys = new Set([...source.matchAll(/"(first_run_setup\.[a-z_.]+)"/g)].map(match => match[1]));
    for (const state of ["waiting", "working", "done", "failed"]) keys.add(`first_run_setup.recognition.state_${state}`);
    for (const state of ["ready", "cloud", "own_server", "needs_setup", "unknown"]) keys.add(`first_run_setup.found.recognition_${state}`);
    for (const step of ["server", "engine"]) keys.add(`first_run_setup.recognition.step_${step}`);
    for (const language of ["en", "ja"]) {
        const messages = readLocale(language);
        for (const key of keys) assert.equal(typeof localeAt(messages, key), "string", `${language}: ${key}`);
        // Japanese text never says "this PC" (このPC); it names the user's own computer.
        if (language === "ja") assert.ok(!JSON.stringify(branchAt(messages, "first_run_setup")).includes("このPC"));
    }
});
