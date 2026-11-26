import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, isRecord, stubGlobals, componentName } from "../../../../../../logics/test/hookHarness.ts";
import { rebaseDraft } from "../../../../../../logics/voice/draftRebase.ts";
import * as vocabularyTerms from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { RealtimeAsrSettings } from "../../../../../../logics/transcription/useRealtimeASR.ts";
import * as fieldErrors from "../../../../../../logics/configs/fieldErrors.ts";
import * as recognitionFix from "../../../../../../logics/transcription/recognitionFix.ts";

// The settings the page writes, read back as far as the tests read them: a source for each input,
// and the vocabulary's terms when it is there.
const isSettings = (value: unknown): value is RealtimeAsrSettings => isRecord(value) && isRecord(value.mic) && isRecord(value.speaker)
    && (value.vocabulary === undefined || (isRecord(value.vocabulary) && Array.isArray(value.vocabulary.terms)));

// The realtime ASR hook, as far as the page reads it in these tests.
interface Asr {
    settings: RealtimeAsrSettings;
    state: Record<string, unknown>;
    endpoints: Record<string, unknown>;
    models: Record<string, unknown>;
    error: string | null;
    builtinVocabulary: readonly string[] | null;
    send: (endpoint: string, data?: unknown) => unknown;
    updateError: (error: string | null) => void;
}
interface Listener {
    type: string;
    fn: (event: unknown) => void;
    capture: boolean;
}
type Reply = (answer: { status: number; result: unknown }) => void;

// hints: whether the page keeps descriptions out of sight (#614).
async function fixture(context: TestContext, { hints = false }: { hints?: boolean } = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), calls: [string, unknown][] = [], listeners: Listener[] = [], responses: Reply[] = [];
    const window = {
        addEventListener(type: string, fn: Listener["fn"], options?: { capture?: boolean }) { listeners.push({ type, fn, capture: !!options?.capture }); },
        removeEventListener(type: string, fn: Listener["fn"]) { const i = listeners.findIndex(row => row.type === type && row.fn === fn); if (i >= 0) listeners.splice(i, 1); },
        dispatch(type: string, event: unknown) { [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))
            .filter(row => row.type === type).forEach(row => { row.fn(event); }); },
    };
    stubGlobals(context, { window });
    runtime.api.useSyncExternalStore = (_, snapshot) => snapshot();
    const draftHooks = await loadModule(new URL("../../../../../../logics/voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, 
    });
    const asr: Asr = {
        settings: { server: "external", base_url: "http://localhost:8080", model: "asr-model",
            mic: { endpoint: null, follow_default: true, language: "ja" },
            speaker: { endpoint: null, follow_default: true, language: "ja" },
            vocabulary: { builtin: true, terms: [] } },
        state: {}, endpoints: {}, models: {}, error: null, builtinVocabulary: null,
        send: (endpoint, data) => {
            calls.push([endpoint, data]);
            if (endpoint.startsWith("/set/")) return new Promise(resolve => responses.push(resolve));
            return true;
        },
        updateError: error => { asr.error = error; },
    };
    const speech = { state: {}, send: () => {} };
    const { RealtimeASRSettings } = await loadModule<typeof import("./RealtimeASRSettings.tsx")>(new URL("./RealtimeASRSettings.tsx", import.meta.url), runtime, { "../../../../../../logics/configs/fieldErrors.ts": fieldErrors, "../_components/field_problem/FieldProblem": { FieldProblem: "field-problem" },
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "ja" } }) },
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ fromCode: (code: string) => code }) },
        "../../../../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => asr },
        "../../../../../../logics/transcription/recognitionFix": recognitionFix,
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => speech },
        "../../../../../../logics/voice/useSettingsDraft": draftHooks,
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "./VocabularyFiles.tsx": { VocabularyFiles: "vocabulary-files" },
        "./VocabularyList.tsx": { VocabularyList: "vocabulary-list" },
        "../../../../../../logics/transcription/vocabularyTerms.ts": vocabularyTerms,
    });
    const render = () => { runtime.render(RealtimeASRSettings); return runtime.render(RealtimeASRSettings); };
    const field = (label: string) => findIn(render(), node => node.type === "input" && node.props["aria-label"] === label).props;
    const changeURL = () => { field("realtime.url").onChange({ target: { value: "http://localhost:9090" } }); render(); };
    // #1111: the form saves when focus leaves it, on Enter in the address, and a choice at once.
    const form = () => findIn(render(), node => node.type === "form").props;
    const leave = () => { form().onBlur({ relatedTarget: null }); render(); };
    // The page writes nothing but its settings, whole.
    const writes = () => calls.filter(([endpoint]) => endpoint.startsWith("/set/")).map(([endpoint, value]): [string, RealtimeAsrSettings] => {
        assert.ok(isSettings(value), endpoint);
        return [endpoint, value];
    });
    const reply = () => {
        const respond = responses.shift();
        assert.ok(respond);
        return respond;
    };
    const acknowledge = async (value: RealtimeAsrSettings) => {
        asr.settings = value;
        reply()({ status: 200, result: value });
        for (let i = 0; i < 10; i++) await Promise.resolve();
        render();
    };
    // The backend refuses a write with its error code and a non-200 reply to that write.
    const refuse = async (code: string) => {
        asr.error = code;
        reply()({ status: 400, result: { error_code: code } });
        for (let i = 0; i < 10; i++) await Promise.resolve();
        render();
    };
    context.onTestFinished(() => { runtime.unmount(); });
    render();
    return { runtime, asr, render, field, changeURL, form, leave, writes, acknowledge, refuse, window, listeners, calls };
}

// #792: the page asks for the built-in terms and hands them, with the dictionary, to one list where
// terms are added, changed and taken out. A change from the list goes to the draft and the save bar.
test("the dictionary is one list, with the built-in terms the page asked for", async context => {
    const s = await fixture(context);
    assert.ok(s.calls.some(([endpoint]) => endpoint === "/get/data/builtin_vocabulary"), "the page asks for the built-in terms");
    const list = () => findIn(s.render(), node => node.type === "vocabulary-list");
    assert.equal(list().props.builtin, null, "the list draws the user's terms until the core answers");
    s.asr.builtinVocabulary = ["VRChat=ブイアールチャット,ブイチャ", "Quest=クエスト"];
    s.asr.settings = { ...s.asr.settings, vocabulary: { builtin: true, terms: ["猫丸", "Quest=くえすと"], removed: ["VRChat"] } };
    s.runtime.remount();
    assert.deepEqual(list().props.builtin, s.asr.builtinVocabulary);
    assert.deepEqual(list().props.vocabulary, { builtin: true, terms: ["猫丸", "Quest=くえすと"], removed: ["VRChat"] });
    // No second place to add a term: the list is the one.
    assert.equal(find(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_add"), null);
    list().props.onVocabulary({ builtin: true, terms: ["猫丸"] });
    s.render();
    // A change from the list saves at once (#1111, decided 3); the form is not in the save bar.
    assert.deepEqual(s.writes().map(([, value]) => value.vocabulary), [{ builtin: true, terms: ["猫丸"] }]);
    // The form's listeners go while the window stub is still there.
    s.runtime.unmount();
});

test("the captions save by themselves: the address when focus leaves the form, not while it moves inside", async context => {
    const s = await fixture(context);
    s.changeURL();
    assert.deepEqual(s.writes(), [], "typing never submits");
    // Focus moving from the address to another field of the form saves nothing yet.
    s.form().ref({ contains: () => true });
    s.form().onBlur({ relatedTarget: {} }); s.render();
    assert.deepEqual(s.writes(), []);
    s.leave();
    assert.deepEqual(s.writes().map(([, value]) => value.base_url), ["http://localhost:9090"]);
    s.runtime.unmount();
    assert.equal(s.listeners.length, 0);
});

test("a dictionary file read in saves at once, as a term added in the list does", async context => {
    // #792: the file part hands the dictionary it read to the form, which saves it at once (#1111).
    // It writes out the dictionary the page shows, through the page's own requests.
    const s = await fixture(context);
    let tree = s.render();
    const files = findIn(tree, node => node.type === "vocabulary-files");
    assert.deepEqual(files.props.vocabulary, { builtin: true, terms: [] });
    assert.equal(files.props.send, s.asr.send);
    files.props.onVocabulary({ builtin: true, terms: ["VRChat=ブイアールチャット", "Midnight Rooftop"] });
    tree = s.render();
    assert.deepEqual(findIn(tree, node => node.type === "vocabulary-files").props.vocabulary.terms, ["VRChat=ブイアールチャット", "Midnight Rooftop"]);
    assert.deepEqual(s.writes().map(([, value]) => value.vocabulary?.terms), [["VRChat=ブイアールチャット", "Midnight Rooftop"]]);
    await s.acknowledge(s.writes()[0][1]);
    // A term added in the list joins the same terms.
    const list = findIn(s.render(), node => node.type === "vocabulary-list");
    assert.deepEqual(list.props.vocabulary.terms, ["VRChat=ブイアールチャット", "Midnight Rooftop"]);
    list.props.onVocabulary({ ...list.props.vocabulary, terms: [...list.props.vocabulary.terms, "猫丸=ねこまる"] });
    assert.deepEqual(findIn(s.render(), node => node.type === "vocabulary-files").props.vocabulary.terms,
        ["VRChat=ブイアールチャット", "Midnight Rooftop", "猫丸=ねこまる"]);
    assert.equal(s.writes().length, 2);
    // No bulk add and no copy of the terms remain.
    assert.equal(find(s.render(), node => node.type === "textarea"), null);
    // The form's listeners go while the window stub is still there.
    s.runtime.unmount();
});

test("leaving the page with an edit asks nothing first, and Escape puts the saved address back", async context => {
    // #1111, decided 4: an edit not saved yet goes with the page.
    const s = await fixture(context);
    s.changeURL();
    for (const type of ["vrct:settings-leave", "beforeunload"]) {
        const event = { defaultPrevented: false, detail: { proceed() {} }, preventDefault() { this.defaultPrevented = true; } };
        s.window.dispatch(type, event);
        assert.equal(event.defaultPrevented, false, type);
    }
    assert.equal(find(s.render(), node => node.type === "dialog"), null);
    s.form().onKeyDown({ key: "Escape", target: { tagName: "INPUT", type: "text" }, preventDefault() {} }); s.render();
    assert.equal(s.field("realtime.url").value, "http://localhost:8080");
    assert.deepEqual(s.writes(), []);
});

for (const method of ["Enter", "leaving"]) {
    test(`${method} saves the address once and waits for its answer without starting audio`, async context => {
        const s = await fixture(context);
        s.changeURL();
        const save = () => {
            if (method === "Enter") s.field("realtime.url").onKeyDown({ key: "Enter", preventDefault() {} });
            else s.leave();
            s.render();
        };
        save();
        assert.equal(s.field("realtime.url").readOnly, true);
        // No Save button: the form saves by itself.
        assert.equal(find(s.render(), node => node.type === "button" && node.props.type === "submit"), null);
        save();
        assert.equal(s.writes().length, 1);
        assert.equal(s.writes()[0][0], "/set/data/realtime_asr_settings");
        assert.equal(s.writes()[0][1].base_url, "http://localhost:9090");
        await s.acknowledge(s.writes()[0][1]);
        assert.equal(s.field("realtime.url").readOnly, false);
        assert.equal(s.writes().length, 1, "the save asked for while one waited had nothing left to save");
        assert.ok(!s.calls.some(([endpoint]) => endpoint.startsWith("/run/")));
    });
}

test("canonical vocabulary acknowledgement enables realtime Start", async context => {
    const s = await fixture(context);
    s.asr.state = { mic: { requested: false }, speaker: { requested: false } };
    s.asr.models = { server: "external", configured_url: s.asr.settings.base_url, base_url: s.asr.settings.base_url,
        models: [{ id: "asr-model", languages: ["ja"] }] };
    findIn(s.render(), node => node.type === "vocabulary-list").props.onVocabulary({ builtin: true, terms: ["VRChat=ブイアールチャット"] });
    s.render();
    const sent = s.writes()[0][1];
    await s.acknowledge({ ...sent, vocabulary: { ...sent.vocabulary, terms: ["VRChat=ブイアールチャット"] } });
    assert.equal(s.render().props["data-unsaved"], undefined);
    assert.equal(findIn(s.render(), node => node.type === "button" && node.props.children === "realtime.start_mic").props.disabled, false);
    vi.advanceTimersByTime(5000); s.render();
    assert.equal(s.asr.error, null);
});

test("rejected and unconfirmed saves keep edits visible and say so under the form; refresh does not erase them", async context => {
    const s = await fixture(context);
    s.changeURL();
    s.asr.settings = { ...s.asr.settings, model: "refreshed-model" };
    s.render();
    assert.equal(s.field("realtime.url").value, "http://localhost:9090");
    s.leave();
    await s.refuse("invalid_settings");
    assert.equal(s.field("realtime.url").value, "http://localhost:9090");
    assert.equal(s.field("realtime.url").readOnly, false);
    const problem = () => find(s.render(), node => node.type === "field-problem");
    assert.ok(problem(), "the refusal is said under the form");
    assert.equal(find(s.render(), node => componentName(node) === "Failure"), null, "and not again below it");
    s.leave();
    vi.advanceTimersByTime(5000);
    s.render();
    assert.equal(s.asr.error, "save_unconfirmed");
    assert.equal(s.writes().length, 2);
});

const silenceSelect = (tree: unknown) => findIn(tree, node => node.type === "select" && node.props["aria-label"] === "realtime.silence");
const optionValues = (node: unknown): unknown[] => nodesIn(node).filter(child => child.type === "option").map(child => child.props.value);

test("the silence that ends an utterance is saved when chosen and left out for the default", async context => {
    const s = await fixture(context);
    const select = () => silenceSelect(s.render()).props;
    assert.equal(select().value, "", "the default by default");
    // The default (0.4 s) comes first; the default before, 0.5 s, can still be chosen.
    assert.deepEqual(optionValues(silenceSelect(s.render())), ["", 300, 500, 700, 1000]);
    // A choice saves at once (#1111, decided 3).
    select().onChange({ target: { value: "300" } });
    assert.equal(select().value, 300);
    assert.equal(s.writes()[0][1].silence_duration_ms, 300);
    await s.acknowledge(s.writes()[0][1]);
    // Back to the default: the field goes, as the backend leaves it out.
    select().onChange({ target: { value: "" } });
    s.render();
    assert.equal("silence_duration_ms" in s.writes()[1][1], false);
    await s.acknowledge(s.writes()[1][1]);
    assert.equal(select().value, "");
    assert.equal(s.writes().length, 2);
});

const thresholdSelect = (tree: unknown) => findIn(tree, node => node.type === "select" && node.props["aria-label"] === "realtime.vad_threshold");

test("the speech detection threshold is saved when chosen and left out for the server's own", async context => {
    // #392: none chosen sends none; a chosen one is saved as a number.
    const s = await fixture(context);
    const select = () => thresholdSelect(s.render()).props;
    assert.equal(select().value, "", "the server's own by default");
    assert.deepEqual(optionValues(thresholdSelect(s.render())), ["", 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    select().onChange({ target: { value: "0.3" } });
    assert.equal(select().value, 0.3);
    assert.equal(s.writes()[0][1].vad_threshold, 0.3);
    await s.acknowledge(s.writes()[0][1]);
    select().onChange({ target: { value: "" } });
    s.render();
    assert.equal("vad_threshold" in s.writes()[1][1], false);
    await s.acknowledge(s.writes()[1][1]);
    assert.equal(select().value, "");
});

test("a silence saved before the default became 0.4 s stays chosen", async context => {
    // 0.4 s was a choice of its own before it became the default: a saved 400 stays saved and
    // shows as itself, so the setting does not move when the default changes again.
    const s = await fixture(context);
    s.asr.settings = { ...s.asr.settings, silence_duration_ms: 400 };
    s.render();
    const select = silenceSelect(s.render());
    assert.equal(select.props.value, 400);
    assert.deepEqual(optionValues(select), ["", 400, 300, 500, 700, 1000]);
    assert.equal(s.render().props["data-unsaved"], undefined);
    assert.deepEqual(s.writes(), []);
});

// #614: on the speech recognition page the captions' words are hints: what they are is the
// heading's, a field's its label's. What to do before Start and the states stay in sight.
for (const hints of [false, true]) test(`${hints ? "hints" : "no hints"}: the captions' descriptions follow the page`, async context => {
    const s = await fixture(context, { hints });
    s.asr.settings = { ...s.asr.settings, server: "bundled" };
    const tree = s.render();
    const heading = findIn(tree, node => node.type === "section-label");
    assert.equal(heading.props.sub, true);
    assert.equal(heading.props.desc, "realtime.scope\nrealtime.server_help");
    const row = (label: string) => findIn(tree, node => node.type === "form-row" && node.props.label === label).props;
    assert.equal(row("realtime.model").description, "realtime.auto_help");
    assert.equal(row("realtime.silence").description, "realtime.silence_help");
    // Following the system's default says what that does; the game audio says which output to pick.
    assert.equal(row("realtime.mic_input").description, "realtime.follow_default_help");
    assert.equal(row("realtime.speaker_input").description, "realtime.speaker_help\nrealtime.follow_default_help");
    const check = findIn(tree, node => node.type === "hint-check").props;
    assert.deepEqual([check.label, check.description], ["realtime.start_server", "realtime.start_server_help"]);
    const descriptions: unknown[] = [];
    find(tree, node => { if (node.type === "description") descriptions.push(node.props.text); return false; });
    // Saving before Start is what the disabled Start waits for: it stays in sight.
    assert.deepEqual(descriptions, hints ? ["realtime.save_help"] : ["realtime.vocabulary_help", "realtime.save_help"]);
    const legend = find(tree, node => node.type === "legend" && JSON.stringify(node.props.children).includes("realtime.vocabulary\""));
    const mark = find(legend, node => node.type === "hint");
    assert.equal(Boolean(mark), hints);
    if (hints) {
        assert.ok(mark);
        assert.deepEqual([mark.props.text, mark.props.focusable], ["realtime.vocabulary_help", true]);
    }
});
