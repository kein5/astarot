import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import type { ReactNode } from "react";
import { hooks, loadModule, find, findIn, componentName, draw as drawElement, fieldOf, stubGlobals, eventTarget, unchecked } from "../../../../../../logics/test/hookHarness.ts";
import { rebaseDraft } from "../../../../../../logics/voice/draftRebase.ts";
import type { StdoutResult } from "../../../../../../logics/common/useStdoutToPython.ts";
import * as fieldErrors from "../../../../../../logics/configs/fieldErrors.ts";

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
    // The save bar is gone (#1111): nothing registers in it.
    const entry: unknown = undefined;
    const { useSettingsDraft } = await loadModule<typeof import("../../../../../../logics/voice/useSettingsDraft.tsx")>(new URL(draftPath, import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, 
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
        const { WordFilter } = await loadModule<typeof import("./word_filter/WordFilter.tsx")>(new URL("./word_filter/WordFilter.tsx", import.meta.url), runtime, { "../../../../../../../logics/configs/fieldErrors.ts": fieldErrors, "../field_problem/FieldProblem": { FieldProblem: "field-problem" },
            ...common, "@logics_configs": { useTranscription: () => state },
            "@store": { useStore_IsOpenedMicWordFilterList: () => ({ currentIsOpenedMicWordFilterList: { data: true }, updateIsOpenedMicWordFilterList() {} }) },
        });
        draw = () => runtime.render(WordFilter, {});
    } else {
        const { MessageFormat } = await loadModule<typeof import("./message_format/MessageFormat.tsx")>(new URL("./message_format/MessageFormat.tsx", import.meta.url), runtime, { "../../../../../../../logics/configs/fieldErrors.ts": fieldErrors, "../field_problem/FieldProblem": { FieldProblem: "field-problem" },
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
        // The save bar's entry for the form, which a form that saves by itself (#1111) does not have.
        get entry() { return entry; } };
}

// #1111, decided 3: a word added or taken out saves at once. A refused save puts the saved list
// back and says so under the field.
test("word filter saves each addition and deletion at once, and a refused save puts the saved list back", async context => {
    const s = await setup(context, "word");
    findIn(s.render(), node => node.type === s.Entry).props.onChange({ target: { value: "new" } });
    findIn(s.render(), node => node.type === s.Entry).props.onEnterPressed();
    s.render(); s.render();
    assert.equal(s.entry, undefined, "not in the save bar");
    assert.equal(s.saved.state, "pending");
    assert.deepEqual(s.requests.map(request => request.value), [["old", "new"]]);
    await s.reject(); s.render();
    assert.ok(!find(s.render(), node => node.props?.value === "new"), "the saved list is back");
    assert.ok(find(s.render(), node => node.type === "field-problem"), "and the refusal is said");
    const row = findIn(s.render(), node => node.props?.value === "old");
    row.props.deleteAction("old", {}); s.render(); s.render();
    assert.deepEqual(s.requests.at(-1)?.value, []);
    s.requests.at(-1)?.resolve(unchecked<StdoutResult>({ status: 200, result: [] })); s.saved.data = []; s.saved.state = "ok";
    await flush(); s.render();
    assert.ok(!find(s.render(), node => node.type === "field-problem"), "a save takes the problem away");
});

// #1111, decided 3: the format's texts save on Enter or when focus leaves the format, and the reset
// and the order at once, with the texts typed so far. Leaving the page asks nothing first, and
// Escape in a text puts the saved format back.
for (const action of ["reset", "swap"]) test(`message format ${action} saves at once with the draft, and Escape puts the saved format back`, async context => {
    const s = await setup(context, "message");
    const prefix = () => findIn(s.input(), node => node.props?.["aria-label"]?.endsWith("before_original"));
    const group = () => findIn(s.render(), node => node.props?.role === "group");
    // A saved format other than the default, so the reset changes it.
    s.saved.data = { ...s.defaults, separator: " | " }; s.render();
    prefix().props.onChange({ target: { value: "draft" } }); s.render();
    assert.equal(s.entry, undefined, "not in the save bar");
    assert.equal(s.requests.length, 0);
    const leave = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, detail: { proceed() {} } };
    s.window.dispatch("vrct:settings-leave", leave);
    assert.equal(leave.defaultPrevented, false, "leaving the page asks nothing first");
    if (action === "reset") findIn(s.input(), node => node.type === "reset").props.onClickFunction();
    else findIn(s.input(), node => node.props?.className === "swap_button").props.onClick();
    s.render(); s.render();
    assert.equal(s.requests.length, 1);
    assert.equal(fieldOf(s.requests[0].value, "translation_first"), action === "swap");
    assert.equal(fieldOf(s.requests[0].value, "message", "prefix"), action === "reset" ? "" : "draft");
    await s.reject();
    assert.equal(prefix().props.ui_variable, action === "reset" ? "" : "draft");
    assert.ok(find(s.render(), node => node.type === "field-problem"), "the refusal is said under the format");
    prefix().props.onChange({ target: { value: "retry" } }); s.render();
    group().props.onKeyDown({ key: "Escape", target: { tagName: "INPUT", type: "text" }, preventDefault() {} }); s.render();
    assert.equal(prefix().props.ui_variable, "");
    prefix().props.onChange({ target: { value: "typed" } }); s.render();
    prefix().props.onEnterPressed(); s.render();
    assert.equal(s.requests.length, 2);
    assert.equal(fieldOf(s.requests[1].value, "message", "prefix"), "typed");
});
