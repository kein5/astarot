import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, componentName, draw, drawWith, kitStandIns } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
import { branchAt, localeAt, readLocale } from "../../../logics/test/locales.ts";
import * as logic from "../../../logics/setup/firstRunSetup.ts";
import * as needsLogic from "../../../logics/main/setupNeeds.ts";
import * as translationLogic from "../../../logics/setup/translationSetup.ts";
import * as restrictions from "../../../logics/voice/modelRestrictions.ts";
import * as choicesLogic from "../../../logics/setup/setupChoices.ts";
import * as catalogLogic from "../../../logics/voice/modelCatalog.ts";
import * as licenseLogic from "../../../logics/configs/ctranslate2License.ts";
import * as warningLogic from "../../../logics/voice/modelHardwareWarning.ts";

const CATALOG = {
    catalog_version: "2026-11-16.3",
    models: [
        { id: "reazonspeech-v2-q8", target: "asr", name: "ReazonSpeech v2 · Q8_0", provider: "Reazon Research / sakasegawa",
            license: "Apache-2.0", licenses: ["https://example.invalid/card"], total_bytes: 660910656,
            speech: { name: "reazonspeech-v2", default: true }, profile: { recommended_for: ["ja"] } },
        { id: "silero-vad-v62", target: "vad", name: "Silero VAD v6.2 · F32", provider: "Silero Team / sakasegawa",
            license: "MIT", licenses: ["https://example.invalid/vad"], total_bytes: 1238624, profile: { recommended_for: [] } },
        { id: "m2m100-418m-onnx-int8", target: "translation", name: "M2M100 418M · int8", provider: "Meta / VRCT-VOX",
            license: "MIT", licenses: ["https://example.invalid/mit"], source: "https://example.invalid/m2m100", total_bytes: 500000000, restrictions: [] },
        { id: "nllb-200-distilled-600m-onnx-int8", target: "translation", name: "NLLB-200 distilled 600M · int8", provider: "Meta / VRCT-VOX",
            license: "CC-BY-NC-4.0", licenses: ["https://example.invalid/nc"], total_bytes: 900000000, restrictions: ["non_commercial"] },
        // Another recognition model, and the text to speech's (#955).
        { id: "qwen3-asr-06b-q8", target: "asr", name: "Qwen3-ASR 0.6B · Q8_0", provider: "Qwen / sakasegawa",
            license: "Apache-2.0", licenses: ["https://example.invalid/qwen"], total_bytes: 800000000,
            speech: { name: "qwen3-asr-06b", default: true }, profile: { recommended_for: ["en"] } },
        { id: "irodori-v41-f16", target: "japanese", name: "Irodori-TTS v4.1 Small MF · F16", provider: "Irodori / sakasegawa",
            license: "MIT", licenses: ["https://example.invalid/irodori"], total_bytes: 1900000000,
            profile: { summary: "mf", recommended_for: ["ja"], gpu: "recommended", cpu: "impractical" } },
        { id: "qwen3-06b-q8", target: "multilingual", name: "Qwen3-TTS 12Hz 0.6B CustomVoice · Q8_0", provider: "Qwen / sakasegawa",
            license: "Apache-2.0", licenses: ["https://example.invalid/qwen-tts"], total_bytes: 1200000000, profile: { summary: "qwen", recommended_for: ["en"] } },
    ],
};

// A catalog without translation models: the setup has none to offer.
const NO_TRANSLATION = { ...CATALOG, models: CATALOG.models.filter(model => model.target !== "translation") };

// A world the dialog reads: the saved settings, the download state and what it sent.
interface World {
    notice: boolean;
    settled: boolean;
    opened: boolean;
    telemetryPending: boolean;
    engine: string | null;
    server: string;
    paths: { model: string; vad_model: string };
    catalog: object | null;
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
    // The selected translation model (CTRANSLATE2_WEIGHT_TYPE), and the ones on the PC.
    weight: string;
    downloaded: string[];
    // The speech server profiles' models (the text to speech's, #955).
    speech: Record<string, { model: string }>;
    // What the PC has, for the choices' warnings (#955).
    hardware: object;
    // The main screen's switches the setup leads to after "Done" (#955).
    leads: string[];
}

function world(values: Partial<World> = {}): World {
    return { notice: true, settled: false, opened: true, telemetryPending: false,
        engine: null, server: "external", paths: { model: "", vad_model: "" }, catalog: CATALOG, jobs: {},
        downloadError: null, realtimeError: null, sent: [], calls: [],
        mic: "Microphone (USB)", vrchat: "found", cables: [], needs: [], weight: "m2m100_418M-ct2-int8", downloaded: [], speech: { japanese: { model: "" }, multilingual: { model: "" } }, hardware: { phase: "unknown", devices: [] }, leads: [], ...values };
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
            useTranslation: () => ({ currentSelectedCTranslate2WeightType: { state: "ok", data: w.weight },
                currentCTranslate2WeightTypeStatus: { state: "ok", data: w.downloaded.map(id => ({ id, is_downloaded: true })) },
                setSelectedCTranslate2WeightType: (value: unknown) => { w.calls.push(["weight", value]); } }),
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
            catalog: w.catalog, state: { jobs: w.jobs }, error: w.downloadError, hardware: w.hardware, ensureHardware: () => w.calls.push("hardware"),
            send: async (endpoint: string, data: unknown) => { record(endpoint, data); if (endpoint.startsWith("/run/")) w.downloadError = null; } }) },
        "../../../logics/voice/useVirtualMic": { useVirtualMic: () => ({ status: { supported: true, cables: w.cables, error: null }, openGuide: () => w.calls.push("guide") }) },
        "../../../logics/main/useSetupNeeds": { useSetupNeeds: () => ({ needs: w.needs, start: (id: string) => w.calls.push(["start", id]) }) },
        "../../../logics/main/setupNeeds": needsLogic,
        "../../../logics/setup/translationSetup.ts": translationLogic,
        "../../../logics/voice/modelRestrictions": restrictions,
        "../../../logics/setup/setupChoices.ts": choicesLogic,
        "../../../logics/voice/modelCatalog": catalogLogic,
        "../../../logics/configs/ctranslate2License": licenseLogic,
        "../../../logics/voice/modelHardwareWarning": warningLogic,
        "../../../logics/setup/useSetupLeads": { useSetupLeads: () => ({ leads: w.leads, lead: (ids: string[]) => { w.leads = [...ids]; }, settle: () => {} }) },
        "../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings: { profiles: w.speech } }) },
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
    // A one-model section (#955), by its words: the translation's or the text to speech's.
    const modelPart = (tree: unknown, words: string) => findIn(tree, node => componentName(node) === "ModelSetup" && node.props.words === words, words);
    return { render, button, buttons, part, modelPart };
}

// #935: it never opens by itself, not even pending with the recognition needing it, after the
// other notices; the first screen's line to it stands out instead (EmptyState).
test("it never opens by itself; it opens from the first screen whatever the notice says", async context => {
    // #936: nor with only the translation's model left.
    const ready = { engine: "SpeechCpp", server: "bundled", paths: { model: "/m/a.gguf", vad_model: "/m/v.gguf" } };
    const translationLeft = { ...ready, needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8" } }] };
    for (const values of [{}, { telemetryPending: true }, { engine: "Deepgram" }, { notice: false }, translationLeft])
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
    // The step that downloads a known size has a bar, named after the step; no bar while the size
    // is not known or once it is checked; before its first bytes it stands at 0.
    const local = hooks();
    context.onTestFinished(() => local.unmount());
    const bar = () => find(drawWith(local, s.part(s.render(), "RecognitionSetup")), node => node.type === kitStandIns.Progress)?.props;
    assert.deepEqual([bar()?.["aria-label"], bar()?.value, bar()?.max], ["first_run_setup.recognition.step_model", 1, 2]);
    for (const job of [{ received_bytes: 1, total_bytes: 0 }, { phase: "verifying", received_bytes: 2, total_bytes: 2 }]) {
        w.jobs = { "reazonspeech-v2-q8": { job_id: "j1", phase: "downloading", ...job } };
        assert.equal(bar(), undefined, JSON.stringify(job));
    }
    w.jobs = { "reazonspeech-v2-q8": { job_id: "j1", phase: "downloading", total_bytes: 2 } };
    assert.equal(bar()?.value, 0);
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
    const local = hooks();
    context.onTestFinished(() => local.unmount());
    const bar = () => find(drawWith(local, s.part(s.render(), "RecognitionSetup")), node => node.type === kitStandIns.Progress);
    stale.jobs = { "reazonspeech-v2-q8": { job_id: "j1", phase: "downloading", received_bytes: 1, total_bytes: 2 } };
    assert.ok(bar(), "the step downloads");
    stale.downloadError = "catalog_changed";
    tree = s.render();
    assert.deepEqual(s.part(tree, "RecognitionSetup").props.run.failure, { step: 0, code: "catalog_changed" });
    // The step failed: it says why, and its bar is gone even while the job still reports bytes.
    assert.equal(bar(), null);
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
        // Where each row is drawn: the cards of what needs the user (the kit's ItemGroup as it is),
        // or the quiet list after them (its outline).
        const placed = (variant: string | undefined) => {
            const group = find(list, node => node.type === kitStandIns.ItemGroup && node.props.variant === variant);
            return nodesIn(group).filter(isFinding).map(node => shortName(node.props));
        };
        return { rows: Object.fromEntries(rows.map(row => [shortName(row), row])), urgent: placed(undefined), settled: placed("outline"), list, calls: w.calls };
    };
    const states = (rows: Record<string, FindingRow>) => Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row.state]));

    const needing = await rowsOf({ mic: "NoDevice", vrchat: "not_found", cables: [], catalog: NO_TRANSLATION,
        weight: "m2m100_1.2B-ct2-int8", needs: [{ id: "translation", action: "choose" }] });
    // No virtual cable needs the user too (decided in #759).
    assert.deepEqual(states(needing.rows),
        { mic: "attention", vrchat: "attention", virtual_mic: "attention", translation: "attention", recognition: "attention" });
    // The layout says it before the words (#614): what needs the user comes first, as cards;
    // the rest follow in the quiet list. Each keeps its order within its place.
    assert.deepEqual(needing.urgent, ["mic", "vrchat", "virtual_mic", "translation", "recognition"]);
    assert.deepEqual(needing.settled, []);
    assert.equal(find(needing.list, node => node.type === kitStandIns.ItemGroup && node.props.variant === "outline"), null, "no empty frame");
    assert.equal(needing.rows.mic.children, "first_run_setup.found.mic_missing");
    const lines = needing.rows.vrchat.children;
    assert.ok(Array.isArray(lines));
    assert.deepEqual(lines.map(line => line.props.children), ["vrchat_presence.not_found", "vrchat_presence.not_found_hint"]);
    assert.equal(needing.rows.vrchat.live, true, "the VRChat words change by themselves and are announced");
    // The buttons are the rows' actions; the words around them are only the finding.
    assert.equal(needing.rows.translation.children, "first_run_setup.found.translation_missing");
    const choose = needing.rows.translation.action, guide = needing.rows.virtual_mic.action;
    assert.ok(choose && guide);
    assert.equal(choose.props.children, "first_run_setup.found.translation_open_settings");
    assert.equal(guide.props.children, "first_run_setup.found.virtual_mic_open");

    const ready = await rowsOf({ engine: "SpeechCpp", server: "bundled", paths: { model: "/m/a.gguf", vad_model: "/m/v.gguf" }, opened: true,
        cables: [{ playback: "CABLE Input", recording: "CABLE Output" }] });
    assert.deepEqual(states(ready.rows),
        { mic: "ready", vrchat: "ready", virtual_mic: "ready", translation: "ready", recognition: "ready" });
    // Nothing to do: no card at all, only the quiet list.
    assert.equal(find(ready.list, node => node.type === kitStandIns.ItemGroup && node.props.variant === undefined), null);
    assert.deepEqual(ready.settled, ["mic", "vrchat", "virtual_mic", "translation", "recognition"]);
    assert.equal(ready.rows.mic.children, "Microphone (USB)");
    assert.ok(!ready.rows.translation.action, "nothing to do: no button");

    // Not known yet, or a choice made elsewhere: neither ready nor needing the user here. The
    // cards and the quiet list then share the findings by state, each in its order.
    // #936: the selected translator's model can be fetched (a new install): the setup's own
    // section prepares it, so the row says where and has no button that leaves the setup.
    const fetchable = await rowsOf({ needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8" } }] });
    assert.deepEqual([fetchable.rows.translation.state, fetchable.rows.translation.children, fetchable.rows.translation.action],
        ["attention", "first_run_setup.found.translation_model_missing", undefined]);
    // The model's list not read yet: the row waits for it, and still leads nowhere else.
    const unread = await rowsOf({ catalog: null, needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8" } }] });
    assert.deepEqual([unread.rows.translation.state, unread.rows.translation.children, unread.rows.translation.action],
        ["checking", "first_run_setup.recognition.loading", undefined]);
    // A download started elsewhere shows how far it has come.
    const fetching = await rowsOf({ needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8", progress: 42 } }] });
    assert.deepEqual([fetching.rows.translation.state, fetching.rows.translation.children], ["checking", "studio.setup_downloading"]);
    // Nothing the setup can prepare: the Translation settings, where an API key or another model
    // is set up (decided in #938), not the translator list, which has nothing to choose without them.
    const before2 = needing.calls.length;
    choose.props.onClick();
    assert.deepEqual(needing.calls.slice(before2), ["closed", "close", ["tab", "translation"], ["opened", true]]);
    // Another model selected that the catalog does not have: the section below offers the default
    // model, and the row also leads to the Translation settings.
    const other = await rowsOf({ weight: "m2m100_1.2B-ct2-int8", needs: [{ id: "translation", action: "choose" }] });
    assert.deepEqual([other.rows.translation.state, other.rows.translation.children], ["attention", "first_run_setup.found.translation_switch_here"]);
    const otherAction = other.rows.translation.action;
    assert.ok(otherAction);
    assert.equal(otherAction.props.children, "first_run_setup.found.translation_open_settings");

    const elsewhere = await rowsOf({ vrchat: "checking", engine: "Deepgram", opened: true,
        cables: [{ playback: "CABLE Input", recording: "CABLE Output" }], needs: [{ id: "translation", action: "choose" }] });
    assert.deepEqual([elsewhere.rows.vrchat.state, elsewhere.rows.recognition.state], ["checking", "neutral"]);
    assert.deepEqual(elsewhere.urgent, ["translation"]);
    assert.deepEqual(elsewhere.settled, ["mic", "vrchat", "virtual_mic", "recognition"]);
});

// The rows are the kit's Item (U-08): the attention card for what needs the user, quiet rows in the
// outline group for the rest; the mark of the row's state, the name over the words, and the action.
test("a finding is drawn as the kit's Item, its look and mark from its state", async context => {
    const s = await setup(context, world({ mic: "NoDevice", vrchat: "checking", cables: [{ playback: "CABLE Input", recording: "CABLE Output" }],
        catalog: NO_TRANSLATION, weight: "m2m100_1.2B-ct2-int8", needs: [{ id: "translation", action: "choose" }] }));
    const list = draw(s.part(s.render(), "Findings"));
    assert.equal(findIn(list, node => node.type === "h4", "the heading").props.children, "first_run_setup.found.heading");
    const drawn = Object.fromEntries(nodesIn(list).filter(isFinding).map(node => [shortName(node.props), draw(node)]));
    const look = (name: string) => {
        const row = drawn[name];
        const media = findIn(row, node => node.type === kitStandIns.ItemMedia, "the mark");
        const content = findIn(row, node => node.type === kitStandIns.ItemContent, "the content");
        const description = findIn(content, node => node.type === kitStandIns.ItemDescription, "the words");
        const actions = find(row, node => node.type === kitStandIns.ItemActions);
        return [row.type === kitStandIns.Item, row.props.variant, row.props["data-state"], media.props.state,
            findIn(content, node => node.type === kitStandIns.ItemTitle, "the name").props.children, description.props.role, !!actions];
    };
    assert.deepEqual(look("mic"), [true, "attention", "attention", "attention", "first_run_setup.found.mic", undefined, false]);
    // The VRChat words change by themselves, so they are announced.
    assert.deepEqual(look("vrchat"), [true, "default", "checking", "checking", "first_run_setup.found.vrchat", "status", false]);
    assert.deepEqual(look("virtual_mic"), [true, "default", "ready", "ready", "first_run_setup.found.virtual_mic", undefined, true]);
    assert.deepEqual(look("translation"), [true, "attention", "attention", "attention", "first_run_setup.found.translation", undefined, true]);
    // The action is the row's own button, under its words.
    const action = findIn(findIn(drawn.translation, node => node.type === kitStandIns.ItemActions), node => node.type === "button", "the button");
    assert.equal(action.props.children, "first_run_setup.found.translation_open_settings");
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

// #936: the translation's model is prepared in the setup itself: reviewed (name, provider,
// license, size, the model's card), consented to, downloaded and applied without leaving it, and
// the setup then says the translation is ready.
test("the translation's model is reviewed, downloaded and applied in the setup, which then says it is ready", async context => {
    const w = world({ needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8" } }] });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const section = () => drawWith(local, s.modelPart(s.render(), "translation"));
    let drawn = section();
    const facts = nodesIn(drawn).filter(node => node.type === "span").map(node => [node.props.children].flat().join(""));
    assert.ok(facts.includes("M2M100 418M · int8"));
    assert.ok(facts.includes("first_run_setup.recognition.model_license"));
    const card = find(drawn, node => node.type === "a");
    assert.equal(card?.props.href, "https://example.invalid/m2m100", "the model's card is linked");
    // As the recognition's section: its total, one consent, and the way to other models.
    assert.equal(find(drawn, node => node.type === "p" && node.props.children === "first_run_setup.recognition.total")?.type, "p");
    assert.equal(nodesIn(drawn).filter(node => node.type === "input" && node.props.type === "checkbox").length, 1);
    assert.ok(find(drawn, node => node.props?.tab === "translation" && node.props?.label === "first_run_setup.found.translation_open_settings"));
    assert.equal(find(drawn, node => node.type === "p" && node.props.children === "first_run_setup.translation.what")?.type, "p");
    const startButton = () => nodesIn(section()).find(node => node.type === "button" && node.props.children === "first_run_setup.recognition.start");
    assert.equal(startButton()?.props.disabled, true, "nothing starts before the consent");
    const consent = find(drawn, node => node.type === "input" && node.props.type === "checkbox");
    assert.ok(consent);
    consent.props.onChange({ target: { checked: true } });
    assert.equal(startButton()?.props.disabled, false);
    startButton()?.props.onClick();
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/run/start_model_download", { id: "m2m100-418m-onnx-int8", consent: true, catalog_version: "2026-11-16.3" }]);
    // Its download, in the setup; the row above says it is being prepared there.
    w.jobs = { "m2m100-418m-onnx-int8": { job_id: "j1", phase: "downloading", received_bytes: 100, total_bytes: 500000000 } };
    drawn = section();
    const bar = () => find(section(), node => node.type === kitStandIns.Progress)?.props;
    assert.deepEqual([bar()?.["aria-label"], bar()?.value, bar()?.max], ["first_run_setup.translation.step_model", 100, 500000000]);
    // No bar while the size is not known or once it is checked; before its first bytes it stands at 0.
    for (const job of [{ received_bytes: 100, total_bytes: 0 }, { phase: "verifying", received_bytes: 500000000, total_bytes: 500000000 }]) {
        w.jobs = { "m2m100-418m-onnx-int8": { job_id: "j1", phase: "downloading", ...job } };
        assert.equal(bar(), undefined, JSON.stringify(job));
    }
    w.jobs = { "m2m100-418m-onnx-int8": { job_id: "j1", phase: "downloading", total_bytes: 500000000 } };
    assert.equal(bar()?.value, 0);
    const rows = () => nodesIn(draw(s.part(s.render(), "Findings"))).filter(node => node.props?.id === "translation" || node.props?.name === "first_run_setup.found.translation");
    assert.equal(rows()[0]?.props.children, "first_run_setup.found.translation_preparing");
    // Verified: applied once, with nothing expected in the settings (a translation holds no path).
    w.jobs = { "m2m100-418m-onnx-int8": { job_id: "j1", phase: "ready" } };
    s.render(); s.render();
    assert.deepEqual(w.sent.filter(([endpoint]) => endpoint === "/run/apply_model_download"),
        [["/run/apply_model_download", { id: "m2m100-418m-onnx-int8", job_id: "j1", expected: {} }]]);
    // The model counts as downloaded: the setup says the translation is ready, the row reads ready.
    w.needs = [];
    s.render(); s.render();
    drawn = section();
    assert.equal(find(drawn, node => node.props?.role === "status")?.props.children, "first_run_setup.translation.finished");
    assert.equal(rows()[0]?.props.state, "ready");
});

test("with another model selected, the setup downloads the default model and then selects it", async context => {
    // A model with a restricted license selected and not on the PC: the setup recommends the default
    // (its license allows any use), as the recognition's section recommends its model.
    const w = world({ weight: "nllb-200-distilled-600M-ct2-int8",
        needs: [{ id: "translation", action: "review", weight: { id: "nllb-200-distilled-600M-ct2-int8" } }] });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const section = () => drawWith(local, s.modelPart(s.render(), "translation"));
    let drawn = section();
    assert.equal(find(drawn, node => node.type === "p" && node.props.children === "first_run_setup.translation.what_switch")?.type, "p");
    assert.ok(nodesIn(drawn).some(node => node.type === "span" && node.props.children === "M2M100 418M · int8"));
    assert.ok(!nodesIn(drawn).some(node => node.type === "strong"), "no restriction to acknowledge");
    const boxes = nodesIn(drawn).filter(node => node.type === "input" && node.props.type === "checkbox");
    assert.equal(boxes.length, 1, "one consent, as the recognition's");
    boxes[0].props.onChange({ target: { checked: true } });
    nodesIn(section()).find(node => node.type === "button" && node.props.children === "first_run_setup.recognition.start")?.props.onClick();
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/run/start_model_download", { id: "m2m100-418m-onnx-int8", consent: true, catalog_version: "2026-11-16.3" }]);
    // The steps: the download, then the choice, waiting for it.
    drawn = section();
    const steps = nodesIn(drawn).filter(node => node.type === "li" && node.props["data-state"]).map(node => node.props["data-state"]);
    assert.deepEqual(steps, ["working", "waiting"]);
    w.jobs = { "m2m100-418m-onnx-int8": { job_id: "j1", phase: "ready" } };
    s.render(); s.render();
    assert.ok(!w.calls.some(call => Array.isArray(call) && call[0] === "weight"), "not selected before it is on the PC");
    // On the PC: selected once.
    w.downloaded = ["m2m100_418M-ct2-int8"];
    s.render(); s.render(); s.render();
    assert.deepEqual(w.calls.filter(call => Array.isArray(call) && call[0] === "weight"), [["weight", "m2m100_418M-ct2-int8"]]);
    // Selected and on the PC: the need ends and the setup says the translation is ready.
    w.weight = "m2m100_418M-ct2-int8"; w.needs = [];
    s.render(); s.render();
    assert.equal(find(section(), node => node.props?.role === "status")?.props.children, "first_run_setup.translation.finished");
});

test("the default model on the PC already: nothing is downloaded and no consent is asked; only the choice changes", async context => {
    const w = world({ weight: "m2m100_1.2B-ct2-int8", downloaded: ["m2m100_418M-ct2-int8"],
        needs: [{ id: "translation", action: "choose", weight: { id: "m2m100_1.2B-ct2-int8" } }] });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const section = () => drawWith(local, s.modelPart(s.render(), "translation"));
    const drawn = section();
    assert.equal(find(drawn, node => node.type === "p" && node.props.children === "first_run_setup.translation.what_switch_only")?.type, "p");
    assert.equal(nodesIn(drawn).filter(node => node.type === "input").length, 0);
    const start = nodesIn(drawn).find(node => node.type === "button" && node.props.children === "first_run_setup.recognition.start");
    assert.equal(start?.props.disabled, false);
    start?.props.onClick();
    s.render(); s.render();
    assert.ok(!w.sent.some(([endpoint]) => endpoint === "/run/start_model_download"));
    assert.deepEqual(w.calls.filter(call => Array.isArray(call) && call[0] === "weight"), [["weight", "m2m100_418M-ct2-int8"]]);
});

// #955: each feature is chosen on its own, in the setup: a model, or none.
const choiceIn = (tree: unknown, label = "first_run_setup.choice.label") =>
    nodesIn(tree).filter(node => componentName(node) === "ModelChoice" && node.props.label === label);

test("the recognition's model is chosen in the setup, the recommended one first, or none", async context => {
    const w = world();
    const s = await setup(context, w);
    const [choice] = choiceIn(s.render());
    assert.ok(choice);
    assert.deepEqual(choice.props.choices.map((entry: { id: string }) => entry.id), ["reazonspeech-v2-q8", "qwen3-asr-06b-q8"]);
    assert.deepEqual([choice.props.recommended, choice.props.value], ["reazonspeech-v2-q8", "reazonspeech-v2-q8"]);
    // Another model: the plan downloads it instead.
    choice.props.onChange("qwen3-asr-06b-q8");
    const steps = s.part(s.render(), "RecognitionSetup").props.plan.flatMap((step: { kind: string; entry?: { id: string } }) => step.entry ? [step.entry.id] : []);
    assert.deepEqual(steps, ["qwen3-asr-06b-q8", "silero-vad-v62"]);
    // None: the section says the recognition is not used, and offers no start.
    choiceIn(s.render())[0].props.onChange("skip");
    const tree = s.render();
    assert.ok(nodesIn(tree).some(node => node.props?.children === "first_run_setup.recognition.skipped"));
    assert.ok(!s.buttons(tree).some(node => node.props.children === "first_run_setup.recognition.start"));
});

test("text to speech starts at none; a model chosen is downloaded and written into its profile", async context => {
    const w = world({ engine: "Deepgram" });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const section = () => drawWith(local, s.modelPart(s.render(), "speech"));
    let drawn = section();
    assert.ok(nodesIn(drawn).some(node => node.props?.children === "first_run_setup.speech.skipped"), "none at first: it needs a GPU");
    const choice = choiceIn(drawn)[0];
    assert.deepEqual(choice.props.choices.map((entry: { id: string }) => entry.id), ["irodori-v41-f16", "qwen3-06b-q8"]);
    assert.equal(choice.props.value, "skip");
    assert.deepEqual(["irodori-v41-f16", "qwen3-06b-q8"].map(id => choice.props.groupOf(CATALOG.models.find(model => model.id === id))),
        ["first_run_setup.speech.group_japanese", "first_run_setup.speech.group_multilingual"]);
    choice.props.onChange("irodori-v41-f16");
    drawn = section();
    const start = () => nodesIn(section()).find(node => node.type === "button" && node.props.children === "first_run_setup.recognition.start");
    assert.equal(start()?.props.disabled, true, "nothing starts before the consent");
    nodesIn(drawn).find(node => node.type === "input" && node.props.type === "checkbox")?.props.onChange({ target: { checked: true } });
    start()?.props.onClick();
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/run/start_model_download", { id: "irodori-v41-f16", consent: true, catalog_version: "2026-11-16.3" }]);
    // Verified: applied once, with the profile's path it replaces.
    w.jobs = { "irodori-v41-f16": { job_id: "j1", phase: "ready" } };
    s.render(); s.render();
    assert.deepEqual(w.sent.filter(([endpoint]) => endpoint === "/run/apply_model_download"),
        [["/run/apply_model_download", { id: "irodori-v41-f16", job_id: "j1", expected: { model: "" } }]]);
    w.jobs = { "irodori-v41-f16": { job_id: "j1", phase: "applied" } };
    s.render(); s.render();
    assert.equal(find(section(), node => node.props?.role === "status")?.props.children, "first_run_setup.speech.finished");
});

test("a translation model with a restricted license is acknowledged on its own, and selected with that consent", async context => {
    const w = world({ engine: "Deepgram", needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8" } }] });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const section = () => drawWith(local, s.modelPart(s.render(), "translation"));
    choiceIn(section())[0].props.onChange("nllb-200-distilled-600m-onnx-int8");
    const boxes = () => nodesIn(section()).filter(node => node.type === "input" && node.props.type === "checkbox");
    const start = () => nodesIn(section()).find(node => node.type === "button" && node.props.children === "first_run_setup.recognition.start");
    assert.equal(boxes().length, 2, "the consent, and one for the restriction");
    boxes()[0].props.onChange({ target: { checked: true } });
    assert.equal(start()?.props.disabled, true, "the consent alone does not start it");
    boxes()[1].props.onChange({ target: { checked: true } });
    start()?.props.onClick();
    s.render();
    assert.deepEqual(w.sent.at(-1), ["/run/start_model_download",
        { id: "nllb-200-distilled-600m-onnx-int8", consent: true, catalog_version: "2026-11-16.3", acknowledged: ["non_commercial"] }]);
    w.jobs = { "nllb-200-distilled-600m-onnx-int8": { job_id: "j1", phase: "ready" } };
    s.render(); s.render();
    w.downloaded = ["nllb-200-distilled-600M-ct2-int8"];
    s.render(); s.render(); s.render();
    assert.deepEqual(w.calls.filter(call => Array.isArray(call) && call[0] === "weight"),
        [["weight", { weight_type: "nllb-200-distilled-600M-ct2-int8", accept_non_commercial_license: true }]]);
});

// #955: the end says which switches to turn on for the features prepared, and that the others can
// stay off; "Done" is offered once every feature is ready or not to be installed, and nothing runs.
test("only text to speech: the setup ends with its switch to turn on and the others left off", async context => {
    const w = world({ needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8" } }] });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const done = () => s.buttons(s.render()).some(node => node.props.children === "first_run_setup.done");
    assert.equal(done(), false, "the recognition and the translation still to prepare");
    choiceIn(s.render())[0].props.onChange("skip");
    choiceIn(drawWith(local, s.modelPart(s.render(), "translation")))[0].props.onChange("skip");
    assert.equal(done(), true, "the recognition and the translation not used, the text to speech not installed either");
    // The text to speech prepared, the others not used.
    w.speech = { japanese: { model: "C:/models/tts/irodori.gguf" }, multilingual: { model: "" } };
    const next = s.part(s.render(), "NextSteps");
    assert.deepEqual(Object.fromEntries(Object.entries(next.props.features as Record<string, object>).map(([feature, view]) =>
        [feature, choicesLogic.featureOutcome(view as choicesLogic.FeatureView)])), { recognition: "unused", translation: "unused", speech: "use" });
    assert.ok(done());
    // Nothing is turned on: no switch is sent.
    assert.ok(!w.sent.some(([endpoint]) => /enable|toggle/.test(endpoint)));
    // The next steps are the findings' quiet rows (the kit's outline ItemGroup): ready for the
    // feature to turn on, neither for the others, each with its switch's words.
    const steps = draw(next);
    assert.equal(findIn(steps, node => node.type === "h4", "the heading").props.children, "first_run_setup.next.heading");
    const group = findIn(steps, node => node.type === kitStandIns.ItemGroup, "the rows");
    assert.equal(group.props.variant, "outline");
    assert.deepEqual(nodesIn(group).filter(isFinding).map(node => [node.props.id, node.props.state, node.props.name, node.props.children]), [
        ["next-recognition", "neutral", "first_run_setup.next.name_recognition", "first_run_setup.next.unused"],
        ["next-translation", "neutral", "first_run_setup.next.name_translation", "first_run_setup.next.unused"],
        ["next-speech", "ready", "first_run_setup.next.name_speech", "first_run_setup.next.use"],
    ]);
});

// #955: a model that may be too heavy for the PC says so in its choice, as the catalog's file choice does.
test("a model that may be too heavy for the PC says so in its choice", async context => {
    const w = world({ hardware: { phase: "ready", devices: [{ name: "cpu", kind: "cpu", description: "CPU", memory_total: 16 * 1073741824 }] } });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const speech = choiceIn(drawWith(local, s.modelPart(s.render(), "speech")))[0];
    assert.ok(w.calls.includes("hardware"), "what the PC has is read when the dialog opens");
    const byId = (id: string) => CATALOG.models.find(model => model.id === id);
    // No GPU: the voice that needs one is marked; a speech model that runs on the CPU is not.
    assert.equal(speech.props.warned(byId("irodori-v41-f16")), true);
    assert.equal(speech.props.warned(byId("qwen3-06b-q8")), false);
    // Nothing measured: nothing is marked.
    w.hardware = { phase: "unknown", devices: [] };
    const unmeasured = choiceIn(drawWith(local, s.modelPart(s.render(), "speech")))[0];
    assert.equal(unmeasured.props.warned(byId("irodori-v41-f16")), false);
});

// #955 decision 3: "Done" leads to the main screen's switches of the features prepared, which stand
// out until each is turned on; "Don't show again" before the end leads nowhere.
test("Done leads to the switches of the features prepared, and to no other", async context => {
    const w = world({ speech: { japanese: { model: "C:/models/tts/irodori.gguf" }, multilingual: { model: "" } },
        needs: [{ id: "translation", action: "review", weight: { id: "m2m100_418M-ct2-int8" } }] });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    choiceIn(s.render())[0].props.onChange("skip");
    choiceIn(drawWith(local, s.modelPart(s.render(), "translation")))[0].props.onChange("skip");
    s.button(s.render(), "first_run_setup.done").props.onClick();
    assert.deepEqual(w.leads, ["tts"]);
    // Ready speech recognition and translation, no text to speech: their switches.
    const ready = world({ engine: "SpeechCpp", server: "bundled", paths: { model: "/m/a.gguf", vad_model: "/m/v.gguf" } });
    const r = await setup(context, ready);
    r.button(r.render(), "first_run_setup.done").props.onClick();
    assert.deepEqual(ready.leads, ["transcription_send", "transcription_receive", "translation"]);
    // Put away for good before the end: no lead.
    const early = world();
    const e = await setup(context, early);
    e.button(e.render(), "first_run_setup.dont_show").props.onClick();
    assert.deepEqual(early.leads, []);
});

// D-14 (decided on 2026-11-25): a feature's model is chosen with the kit's Select, with the kit's
// options, grouped with the kit's groups where the list holds more than one kind; none comes last.
test("a model choice is the kit's Select with the kit's options and groups, and passes on the model chosen", async context => {
    const w = world({ engine: "Deepgram" });
    const s = await setup(context, w), local = hooks();
    context.onTestFinished(() => local.unmount());
    const chosen: unknown[] = [];
    const choice = choiceIn(drawWith(local, s.modelPart(s.render(), "speech")))[0];
    const drawn = draw(choice, { ...choice.props, onChange: (value: unknown) => { chosen.push(value); } });
    const select = findIn(drawn, node => node.type === kitStandIns.Select);
    assert.equal(select.props.value, "skip");
    const groups = nodesIn(select).filter(node => node.type === kitStandIns.SelectOptGroup);
    assert.deepEqual(groups.map(group => group.props.label), ["first_run_setup.speech.group_japanese", "first_run_setup.speech.group_multilingual"]);
    assert.deepEqual(nodesIn(select).filter(node => node.type === kitStandIns.SelectOption).map(option => option.props.value),
        ["irodori-v41-f16", "qwen3-06b-q8", "skip"]);
    assert.deepEqual(nodesIn(drawn).filter(node => node.type === "select" || node.type === "option" || node.type === "optgroup"), []);
    select.props.onChange({ target: { value: "qwen3-06b-q8" } });
    assert.deepEqual(chosen, ["qwen3-06b-q8"]);
    // Each option says the model and its size, marks the recommended one, adds the hardware warning
    // where the model may be too heavy, and none comes last.
    const marked = draw(choice, { ...choice.props, recommended: "irodori-v41-f16", warned: (entry: { id: string }) => entry.id === "qwen3-06b-q8" });
    assert.deepEqual(nodesIn(marked).filter(node => node.type === kitStandIns.SelectOption).map(option => [option.props.value, option.props.children]),
        [["irodori-v41-f16", "first_run_setup.choice.option_recommended"], ["qwen3-06b-q8", "first_run_setup.choice.option · model_catalog.hardware_warning.option"],
            ["skip", "first_run_setup.choice.skip"]]);
});
