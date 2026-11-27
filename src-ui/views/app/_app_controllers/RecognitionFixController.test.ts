import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, kitStandIns, loadModule, find, nodesIn } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
import * as fixes from "../../../logics/transcription/recognitionFix.ts";
import type { RecognitionFix } from "../../../logics/transcription/recognitionFix.ts";
import { localeAt, readLocale } from "../../../logics/test/locales.ts";

type Realtime = { server: string; mic: { language: string }; speaker: { language: string } };
const QWEN = { id: "qwen3-asr-06b-q8", target: "asr", name: "Qwen3-ASR 0.6B · Q8_0", total_bytes: 841502336,
    speech: { name: "qwen3-asr-0.6b", label: "Qwen3-ASR 0.6B", type: "q8_0", default: true, detects: true, languages: ["ja", "en"] },
    profile: { recommended_for: ["en"] } };

async function fixture(context: TestContext) {
    const runtime = hooks(), events: unknown[][] = [];
    const state = {
        realtime: { server: "bundled", mic: { language: "ja" }, speaker: { language: "auto" } } as Realtime | null,
        saved: "/models/reazonspeech.gguf",
        // Listening's own model (#1242): none, so Listening shares Mic input's.
        listening: "",
        catalog: { models: [QWEN] } as unknown,
        jobs: {} as Record<string, { job_id?: string; phase?: string } | undefined>,
        error: null as string | null,
    };
    const hook = await loadModule<typeof import("../../../logics/transcription/useRecognitionFix.ts")>(new URL("../../../logics/transcription/useRecognitionFix.ts", import.meta.url), runtime);
    const { RecognitionFixController } = await loadModule<typeof import("./RecognitionFixController.tsx")>(new URL("./RecognitionFixController.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "ja" } }) },
        "@logics_main": { useMainFunction: () => ({
            setTranscriptionSend: (value: unknown) => events.push(["send", value]),
            setTranscriptionReceive: (value: unknown) => events.push(["receive", value]),
        }) },
        "@logics_common": { useNotificationStatus: () => ({
            showNotification_Success: (text: unknown) => events.push(["success", text]),
            showNotification_Error: (text: unknown) => events.push(["error", text]),
        }) },
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => events.push(["config_page", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => events.push(["tab", value]) }),
        },
        "../../../logics/transcription/useRecognitionFix": hook,
        "../../../logics/transcription/recognitionFix": fixes,
        "../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => ({ settings: state.realtime,
            send: (endpoint: string, value: unknown) => events.push([endpoint, value]) }) },
        "../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings: { profiles: { asr: { model: state.saved, listening_model: state.listening } } },
            send: (endpoint: string, value: unknown) => events.push([endpoint, value]) }) },
        "../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ catalog: state.catalog, state: { jobs: state.jobs, downloaded: { "reazonspeech-v2-q8": { model: "/models/reazonspeech.gguf" } } }, error: state.error,
            send: (endpoint: string, value?: unknown) => events.push(value === undefined ? [endpoint] : [endpoint, value]) }) },
        "../../../logics/voice/modelCatalog": { familyLabel: (entry: { speech?: { label?: string } }) => entry.speech?.label },
        "../../../logics/setup/useFirstRunSetup": { useFirstRunSetup: () => ({ openSetup: () => events.push(["setup"]) }) },
        "../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => events.push(["close"]) }) },
        "../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ fromCode: (code: string) => `name:${code}` }) },
        "../../../logics/configs/revealSetting.ts": { revealSetting: (target: unknown) => events.push(["reveal", target]) },
        "../config_page/setting_section/setting_box/advanced_settings/ModelDownloads": { ModelDownloads: "model-downloads" },
    });
    context.onTestFinished(() => runtime.unmount());
    const render = () => runtime.render(RecognitionFixController);
    const open = (endpoint: string, details: unknown) => {
        const fix = fixes.recognitionFixOf(endpoint, details) as RecognitionFix;
        runtime.render(hook.useRecognitionFix).open(fix);
        return render();
    };
    const buttons = (tree: TreeNode | null) => nodesIn(find(tree, node => node.type === kitStandIns.DialogFooter))
        .filter(node => node.type === kitStandIns.Button).map(node => [node.props.children, node.props.tone]);
    const click = (key: string) => {
        const button = find(render(), node => node.type === kitStandIns.Button && node.props.children === `recognition_fix.${key}`);
        assert.ok(button, key);
        button.props.onClick();
    };
    return { runtime, hook, state, events, render, open, buttons, click };
}

const RECEIVE = "/set/enable/transcription_receive", SEND = "/set/enable/transcription_send";

test("nothing is shown until a speech recognition switch is refused", async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
});

test("missing models lead to the setup, which reviews and downloads them; nothing starts here", async context => {
    const s = await fixture(context);
    const tree = s.open(SEND, { reason: "realtime_asr_model_missing" });
    const dialog = find(tree, node => node.type === kitStandIns.Dialog);
    assert.ok(dialog);
    assert.equal(find(dialog, node => node.type === kitStandIns.DialogTitle)?.props.children, "recognition_fix.title");
    assert.deepEqual(nodesIn(find(dialog, node => node.type === kitStandIns.DialogHeader)).filter(node => node.type === "p").map(node => node.props.children),
        ["recognition_fix.models_body"]);
    assert.equal(find(tree, node => node.props?.autoFocus)?.props.children, "recognition_fix.close", "the safe action takes focus");
    assert.deepEqual(s.buttons(tree), [["recognition_fix.close", undefined], ["recognition_fix.open_setting", undefined],
        ["recognition_fix.get_models", "primary"]]);
    assert.equal(find(tree, node => node.type === "model-downloads"), null);
    s.click("get_models");
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["setup"]]);
});

test("the setting leads to the speech.cpp models, or to the source's language", async context => {
    const s = await fixture(context);
    s.open(RECEIVE, { reason: "realtime_vad_model_missing" });
    s.click("open_setting");
    assert.deepEqual(s.events, [["close"], ["tab", "transcription"], ["config_page", true], ["reveal", { setting_id: "speechcpp_section" }]]);
    s.events.length = 0;
    s.open(SEND, { reason: "realtime_language_unsupported", languages: ["ja"] });
    s.click("open_setting");
    assert.deepEqual(s.events, [["close"], ["tab", "transcription"], ["config_page", true], ["reveal", { setting_id: "realtime_mic_language" }]]);
});

// #1298: Listening refused on "auto": each button of the dialog goes on for Listening alone. The
// setting it opens is Listening's language, which offers "auto" again for a model that tells it.
test("for Listening on auto, the setting it opens is Listening's language", async context => {
    const s = await fixture(context);
    const tree = s.open(RECEIVE, { reason: "realtime_language_auto_unsupported", languages: ["ja"] });
    assert.deepEqual(s.buttons(tree), [["recognition_fix.close", undefined], ["recognition_fix.open_setting", undefined]]);
    s.click("open_setting");
    assert.deepEqual(s.events, [["close"], ["tab", "transcription"], ["config_page", true], ["reveal", { setting_id: "realtime_speaker_language" }]]);
    s.events.length = 0;
    s.open(RECEIVE, { reason: "realtime_language_auto_unsupported", languages: ["ja"] });
    s.click("close");
    assert.equal(s.render(), null);
    assert.equal(s.events.some(event => ["receive", "/set/data/realtime_asr_settings"].includes(String(event[0]))), false, "closing changes nothing");
});

test("a language is chosen here, saved, and the switch is turned on again once it is saved", async context => {
    const s = await fixture(context);
    const tree = s.open(RECEIVE, { reason: "realtime_language_auto_unsupported", languages: ["en", "ja"] });
    assert.deepEqual(nodesIn(find(tree, node => node.type === kitStandIns.DialogHeader)).filter(node => node.type === "p").map(node => node.props.children),
        ["recognition_fix.language_auto_body"]);
    const select = find(s.render(), node => node.type === "select");
    assert.ok(select);
    assert.equal(select.props.value, "ja", "the UI's language first");
    assert.deepEqual(nodesIn(select).filter(node => node.type === "option").map(node => [node.props.value, node.props.children]),
        [["en", "name:en"], ["ja", "name:ja"]]);
    select.props.onChange({ target: { value: "en" } });
    // The language's action is under its field, before the model offer; the footer closes or leads to the setting.
    const action = find(find(s.render(), node => node.props?.["data-recognition-fix-language"] === true), node => node.type === kitStandIns.Button);
    assert.deepEqual([action?.props.children, action?.props.tone], ["recognition_fix.use_language", "primary"]);
    assert.deepEqual(s.buttons(s.render()), [["recognition_fix.close", undefined], ["recognition_fix.open_setting", undefined]]);
    s.click("use_language");
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["/set/data/realtime_asr_settings", { server: "bundled", mic: { language: "ja" }, speaker: { language: "en" } }]]);
    // Not before the settings come back with it.
    s.render();
    assert.equal(s.events.some(event => event[0] === "receive"), false);
    s.state.realtime = { server: "bundled", mic: { language: "ja" }, speaker: { language: "en" } };
    s.render();
    s.render();
    assert.deepEqual(s.events.filter(event => event[0] === "receive"), [["receive", true]], "turned on once");
});

test("on the bundled server, a model that tells the language is offered through its review", async context => {
    const s = await fixture(context);
    const tree = s.open(RECEIVE, { reason: "realtime_language_auto_unsupported", languages: ["ja"] });
    const offer = find(tree, node => node.type === "model-downloads");
    assert.ok(offer);
    // For Listening it is Listening's own model (#1242): the field it fills is Listening's.
    assert.deepEqual([offer.props.targets, offer.props.only, offer.props.expected], [["asr"], ["qwen3-asr-06b-q8"], { asr: { model: "" } }]);
    assert.equal(find(tree, node => node.type === "h3")?.props.children, "recognition_fix.detect_heading");
    // Not when the language is merely unsupported, nor on a server of the user's own.
    assert.equal(find(s.open(RECEIVE, { reason: "realtime_language_unsupported", languages: ["ja"] }), node => node.type === "model-downloads"), null);
    s.state.realtime = { server: "external", mic: { language: "ja" }, speaker: { language: "auto" } };
    assert.equal(find(s.open(RECEIVE, { reason: "realtime_language_auto_unsupported", languages: ["ja"] }), node => node.type === "model-downloads"), null);
});

test("the downloaded model is applied once, and the switch turns on when its path is saved", async context => {
    const s = await fixture(context);
    const offer = find(s.open(RECEIVE, { reason: "realtime_language_auto_unsupported", languages: ["ja"] }), node => node.type === "model-downloads");
    s.state.jobs = { "qwen3-asr-06b-q8": { job_id: "old", phase: "applied" } };
    offer?.props.onStart("qwen3-asr-06b-q8");
    s.events.length = 0;
    // An earlier job is not this download.
    s.render();
    assert.deepEqual(s.events, []);
    s.state.jobs = { "qwen3-asr-06b-q8": { job_id: "new", phase: "downloading" } };
    s.render();
    s.state.jobs = { "qwen3-asr-06b-q8": { job_id: "new", phase: "ready" } };
    s.render();
    s.render();
    // Applied for Listening alone: Mic input keeps its model (#1242).
    assert.deepEqual(s.events, [["/run/apply_model_download", { id: "qwen3-asr-06b-q8", job_id: "new", expected: { model: "" }, source: "speaker" }]]);
    s.state.listening = "/models/qwen3-asr.gguf";
    s.render();
    s.render();
    assert.deepEqual(s.events.slice(1), [["success", "recognition_fix.model_ready"], ["receive", true]]);
    assert.equal(s.runtime.render(s.hook.useRecognitionFix).waiting, null);
});

test("an apply refused while the ASR server runs says how to go on and turns nothing on", async context => {
    const s = await fixture(context);
    const offer = find(s.open(SEND, { reason: "realtime_language_auto_unsupported", languages: ["ja"] }), node => node.type === "model-downloads");
    offer?.props.onStart("qwen3-asr-06b-q8");
    s.state.jobs = { "qwen3-asr-06b-q8": { job_id: "new", phase: "ready" } };
    s.render();
    s.state.error = "model_target_busy";
    s.render();
    s.render();
    assert.deepEqual(s.events.filter(event => ["error", "send", "receive"].includes(String(event[0]))), [["error", "recognition_fix.server_running"]]);
    assert.equal(s.runtime.render(s.hook.useRecognitionFix).waiting, null);
});

// #1242 (decided on 2026-11-27): Listening's own model that does not fit beside Mic input's is
// offered one model for both. Listening's own model is taken away, and Listening turns on once the
// saved settings come back without it; Mic input's model is named, as the catalog names it.
test("when the two models do not fit, Listening is offered Mic input's model and turns on once it is saved", async context => {
    const s = await fixture(context);
    s.state.listening = "/models/qwen3-asr.gguf";
    const tree = s.open(RECEIVE, { reason: "realtime_asr_models_do_not_fit" });
    assert.equal(find(tree, node => node.type === "p")?.props.children, "recognition_fix.share_body");
    assert.deepEqual(s.buttons(tree), [["recognition_fix.close", undefined], ["recognition_fix.open_setting", undefined], ["recognition_fix.use_shared", "primary"]]);
    const share = find(find(tree, node => node.type === kitStandIns.DialogFooter), node => node.type === kitStandIns.Button && node.props.children === "recognition_fix.use_shared");
    s.events.length = 0;
    share?.props.onClick();
    assert.deepEqual(s.events, [["close"], ["/set/data/speech_server_settings",
        { profiles: { asr: { model: "/models/reazonspeech.gguf", listening_model: "" } } }]]);
    s.render();
    assert.equal(s.events.some(event => event[0] === "receive"), false, "not before the settings come back");
    s.state.listening = "";
    s.render();
    s.render();
    assert.deepEqual(s.events.filter(event => event[0] === "receive"), [["receive", true]]);
});

// Mic input's fix still changes Mic input's model, and only Mic input's.
test("for Mic input, the model that tells the language becomes Mic input's", async context => {
    const s = await fixture(context);
    const offer = find(s.open(SEND, { reason: "realtime_language_auto_unsupported", languages: ["ja"] }), node => node.type === "model-downloads");
    assert.deepEqual(offer?.props.expected, { asr: { model: "/models/reazonspeech.gguf" } });
    offer?.props.onStart("qwen3-asr-06b-q8");
    s.state.jobs = { "qwen3-asr-06b-q8": { job_id: "new", phase: "ready" } };
    s.events.length = 0;
    s.render();
    assert.deepEqual(s.events, [["/run/apply_model_download", { id: "qwen3-asr-06b-q8", job_id: "new", expected: { model: "/models/reazonspeech.gguf" } }]]);
});

test("the words exist in both languages with the same names to fill in", () => {
    for (const language of ["en", "ja"]) {
        const locale = readLocale(language);
        for (const key of ["title", "models_body", "get_models", "language_auto_body", "language_body", "language_label", "use_language",
            "detect_heading", "detect_body", "detect_body_listening", "open_setting", "close", "model_ready", "server_running",
            "share_body", "use_shared", "mic_model"]) {
            assert.equal(typeof localeAt(locale, `recognition_fix.${key}`), "string", `${language} ${key}`);
        }
        assert.match(String(localeAt(locale, "recognition_fix.title")), /\{\{name\}\}/);
        assert.match(String(localeAt(locale, "recognition_fix.detect_body")), /\{\{model\}\}.*\{\{count\}\}.*\{\{name\}\}/);
        assert.match(String(localeAt(locale, "recognition_fix.use_shared")), /\{\{model\}\}/);
    }
});
