import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, componentName, draw } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
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
    // What the findings read: the saved microphone, the VRChat presence, the virtual cables and
    // what the setup needs.
    mic: string;
    vrchat: string;
    cables: object[];
    needs: object[];
}

function world(values: Partial<World> = {}): World {
    return { notice: true, settled: false, opened: true, telemetryPending: false,
        engine: null, server: "external", paths: { model: "", vad_model: "" }, catalog: CATALOG, jobs: {},
        downloadError: null, realtimeError: null, sent: [], calls: [],
        mic: "Microphone (USB)", vrchat: "found", cables: [], needs: [], ...values };
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
            useSettingValue: () => ({ state: "ok", data: w.mic }),
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
        "../../../logics/voice/useVirtualMic": { useVirtualMic: () => ({ status: { supported: true, cables: w.cables, error: null }, openGuide: () => w.calls.push("guide") }) },
        "../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs: w.needs }) },
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
        "../others/vrchat_presence/VrchatPresence": { useVrchatPresence: () => ({ state: w.vrchat, tone: "neutral",
            lines: [`vrchat_presence.${w.vrchat}`, ...(w.vrchat === "not_found" ? ["vrchat_presence.not_found_hint"] : [])] }) },
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

// #935: it never opens by itself, not even pending with the recognition needing it, after the
// other notices; the first screen's line to it stands out instead (EmptyState).
test("it never opens by itself; it opens from the first screen whatever the notice says", async context => {
    for (const values of [{}, { telemetryPending: true }, { engine: "Deepgram" }, { notice: false }])
        assert.equal((await setup(context, world({ ...values, opened: false }))).render(), null, JSON.stringify(values));
    assert.notEqual((await setup(context, world({ opened: true }))).render(), null);
    assert.notEqual((await setup(context, world({ notice: false, opened: true }))).render(), null);
});

test("once its state is known it settles, so the virtual microphone guide may open", async context => {
    for (const engine of ["Deepgram", null]) {
        const w = world({ engine, opened: false });
        (await setup(context, w)).render();
        assert.equal(w.settled, true, String(engine));
    }
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

// What was found reads at a glance (#557): each row is marked ready, needs the user, being checked
// or neither, its words stay beside the mark, and its button sits under its words, never inside them.
// One row of what was found, as Findings hands it to Finding.
interface FindingRow {
    name: string;
    state: string;
    live?: boolean;
    action?: TreeNode | false;
    children: string | TreeNode[];
}
const isFinding = (node: TreeNode) => componentName(node) === "Finding";
const shortName = (row: FindingRow) => row.name.split(".").at(-1) ?? row.name;

test("each finding is marked by its state, with its words and its action apart", async context => {
    const rowsOf = async (values: Partial<World>) => {
        const w = world(values);
        const s = await setup(context, w);
        // The element the dialog drew for Findings, which the harness does not draw by itself (it
        // draws one level): drawn here with the props it was given, as the dialog would.
        const list = draw(s.part(s.render(), "Findings"));
        const rows: FindingRow[] = nodesIn(list).filter(isFinding).map(node => node.props);
        // Where each row is drawn: the cards of what needs the user, or the quiet list after them.
        const placed = (className: string) => {
            const group = find(list, node => node.type === "ul" && node.props.className === className);
            return nodesIn(group).filter(isFinding).map(node => shortName(node.props));
        };
        return { rows: Object.fromEntries(rows.map(row => [shortName(row), row])), urgent: placed("urgent"), settled: placed("items"), list };
    };
    const states = (rows: Record<string, FindingRow>) => Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row.state]));

    const needing = await rowsOf({ mic: "NoDevice", vrchat: "not_found", cables: [], needs: [{ id: "translation", action: "choose" }] });
    // No virtual cable needs the user too (decided in #759).
    assert.deepEqual(states(needing.rows),
        { mic: "attention", vrchat: "attention", virtual_mic: "attention", translation: "attention", recognition: "attention" });
    // The layout says it before the words (#614): what needs the user comes first, as cards;
    // the rest follow in the quiet list. Each keeps its order within its place.
    assert.deepEqual(needing.urgent, ["mic", "vrchat", "virtual_mic", "translation", "recognition"]);
    assert.deepEqual(needing.settled, []);
    assert.equal(needing.rows.mic.children, "first_run_setup.found.mic_missing");
    const lines = needing.rows.vrchat.children;
    assert.ok(Array.isArray(lines));
    assert.deepEqual(lines.map(line => line.props.children), ["vrchat_presence.not_found", "vrchat_presence.not_found_hint"]);
    assert.equal(needing.rows.vrchat.live, true, "the VRChat words change by themselves and are announced");
    // The buttons are the rows' actions; the words around them are only the finding.
    assert.equal(needing.rows.translation.children, "first_run_setup.found.translation_missing");
    const choose = needing.rows.translation.action, guide = needing.rows.virtual_mic.action;
    assert.ok(choose && guide);
    assert.equal(choose.props.children, "first_run_setup.found.translation_choose");
    assert.equal(guide.props.children, "first_run_setup.found.virtual_mic_open");

    const ready = await rowsOf({ engine: "SpeechCpp", server: "bundled", paths: { model: "/m/a.gguf", vad_model: "/m/v.gguf" }, opened: true,
        cables: [{ playback: "CABLE Input", recording: "CABLE Output" }] });
    assert.deepEqual(states(ready.rows),
        { mic: "ready", vrchat: "ready", virtual_mic: "ready", translation: "ready", recognition: "ready" });
    // Nothing to do: no card at all, only the quiet list.
    assert.equal(find(ready.list, node => node.type === "ul" && node.props.className === "urgent"), null);
    assert.deepEqual(ready.settled, ["mic", "vrchat", "virtual_mic", "translation", "recognition"]);
    assert.equal(ready.rows.mic.children, "Microphone (USB)");
    assert.ok(!ready.rows.translation.action, "nothing to do: no button");

    // Not known yet, or a choice made elsewhere: neither ready nor needing the user here. The
    // cards and the quiet list then share the findings by state, each in its order.
    const elsewhere = await rowsOf({ vrchat: "checking", engine: "Deepgram", opened: true,
        cables: [{ playback: "CABLE Input", recording: "CABLE Output" }], needs: [{ id: "translation", action: "choose" }] });
    assert.deepEqual([elsewhere.rows.vrchat.state, elsewhere.rows.recognition.state], ["checking", "neutral"]);
    assert.deepEqual(elsewhere.urgent, ["translation"]);
    assert.deepEqual(elsewhere.settled, ["mic", "vrchat", "virtual_mic", "recognition"]);
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
