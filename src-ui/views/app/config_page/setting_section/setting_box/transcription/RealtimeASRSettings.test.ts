import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, setRef, isRecord, stubGlobals } from "../../../../../../logics/test/hookHarness.ts";
import { rebaseDraft } from "../../../../../../logics/voice/draftRebase.ts";
import * as vocabularyTerms from "../../../../../../logics/transcription/vocabularyTerms.ts";
import type { RealtimeAsrSettings } from "../../../../../../logics/transcription/useRealtimeASR.ts";

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
    const runtime = hooks(), barRuntime = hooks(), calls: [string, unknown][] = [], listeners: Listener[] = [], responses: Reply[] = [];
    const window = {
        addEventListener(type: string, fn: Listener["fn"], options?: { capture?: boolean }) { listeners.push({ type, fn, capture: !!options?.capture }); },
        removeEventListener(type: string, fn: Listener["fn"]) { const i = listeners.findIndex(row => row.type === type && row.fn === fn); if (i >= 0) listeners.splice(i, 1); },
        dispatch(type: string, event: unknown) { [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))
            .filter(row => row.type === type).forEach(row => row.fn(event)); },
    };
    stubGlobals(context, { window });
    runtime.api.useSyncExternalStore = (_, snapshot) => snapshot();
    const saveBar = await loadModule<typeof import("../../../../../../logics/voice/saveBar.ts")>(new URL("../../../../../../logics/voice/saveBar.ts", import.meta.url), runtime);
    const draftHooks = await loadModule(new URL("../../../../../../logics/voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, "./saveBar": saveBar,
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
    const { RealtimeASRSettings } = await loadModule<typeof import("./RealtimeASRSettings.tsx")>(new URL("./RealtimeASRSettings.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "ja" } }) },
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ fromCode: (code: string) => code }) },
        "../../../../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => asr },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => speech },
        "../../../../../../logics/voice/useSettingsDraft": draftHooks,
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "section-label" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "./VocabularyBulk.tsx": { VocabularyBulk: "vocabulary-bulk" },
        "./VocabularyBuiltin.tsx": { VocabularyBuiltin: "vocabulary-builtin" },
        "../../../../../../logics/transcription/vocabularyTerms.ts": vocabularyTerms,
    });
    const { SaveBar } = await loadModule<typeof import("../../../topbar/Topbar.tsx")>(new URL("../../../topbar/Topbar.tsx", import.meta.url), barRuntime, {
        "@logics_common": {}, "../../../../logics/voice/saveBar": saveBar, "../../others/stop_actions/StopActions": {},
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: "transcription" } }) },
    });
    let dialogProps: { onClose: () => void } | null = null;
    const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; assert.ok(dialogProps); dialogProps.onClose(); } };
    const bar = () => barRuntime.render(SaveBar, {}, tree => {
        const dialog = find(tree, node => node.type === "dialog");
        // The dialog's ref, which React would fill with the element: the stub stands in for it.
        if (dialog) { setRef(dialog, modal); dialogProps = dialog.props; }
    });
    const render = () => { runtime.render(RealtimeASRSettings); return runtime.render(RealtimeASRSettings); };
    const field = (label: string) => findIn(render(), node => node.type === "input" && node.props["aria-label"] === label).props;
    const entries = () => saveBar.useSaveBarEntries();
    const status = () => findIn(bar(), node => node.props?.role === "status").props.children;
    const changeURL = () => { field("realtime.url").onChange({ target: { value: "http://localhost:9090" } }); render(); };
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
    context.onTestFinished(() => { runtime.unmount(); barRuntime.unmount(); });
    render();
    return { runtime, barRuntime, asr, render, bar, field, entries, status, changeURL, writes, acknowledge, refuse, window, modal, listeners, calls };
}

// #792: the page asks for the built-in terms and lists them, with the user's changes, while they are
// on. The user's own list leaves out the terms that change a built-in one; with the built-in terms
// off, it holds them all. A change from the list goes to the draft and the save bar.
test("the built-in terms are listed while they are on, and the user's list leaves out their changes", async context => {
    const s = await fixture(context);
    assert.ok(s.calls.some(([endpoint]) => endpoint === "/get/data/builtin_vocabulary"), "the page asks for the built-in terms");
    assert.equal(find(s.render(), node => node.type === "vocabulary-builtin"), null, "nothing to list before the core answers");
    s.asr.builtinVocabulary = ["VRChat=ブイアールチャット,ブイチャ", "Quest=クエスト"];
    s.asr.settings = { ...s.asr.settings, vocabulary: { builtin: true, terms: ["猫丸", "Quest=くえすと"], removed: ["VRChat"] } };
    s.runtime.remount();
    const own = () => {
        const list = findIn(s.render(), node => node.type === "ul" && node.props["aria-label"] === "realtime.vocabulary_user");
        // Each row is the term, then its remove button.
        return nodesIn(list).filter(node => node.type === "li").map(node => node.props.children[0]);
    };
    let tree = s.render();
    const builtin = findIn(tree, node => node.type === "vocabulary-builtin");
    assert.deepEqual(builtin.props.builtin, s.asr.builtinVocabulary);
    assert.deepEqual(builtin.props.vocabulary, { builtin: true, terms: ["猫丸", "Quest=くえすと"], removed: ["VRChat"] });
    assert.deepEqual(own(), ["猫丸"]);
    builtin.props.onVocabulary({ builtin: true, terms: ["猫丸"] });
    tree = s.render();
    assert.equal(s.entries().length, 1, "the change waits in the save bar");
    // With the built-in terms off there is nothing to list, and every term of the user's is theirs.
    findIn(tree, node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: false } });
    s.render();
    s.asr.settings = { ...s.asr.settings, vocabulary: { builtin: false, terms: ["猫丸", "Quest=くえすと"] } };
    s.runtime.remount();
    tree = s.render();
    assert.equal(find(tree, node => node.type === "vocabulary-builtin"), null);
    assert.deepEqual(own(), ["猫丸", "Quest=くえすと"]);
});

test("realtime drafts register and unregister with the shared save bar, including dictionary edits", async context => {
    const s = await fixture(context);
    assert.equal(s.entries().length, 1);
    assert.equal(s.status(), "voice_ui.saved");
    s.changeURL();
    let tree = s.render();
    findIn(tree, node => node.type === "input" && node.props.maxLength === 320).props.onChange({ target: { value: "VRChat=ブイアールチャット" } });
    tree = s.render();
    findIn(tree, node => node.type === "button" && node.props.children === "realtime.vocabulary_add").props.onClick();
    tree = s.render();
    assert.equal(tree.props["data-unsaved"], true);
    assert.deepEqual(s.entries()[0].changes, ["realtime.url", "realtime.vocabulary_user"]);
    assert.equal(s.status(), "voice_ui.unsaved");
    assert.deepEqual(s.writes(), [], "editing never submits");
    s.runtime.unmount();
    assert.deepEqual(s.entries(), []);
    s.barRuntime.unmount();
    assert.equal(s.listeners.length, 0);
});

test("terms added together join the draft and the save bar like one added term", async context => {
    // #446: the bulk add hands the whole list to the form; nothing is saved until the bar saves.
    const s = await fixture(context);
    let tree = s.render();
    const bulk = findIn(tree, node => node.type === "vocabulary-bulk");
    assert.deepEqual(bulk.props.terms, []);
    bulk.props.onTerms(["VRChat=ブイアールチャット", "Midnight Rooftop"]);
    tree = s.render();
    assert.deepEqual(findIn(tree, node => node.type === "vocabulary-bulk").props.terms, ["VRChat=ブイアールチャット", "Midnight Rooftop"]);
    assert.deepEqual(s.entries()[0].changes, ["realtime.vocabulary_user"]);
    assert.deepEqual(s.writes(), [], "adding never submits");
    // The single add takes an entry in the canonical form and refuses one already listed.
    const input = () => findIn(s.render(), node => node.type === "input" && node.props.maxLength === 320).props;
    const add = () => findIn(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_add").props;
    input().onChange({ target: { value: "vrchat = ぶいちゃ" } });
    assert.equal(add().disabled, true, "the written form is listed already");
    input().onChange({ target: { value: " 猫丸 = ねこまる " } });
    add().onClick();
    assert.deepEqual(findIn(s.render(), node => node.type === "vocabulary-bulk").props.terms,
        ["VRChat=ブイアールチャット", "Midnight Rooftop", "猫丸=ねこまる"]);
    // The form's listeners go while the window stub is still there.
    s.runtime.unmount();
    s.barRuntime.unmount();
});

test("the shared leave guard blocks category navigation until discard; keep editing preserves the draft", async context => {
    const s = await fixture(context);
    s.changeURL(); s.bar();
    let proceeded = 0;
    const leave = () => {
        const event = { defaultPrevented: false, detail: { proceed: () => proceeded++ },
            preventDefault() { this.defaultPrevented = true; } };
        s.window.dispatch("vrct:settings-leave", event);
        assert.equal(event.defaultPrevented, true);
        assert.equal(proceeded, 0);
        return s.bar();
    };
    let tree = leave();
    assert.equal(s.modal.open, true);
    assert.equal(find(s.render(), node => node.type === "dialog"), null, "capture guard owns the one leave dialog");
    findIn(tree, node => node.type === "button" && node.props.children === "voice_ui.keep_editing").props.onClick();
    assert.equal(s.modal.open, false);
    assert.equal(s.field("realtime.url").value, "http://localhost:9090");
    tree = leave();
    findIn(tree, node => node.type === "button" && node.props.children === "voice_ui.discard_leave").props.onClick();
    assert.equal(proceeded, 1);
    assert.equal(s.field("realtime.url").value, "http://localhost:8080");
    s.render();
    assert.equal(s.status(), "voice_ui.saved");
    assert.deepEqual(s.writes(), []);
});

for (const method of ["submit", "save bar"]) {
    test(`${method} waits for acknowledgement and publishes saving/saved without starting audio`, async context => {
        const s = await fixture(context);
        s.changeURL();
        if (method === "submit") {
            findIn(s.render(), node => node.type === "form").props.onSubmit({ preventDefault() {} });
        } else s.entries()[0].save();
        s.render();
        assert.equal(s.status(), "voice_ui.saving");
        assert.equal(s.field("realtime.url").readOnly, true);
        assert.equal(findIn(s.render(), node => node.type === "button" && node.props.type === "submit").props.disabled, true);
        findIn(s.render(), node => node.type === "form").props.onSubmit({ preventDefault() {} });
        assert.equal(s.writes().length, 1);
        assert.equal(s.writes()[0][0], "/set/data/realtime_asr_settings");
        assert.equal(s.writes()[0][1].base_url, "http://localhost:9090");
        await s.acknowledge(s.writes()[0][1]);
        assert.equal(s.status(), "voice_ui.saved");
        assert.equal(s.entries()[0].dirty, false);
    });
}

test("canonical vocabulary acknowledgement clears the save bar and enables realtime Start", async context => {
    const s = await fixture(context);
    s.asr.state = { mic: { requested: false }, speaker: { requested: false } };
    s.asr.models = { server: "external", configured_url: s.asr.settings.base_url, base_url: s.asr.settings.base_url,
        models: [{ id: "asr-model", languages: ["ja"] }] };
    findIn(s.render(), node => node.type === "input" && node.props.maxLength === 320).props.onChange({ target: { value: "VRChat = ブイアールチャット" } });
    findIn(s.render(), node => node.type === "button" && node.props.children === "realtime.vocabulary_add").props.onClick();
    s.render(); s.entries()[0].save(); s.render();
    const sent = s.writes()[0][1];
    await s.acknowledge({ ...sent, vocabulary: { ...sent.vocabulary, terms: ["VRChat=ブイアールチャット"] } });
    assert.equal(s.entries()[0].dirty, false);
    assert.equal(s.status(), "voice_ui.saved");
    assert.equal(findIn(s.render(), node => node.type === "button" && node.props.children === "realtime.start_mic").props.disabled, false);
    vi.advanceTimersByTime(5000); s.render();
    assert.equal(s.asr.error, null);
});

test("rejected and unconfirmed saves keep edits visible and guarded; refresh does not erase them", async context => {
    const s = await fixture(context);
    s.changeURL();
    s.asr.settings = { ...s.asr.settings, model: "refreshed-model" };
    s.render();
    assert.equal(s.field("realtime.url").value, "http://localhost:9090");
    s.entries()[0].save(); s.render();
    await s.refuse("invalid_settings");
    assert.equal(s.status(), "voice_ui.save_failed");
    assert.equal(s.entries()[0].edited, true);
    assert.equal(s.field("realtime.url").readOnly, false);
    s.entries()[0].save(); s.render();
    vi.advanceTimersByTime(5000);
    s.render();
    assert.equal(s.asr.error, "save_unconfirmed");
    assert.equal(s.status(), "voice_ui.save_failed");
    const event: { defaultPrevented: boolean; returnValue?: unknown; preventDefault(): void } = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    s.window.dispatch("beforeunload", event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.returnValue, "");
    s.entries()[0].discard(); s.render();
    assert.equal(s.status(), "voice_ui.saved");
});

const silenceSelect = (tree: unknown) => findIn(tree, node => node.type === "select" && node.props["aria-label"] === "realtime.silence");
const optionValues = (node: unknown): unknown[] => nodesIn(node).filter(child => child.type === "option").map(child => child.props.value);

test("the silence that ends an utterance is saved when chosen and left out for the default", async context => {
    const s = await fixture(context);
    const select = () => silenceSelect(s.render()).props;
    assert.equal(select().value, "", "the default by default");
    // The default (0.4 s) comes first; the default before, 0.5 s, can still be chosen.
    assert.deepEqual(optionValues(silenceSelect(s.render())), ["", 300, 500, 700, 1000]);
    select().onChange({ target: { value: "300" } });
    assert.equal(select().value, 300);
    assert.deepEqual(s.entries()[0].changes, ["realtime.silence"]);
    s.entries()[0].save(); s.render();
    assert.equal(s.writes()[0][1].silence_duration_ms, 300);
    await s.acknowledge(s.writes()[0][1]);
    assert.equal(s.entries()[0].dirty, false);
    // Back to the default: the field goes, as the backend leaves it out.
    select().onChange({ target: { value: "" } });
    s.render(); s.entries()[0].save(); s.render();
    assert.equal("silence_duration_ms" in s.writes()[1][1], false);
    await s.acknowledge(s.writes()[1][1]);
    assert.equal(s.entries()[0].dirty, false);
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
    assert.equal(s.entries()[0].dirty, false);
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
