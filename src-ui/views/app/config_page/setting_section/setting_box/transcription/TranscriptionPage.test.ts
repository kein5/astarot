import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { componentName, componentOf, find, findIn, hooks, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as cloudTranscription from "../../../../../../logics/configs/cloudTranscription.ts";
import * as utils from "../../../../../../logics/utils.ts";
import * as uiConfigs from "../../../../../../logics/ui_configs.ts";

// The speech recognition settings page (Transcription.tsx) drawn with the real list of API
// engines and the real number lists, part by part. The transcription settings hook is a stand-in
// that holds the values the test gives and records every action; the save logic of a key records
// what the page gave it; the shared rows are stand-ins that keep their props.

const t = (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key;
type Setting = { state: string; data: unknown };
const ok = (data: unknown): Setting => ({ state: "ok", data });
interface SaveRequest { variable: unknown; state?: string; label?: string; setFunction: (value: unknown) => unknown; deleteFunction?: () => unknown }

async function transcriptionPage(context: TestContext, given: Record<string, unknown> = {}) {
    const calls: unknown[][] = [], saves: SaveRequest[] = [], loading = hooks(), runtimes = new Set<HookRuntime>([loading]);
    let active: HookRuntime = loading;
    context.onTestFinished(() => { for (const runtime of runtimes) runtime.unmount(); });
    // The module's React is the hooks of the runtime drawing at the time.
    const react = new Proxy(loading.api, { get: (_, key) => Reflect.get(active.api, key) });
    const values: Record<string, unknown> = { currentSelectedTranscriptionEngine: ok("SpeechCpp"), currentSelectableTranscriptionEngines: ok([]), currentCustomWhisperURL: ok(""), ...given };
    const settings = new Proxy({}, { get: (_, key) => {
        const name = String(key);
        if (name in values) return values[name];
        if (name.startsWith("current")) return ok(null);
        return (...args: unknown[]) => { calls.push([name, ...args]); };
    } });
    const module = await loadModule<typeof import("./Transcription.tsx")>(new URL("./Transcription.tsx", import.meta.url), { ...loading, api: react }, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@utils": utils,
        "@logics_configs": { useTranscription: () => settings,
            useSaveButtonLogic: (request: SaveRequest) => { saves.push(request); return { variable: request.variable, onChangeFunction: "change", saveFunction: "save" }; } },
        "../../../../../../logics/configs/cloudTranscription": cloudTranscription,
        "../_components/credential_pair/CredentialPair": { CredentialPair: "credential-pair" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model-link" },
        "../advanced_settings/SpeechServers": { SpeechServers: "speech-servers" },
        "./RealtimeASRSettings": { RealtimeASRSettings: "realtime-asr" },
        "./AsrApiEntries": { AsrApiEntries: "asr-api-entries" },
        "../_templates/Templates": { WordFilterContainer: "word-filter", RadioButtonContainer: "radio", DropdownMenuContainer: "dropdown", AuthKeyContainer: "auth-key",
            SliderContainer: "slider" },
        "../_components": { SectionLabelComponent: "section-label" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup-section" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    // Draws one of the module's components (or an element of one) with hook memory of its own.
    const draw = (node: TreeNode, runtime: HookRuntime = hooks()) => {
        runtimes.add(runtime);
        active = runtime;
        return runtime.render(componentOf(node), node.props);
    };
    const element = (type: unknown, props: object = {}) => {
        const node = treeNode({ type, props });
        assert.ok(node);
        return node;
    };
    const page = () => draw(element(module.Transcription));
    // The first of the page's own components of that name: the parts are drawn level by level until one holds it.
    const reach = (name: string): TreeNode => {
        const queue: unknown[] = [page()];
        while (queue.length > 0) {
            const parts = nodesIn(queue.shift()).filter(node => typeof node.type === "function");
            const found = parts.find(node => componentName(node) === name);
            if (found) return found;
            for (const node of parts) queue.push(draw(node));
        }
        assert.fail(`the page has no ${name}`);
    };
    return { module, calls, saves, values, draw, element, page, reach };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const ofType = (tree: unknown, type: string) => nodesIn(tree).filter(node => node.type === type);
// The calls other than the API container's questions about the engines, which each drawing of it asks.
const actions = (calls: unknown[][]) => calls.filter(call => !["getSelectableTranscriptionEngines", "getSelectedTranscriptionEngine"].includes(String(call[0])));

test("the page puts the engine first, then speech.cpp and the APIs under their names, and the timing and captions in the advanced fold", async context => {
    const p = await transcriptionPage(context, { currentMicPhraseTimeout: ok(null), currentSpeakerPhraseTimeout: ok(4) });
    const tree = p.page();
    assert.equal(tree.type, "hints");
    const groups = nodesIn(tree).filter(node => componentName(node) === "EngineGroup");
    assert.deepEqual(groups.map(node => node.props.group), ["speechcpp", "api"]);
    const named = groups.map(node => {
        const drawn = p.draw(node);
        const label = findIn(drawn, inner => inner.type === "section-label").props;
        return [drawn.props["data-engine-group"], findIn(drawn, inner => inner.props?.["data-setting-id"] !== undefined).props["data-setting-id"], label.sub, label.label, label.desc];
    });
    assert.deepEqual(named, [["speechcpp", "speechcpp_section", true, "config_page.transcription.speechcpp_section.label", "config_page.transcription.speechcpp_section.desc"],
        ["api", "cloud_section", true, "config_page.transcription.cloud_section.label", "config_page.transcription.cloud_section.desc"]]);
    assert.deepEqual(findIn(tree, node => node.type === "speech-servers").props.profiles, ["asr"]);
    // An unknown pause shows as a dash in the fold's line.
    assert.equal(findIn(tree, node => node.type === "advanced").props.status, `config_page.advanced_status.transcription {"phrase":"-","speaker":4}`);
    p.values.currentMicPhraseTimeout = ok(5);
    p.values.currentSpeakerPhraseTimeout = ok(undefined);
    assert.equal(findIn(p.page(), node => node.type === "advanced").props.status, `config_page.advanced_status.transcription {"phrase":5,"speaker":"-"}`);
    const engine = p.draw(p.reach("TranscriptionEngine_Container"));
    assert.deepEqual(ofType(engine, "section-label").map(node => [node.props.label, node.props.sub]), [["config_page.transcription.section_label_transcription_engines", undefined]]);
});

test("each source's timing is one fold whose line shows the values in use, and each value is chosen from a list", async context => {
    const p = await transcriptionPage(context, { currentMicRecordTimeout: { state: "pending", data: 3 }, currentMicPhraseTimeout: ok(5), currentMicMaxWords: ok(10),
        currentSpeakerRecordTimeout: ok(null), currentSpeakerPhraseTimeout: ok(4), currentSpeakerMaxWords: ok(null) });
    for (const [container, source, record, phrase, queue] of [["Mic_Container", "mic", 3, 5, 10], ["Speaker_Container", "speaker", "-", 4, "-"]] as const) {
        const drawn = p.draw(p.reach(container));
        assert.deepEqual(ofType(drawn, "section-label").map(node => [node.props.label, node.props.sub]), [[`config_page.transcription.section_label_${source}`, true]]);
        const fold = findIn(drawn, node => componentName(node) === "TimingFold");
        const section = p.draw(fold);
        assert.deepEqual([section.type, section.props.title, section.props.status], ["setup-section", "config_page.transcription.timing_title",
            `config_page.transcription.timing_status ${JSON.stringify({ record, phrase, queue })}`]);
    }
    p.values.currentMicPhraseTimeout = ok(null);
    const unknown = p.draw(findIn(p.draw(p.reach("Mic_Container")), node => componentName(node) === "TimingFold"));
    assert.equal(unknown.props.status, `config_page.transcription.timing_status ${JSON.stringify({ record: 3, phrase: "-", queue: 10 })}`);
    const word = p.draw(findIn(p.draw(p.reach("Mic_Container")), node => componentName(node) === "MicWordFilter_Box"));
    assert.deepEqual([word.type, word.props.label, word.props.desc], ["word-filter", "config_page.transcription.mic_word_filter.label", "config_page.transcription.mic_word_filter.desc"]);
    assert.equal(find(p.draw(p.reach("Speaker_Container")), node => componentName(node) === "MicWordFilter_Box"), null, "the word filter is the microphone's");
    const boxes: [string, string, string, string, number][] = [
        ["MicRecordTimeout_Box", "mic_record_timeout", "MicRecordTimeout", "mic_record_timeout", 31], ["MicPhraseTimeout_Box", "mic_phrase_timeout", "MicPhraseTimeout", "mic_phrase_timeout", 31],
        ["MicMaxWords_Box", "mic_max_phrase", "MicMaxWords", "mic_max_phrase", 31], ["SpeakerRecordTimeout_Box", "speaker_record_timeout", "SpeakerRecordTimeout", "speaker_record_timeout", 31],
        ["SpeakerPhraseTimeout_Box", "speaker_phrase_timeout", "SpeakerPhraseTimeout", "speaker_phrase_timeout", 31], ["SpeakerMaxWords_Box", "speaker_max_phrase", "SpeakerMaxWords", "speaker_max_phrase", 61]];
    for (const [name, id, base, key, count] of boxes) {
        const row = p.draw(p.reach(name)).props;
        assert.deepEqual([row.dropdown_id, row.label, row.desc, row.selected_id, row.state, row.list],
            [id, `config_page.transcription.${key}.label`, `config_page.transcription.${key}.desc`, p.values[`current${base}`] && (p.values[`current${base}`] as Setting).data,
                (p.values[`current${base}`] as Setting).state, utils.genNumObjArray(count)], name);
        row.selectFunction({ selected_id: 7 });
        assert.deepEqual(p.calls.at(-1), [`set${base}`, 7], name);
    }
});

test("the engine is one choice: speech.cpp, or an API once the backend has its key, and the one in use is named in the screen's words", async context => {
    const p = await transcriptionPage(context, { currentSelectedTranscriptionEngine: ok("Deepgram"), currentSelectableTranscriptionEngines: ok(["SpeechCpp", "Groq_Whisper"]) });
    const radio = p.draw(p.reach("TranscriptionEngine_Box"));
    assert.equal(radio.type, "radio");
    const props = radio.props;
    assert.deepEqual([props.label, props.desc, props.name], ["config_page.transcription.select_transcription_engine.label", "config_page.transcription.select_transcription_engine.desc",
        "select_transcription_engine"]);
    const engine = (key: string) => `config_page.transcription.select_transcription_engine.engines.${key}`;
    assert.deepEqual(props.groups, [
        { id: "speechcpp", label: "config_page.transcription.speechcpp_section.label", options: [{ id: "SpeechCpp", label: engine("speechcpp") }] },
        { id: "api", label: "config_page.transcription.cloud_section.label", options: [{ id: "Groq_Whisper", label: engine("groq_whisper"), disabled: false },
            { id: "OpenAI_Whisper", label: engine("openai_whisper"), disabled: true }, { id: "Deepgram", label: engine("deepgram"), disabled: false },
            { id: "Custom_Whisper", label: engine("custom_whisper"), disabled: true }] }]);
    assert.equal(props.checked_variable, p.values.currentSelectedTranscriptionEngine);
    assert.deepEqual([props.note.type, props.note.props.role, textOf(props.note)], ["span", "status", `transcription_consent.selected {"engine":"${engine("deepgram")}"}`]);
    assert.equal(props.note_id, props["aria-describedby"]);
    props.selectFunction("Groq_Whisper");
    assert.deepEqual(p.calls.at(-1), ["setSelectedTranscriptionEngine", "Groq_Whisper"]);
    const named = async (selected: unknown) => {
        const q = await transcriptionPage(context, { currentSelectedTranscriptionEngine: ok(selected), currentSelectableTranscriptionEngines: ok(null) });
        return textOf(q.draw(q.reach("TranscriptionEngine_Box")).props.note);
    };
    assert.equal(await named("Removed_Engine"), `transcription_consent.selected {"engine":"Removed_Engine"}`, "an engine the page does not know keeps its id");
    assert.equal(await named(""), `transcription_consent.selected {"engine":"transcription_consent.unselected"}`);
    assert.equal(await named("SpeechCpp"), `transcription_consent.selected {"engine":"${engine("speechcpp")}"}`);
});

test("each API provider's key is saved or deleted with its own name and key page; the user's own server pairs its address and key", async context => {
    const values = Object.fromEntries(cloudTranscription.CLOUD_TRANSCRIPTION_ENGINES.map(engine => [`current${engine.base}AuthKey`, { state: `state-${engine.key}`, data: `key-${engine.key}` }]));
    const p = await transcriptionPage(context, values);
    const cloud = p.draw(p.reach("CloudTranscription_Container"));
    const folds = ofType(cloud, "setup-section");
    for (const [index, engine] of cloudTranscription.CLOUD_TRANSCRIPTION_ENGINES.entries()) {
        const fold = folds[index];
        if (engine.has_url) {
            const pair = findIn(fold, node => node.type === "credential-pair").props;
            assert.deepEqual([pair.base, pair.provider, pair.section], [engine.base, engine.key, "transcription"]);
            assert.equal(find(fold, node => componentName(node) === "CloudAuthKey_Box"), null);
            assert.equal(findIn(fold, node => node.type === "custom-model-link").props.section, "whisper-server");
            continue;
        }
        assert.equal(find(fold, node => node.type === "custom-model-link"), null, engine.id);
        const row = p.draw(findIn(fold, node => componentName(node) === "CloudAuthKey_Box")).props;
        const label = `config_page.transcription.${engine.key}_auth_key.label`;
        assert.deepEqual([row.label, row.desc, row.webpage_url, row.variable, row.state, row.remove_border_bottom, row.onChangeFunction, row.saveFunction],
            [label, undefined, engine.webpage_url, `key-${engine.key}`, `state-${engine.key}`, true, "change", "save"], engine.id);
        const save = p.saves.at(-1);
        assert.ok(save);
        assert.deepEqual([save.label, save.variable, save.state], [label, `key-${engine.key}`, `state-${engine.key}`]);
        save.setFunction("new");
        save.deleteFunction?.();
        assert.deepEqual(actions(p.calls.splice(0)), [[`set${engine.base}AuthKey`, "new"], [`delete${engine.base}AuthKey`]], engine.id);
    }
    assert.deepEqual([uiConfigs.groq_auth_key_url, uiConfigs.openai_auth_key_url, uiConfigs.deepgram_auth_key_url].length, 3);
    // A key row of an engine with an address of its own says what the key is for.
    const custom = cloudTranscription.CLOUD_TRANSCRIPTION_ENGINES.find(engine => engine.has_url);
    assert.ok(custom);
    const row = p.draw(p.element(componentOf(p.reach("CloudAuthKey_Box")), { engine: custom })).props;
    assert.equal(row.desc, "config_page.transcription.custom_whisper_auth_key.desc");
});

test("a key the backend answered with as a number is shown as its text; no key stays empty", async context => {
    const p = await transcriptionPage(context, { currentGroqWhisperAuthKey: ok(12345), currentOpenAIWhisperAuthKey: ok(undefined), currentDeepgramAuthKey: ok(true) });
    const rows = ofType(p.draw(p.reach("CloudTranscription_Container")), "setup-section").slice(0, 3)
        .map(fold => p.draw(findIn(fold, node => componentName(node) === "CloudAuthKey_Box")).props.variable);
    assert.deepEqual(rows, ["12345", undefined, "true"]);
    const missing = await transcriptionPage(context);
    assert.equal(p.draw(findIn(ofType(missing.draw(missing.reach("CloudTranscription_Container")), "setup-section")[0], node => componentName(node) === "CloudAuthKey_Box")).props.variable,
        null);
});

test("each API's model list opens once its key is saved, and sends the model chosen", async context => {
    const p = await transcriptionPage(context);
    for (const engine of cloudTranscription.CLOUD_TRANSCRIPTION_ENGINES) {
        const list = [{ id: "m", label: "M" }];
        p.values[`currentSelectable${engine.base}ModelList`] = ok(list);
        const view = (key: unknown, model: unknown) => {
            p.values[`current${engine.base}AuthKey`] = ok(key);
            p.values[`currentSelected${engine.base}Model`] = { state: `state-${engine.key}`, data: model };
            const fold = ofType(p.draw(p.reach("CloudTranscription_Container")), "setup-section")[cloudTranscription.CLOUD_TRANSCRIPTION_ENGINES.indexOf(engine)];
            const row = p.draw(findIn(fold, node => componentName(node) === "CloudModel_Box")).props;
            return [row.dropdown_id, row.label, row.selected_id, row.is_disabled, row.state, row.list, row.selectFunction];
        };
        const id = `select_${engine.key}_model`, label = `config_page.transcription.select_${engine.key}_model.label`;
        assert.deepEqual(view(null, null).slice(0, 6), [id, label, "config_page.common.correct_auth_key_required", true, `state-${engine.key}`, list], engine.id);
        assert.deepEqual(view("key", null).slice(0, 4), [id, label, null, false], engine.id);
        const [, , named, disabled, , , select] = view("", "kept");
        assert.deepEqual([named, disabled], ["kept", true], engine.id);
        select({ selected_id: "chosen" });
        assert.deepEqual(actions(p.calls.splice(0)), [[`setSelected${engine.base}Model`, "chosen"]], engine.id);
    }
});

test("a key or the own server's address saved, rejected or removed asks the backend again which engines it can use", async context => {
    const p = await transcriptionPage(context);
    const element = p.reach("CloudTranscription_Container"), runtime = hooks();
    const asked = () => p.calls.filter(call => ["getSelectableTranscriptionEngines", "getSelectedTranscriptionEngine"].includes(String(call[0]))).length;
    p.draw(element, runtime);
    assert.equal(asked(), 2);
    p.draw(element, runtime);
    assert.equal(asked(), 2, "nothing changed");
    for (const [setting, value] of [["currentGroqWhisperAuthKey", "a"], ["currentOpenAIWhisperAuthKey", "b"], ["currentDeepgramAuthKey", "c"], ["currentCustomWhisperAuthKey", "d"],
        ["currentCustomWhisperURL", "http://own"]] as const) {
        const before = asked();
        p.values[setting] = ok(value);
        p.draw(element, runtime);
        assert.equal(asked(), before + 2, setting);
    }
    assert.deepEqual(p.calls.slice(0, 2).map(call => call[0]), ["getSelectableTranscriptionEngines", "getSelectedTranscriptionEngine"]);
});

test("the Whisper engines' segment filter: each source's two thresholds from their sliders, in a fold whose line shows them", async context => {
    const p = await transcriptionPage(context, { currentMicAvgLogprob: { state: "ok", data: -1 }, currentMicNoSpeechProb: ok(0.6), currentSpeakerAvgLogprob: ok(null),
        currentSpeakerNoSpeechProb: { state: "pending", data: 0.25 } });
    const fold = p.draw(p.reach("WhisperSegmentFilter_Box"));
    assert.deepEqual([fold.type, fold.props.title, fold.props.desc, fold.props.status], ["setup-section", "config_page.transcription.whisper_filter.title",
        "config_page.transcription.whisper_filter.desc",
        `config_page.transcription.whisper_filter.status ${JSON.stringify({ mic_logprob: -1, mic_no_speech: 0.6, speaker_logprob: "-", speaker_no_speech: 0.25 })}`]);
    const unknown = await transcriptionPage(context);
    assert.equal(unknown.draw(unknown.reach("WhisperSegmentFilter_Box")).props.status,
        `config_page.transcription.whisper_filter.status ${JSON.stringify({ mic_logprob: "-", mic_no_speech: "-", speaker_logprob: "-", speaker_no_speech: "-" })}`);
    const sliders = ofType(fold, "slider").map(node => node.props);
    const expected = [["MicAvgLogprob", "mic_avg_logprob", -2, 0, [-2, -1.5, -1, -0.5, 0]], ["MicNoSpeechProb", "mic_no_speech_prob", 0, 1, [0, 0.25, 0.5, 0.75, 1]],
        ["SpeakerAvgLogprob", "speaker_avg_logprob", -2, 0, [-2, -1.5, -1, -0.5, 0]], ["SpeakerNoSpeechProb", "speaker_no_speech_prob", 0, 1, [0, 0.25, 0.5, 0.75, 1]]] as const;
    assert.equal(sliders.length, 4);
    for (const [index, [base, key, min, max, labels]] of expected.entries()) {
        const slider = sliders[index];
        const setting = p.values[`current${base}`] as Setting;
        assert.deepEqual([slider.label, slider.desc, slider.state, slider.variable, slider.min, slider.max, slider.step, slider.show_label_values, slider.remove_border_bottom],
            [`config_page.transcription.whisper_filter.${key}.label`, `config_page.transcription.whisper_filter.${key}.desc`, setting.state, setting.data, min, max, 0.05, labels,
                index === 3], base);
        slider.setterFunction(0.1);
        assert.deepEqual(p.calls.at(-1), [`set${base}`, 0.1], base);
    }
    const cloud = nodesIn(p.draw(p.reach("CloudTranscription_Container")));
    const entries = cloud.findIndex(node => node.type === "asr-api-entries"), filter = cloud.findIndex(node => componentName(node) === "WhisperSegmentFilter_Box");
    assert.ok(entries > 0 && filter > entries, "the user's APIs after the folds, then the filter");
});

test("each API is one fold that says whether it can be used; the one in use stays open, and the user's own server is marked as theirs", async context => {
    const p = await transcriptionPage(context, { currentSelectedTranscriptionEngine: ok("OpenAI_Whisper"), currentSelectableTranscriptionEngines: ok(["Groq_Whisper", "OpenAI_Whisper"]) });
    const folds = ofType(p.draw(p.reach("CloudTranscription_Container")), "setup-section").map(node => [textOf(node.props.title), node.props.status, node.props.attention]);
    const engine = (key: string) => `config_page.transcription.select_transcription_engine.engines.${key}`;
    assert.deepEqual(folds, [[engine("groq_whisper"), "config_page.translation.provider_ready", false], [engine("openai_whisper"), "config_page.translation.provider_in_use", true],
        [engine("deepgram"), "config_page.translation.provider_not_set", false],
        [`${engine("custom_whisper")} config_page.transcription.select_transcription_engine.badge_own`, "config_page.translation.provider_not_set", false]]);
    const none = await transcriptionPage(context, { currentSelectableTranscriptionEngines: ok(null) });
    assert.deepEqual(ofType(none.draw(none.reach("CloudTranscription_Container")), "setup-section").map(node => node.props.status)[0], "config_page.translation.provider_not_set");
});
