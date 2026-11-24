import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import type { ReactNode } from "react";
import { hooks, loadModule, find, findIn, componentName, draw as drawElement, fieldOf, stubGlobals, eventTarget } from "../../../../../../logics/test/hookHarness.ts";
import { rebaseDraft } from "../../../../../../logics/voice/draftRebase.ts";
import { changedPaths } from "../../../../../../logics/voice/saveBar.ts";
import type { SaveBarEntry } from "../../../../../../logics/voice/saveBar.ts";
import type { StdoutResult } from "../../../../../../logics/common/useStdoutToPython.ts";

const draftPath = "../../../../../../logics/voice/useSettingsDraft.tsx";
const importsPath = "../../../../../../../logics/voice/useSettingsDraft";
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

interface SentRequest {
    value: unknown;
    resolve: (result: StdoutResult) => void;
}

async function setup(context: TestContext, kind: "word" | "message") {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), requests: SentRequest[] = [], window = eventTarget();
    context.onTestFinished(() => runtime.unmount());
    stubGlobals(context, { window, document: { body: {} }, requestAnimationFrame: (fn: () => void) => fn() });
    let entry: SaveBarEntry | null | undefined;
    const { useSettingsDraft } = await loadModule<typeof import("../../../../../../logics/voice/useSettingsDraft.tsx")>(new URL(draftPath, import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, "./saveBar": { changedPaths, setSaveBarEntry: (_id: string, value: SaveBarEntry | null) => { entry = value; } },
    });
    const defaults = { message: { prefix: "", suffix: "" }, translation: { prefix: "(", suffix: ")", separator: "/" }, separator: " ", translation_first: false };
    // The saved value of the form under test: the word list, or the message format.
    const words = { state: "ok", data: ["old"] };
    const format = { state: "ok", data: structuredClone(defaults) };
    const saved: { state: string; data: unknown } = kind === "word" ? words : format;
    const send = (value: unknown) => new Promise<StdoutResult>(resolve => { saved.state = "pending"; requests.push({ value, resolve }); });
    const Entry = () => null;
    const common = { [importsPath]: { useSettingsDraft }, "../_atoms/_entry/_Entry": { _Entry: Entry }, "../fold/Fold": { Fold: "fold" } };
    let draw: () => ReactNode;
    if (kind === "word") {
        const state = { currentMicWordFilterList: saved, setMicWordFilterList: send,
            updateMicWordFilterList: (fn: (current: typeof saved) => unknown) => { saved.data = fn(saved); saved.state = "ok"; } };
        const { WordFilter } = await loadModule<typeof import("./word_filter/WordFilter.tsx")>(new URL("./word_filter/WordFilter.tsx", import.meta.url), runtime, {
            ...common, "@logics_configs": { useTranscription: () => state },
            "@store": { useStore_IsOpenedMicWordFilterList: () => ({ currentIsOpenedMicWordFilterList: { data: true }, updateIsOpenedMicWordFilterList() {} }) },
        });
        draw = () => runtime.render(WordFilter, {});
    } else {
        const { MessageFormat } = await loadModule<typeof import("./message_format/MessageFormat.tsx")>(new URL("./message_format/MessageFormat.tsx", import.meta.url), runtime, {
            ...common, "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
            "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
            "@logics_configs": {}, "@common_components": { ResetButton: "reset" },
            "@ui_configs": { ui_configs: { send_message_format_parts: defaults, received_message_format_parts: defaults } },
        });
        const props = { variable: format, setFunction: send, format_id: "send" as const, label: "Send format" };
        draw = () => runtime.render(MessageFormat, props);
    }
    const render = () => { draw(); return draw(); };
    // InputComponent is intentionally private; exercise the component rendered by the parent.
    const input = () => {
        const node = find(render(), node => componentName(node) === "InputComponent");
        // A function component of MessageFormat.tsx, drawn with the props its parent gave it.
        return node ? drawElement(node) : null;
    };
    const reject = async () => {
        saved.state = "ok";
        const last = requests.at(-1);
        assert.ok(last);
        last.resolve(false); await flush(); render();
    };
    render();
    return { render, input, Entry, requests, saved, defaults, reject, window,
        // The save bar's entry for the form: one that is missing fails the test where it is read.
        get entry() { assert.ok(entry); return entry; } };
}

test("word filter stages additions and deletions without changing confirmed data, and retains rejected edits", async context => {
    const s = await setup(context, "word");
    findIn(s.render(), node => node.type === s.Entry).props.onChange({ target: { value: "new" } });
    findIn(s.render(), node => node.type === s.Entry).props.onEnterPressed();
    s.render();
    assert.deepEqual(s.saved.data, ["old"]);
    assert.equal(s.requests.length, 0);
    assert.equal(s.entry.edited, true);
    const saving = s.entry.save(); s.render();
    assert.equal(s.saved.state, "pending");
    assert.deepEqual(s.requests[0].value, ["old", "new"]);
    await s.reject(); await saving;
    assert.equal(s.entry.saveState, "save_failed");
    assert.ok(find(s.render(), node => node.props?.value === "new"));
    s.entry.discard(); s.render();
    const row = findIn(s.render(), node => node.props?.value === "old");
    row.props.deleteAction("old", {}); s.render();
    const removal = s.entry.save(); s.render();
    assert.deepEqual(s.requests.at(-1)?.value, []);
    await s.reject(); await removal;
    assert.deepEqual(s.saved.data, ["old"]);
    assert.equal(s.entry.saveState, "save_failed");
});

for (const action of ["reset", "swap"]) test(`message format ${action} shares the draft and cannot be undone by a stale timer`, async context => {
    const s = await setup(context, "message");
    const prefix = () => findIn(s.input(), node => node.props?.["aria-label"]?.endsWith("before_original"));
    prefix().props.onChange({ target: { value: "draft" } }); s.render();
    assert.equal(s.entry.edited, true);
    assert.equal(s.requests.length, 0);
    const leave = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, detail: { proceed() {} } };
    s.window.dispatch("vrct:settings-leave", leave);
    assert.equal(leave.defaultPrevented, true);
    if (action === "reset") findIn(s.input(), node => node.type === "reset").props.onClickFunction();
    else findIn(s.input(), node => node.props?.className === "swap_button").props.onClick();
    s.render(); vi.advanceTimersByTime(600); s.render();
    assert.equal(s.requests.length, 0);
    assert.equal(prefix().props.ui_variable, action === "reset" ? "" : "draft");
    if (action === "reset") prefix().props.onChange({ target: { value: "retry" } });
    s.render();
    prefix().props.onEnterPressed(); s.render();
    assert.equal(s.requests.length, 1);
    assert.equal(fieldOf(s.requests[0].value, "translation_first"), action === "swap");
    await s.reject();
    assert.equal(s.entry.saveState, "save_failed");
    assert.equal(prefix().props.ui_variable, action === "reset" ? "retry" : "draft");
    s.entry.discard(); s.render();
    assert.equal(prefix().props.ui_variable, "");
});
