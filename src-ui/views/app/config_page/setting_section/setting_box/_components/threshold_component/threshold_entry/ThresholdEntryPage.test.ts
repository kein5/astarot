import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { componentOf, hooks, loadModule, treeNode } from "../../../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../../../logics/test/hookHarness.ts";

// The field of a volume threshold (ThresholdEntry.tsx): what it shows, what typing in it sends
// after a pause, and what leaving it or pressing Enter saves. The entry it draws is a stand-in that
// keeps its props.

type Props = Record<string, unknown>;

async function thresholdEntry(context: TestContext, given: Props = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ui: unknown[] = [], saved: unknown[] = [], loading = hooks(), runtime = hooks();
    let active: HookRuntime = loading;
    context.onTestFinished(() => runtime.unmount());
    const react = new Proxy(loading.api, { get: (_, key) => Reflect.get(active.api, key) });
    const module = await loadModule<typeof import("./ThresholdEntry.tsx")>(new URL("./ThresholdEntry.tsx", import.meta.url), { ...loading, api: react }, {
        "../../_atoms/_entry/_Entry": { _Entry: "entry" },
    });
    let props: Props = { min: 0, max: 2000, ui_threshold: 300, setUiThresholdFunction: (value: unknown) => { ui.push(value); },
        setThresholdFunction: (value: unknown) => { saved.push(value); }, "aria-label": "Mic threshold", ...given };
    // The field the entry draws, drawn with the props the test gives (kept for the next drawing).
    const draw = (next: Props = {}): TreeNode => {
        props = { ...props, ...next };
        active = runtime;
        const input = runtime.render(componentOf(module.ThresholdEntry({ ...props, setThresholdFunction: props.setThresholdFunction as (value: string) => void })), props);
        const node = treeNode(input);
        assert.ok(node);
        return node;
    };
    const field = () => draw().props;
    // New props, then the field as the effects leave it.
    const redraw = (next: Props) => { draw(next); return draw(); };
    const type = (value: string) => { field().onChange({ currentTarget: { value } }); return field(); };
    return { ui, saved, draw, redraw, field, type, runtime };
}

test("the field shows the threshold, labelled and narrow, numeric, and can be turned off", async context => {
    const e = await thresholdEntry(context, { "aria-describedby": "why" });
    const shown = e.field();
    assert.deepEqual([shown["aria-label"], shown["aria-describedby"], shown.width, shown.type, shown.inputMode, shown.ui_variable, shown.is_disabled],
        ["Mic threshold", "why", "6rem", "text", "numeric", 300, undefined]);
    assert.equal(e.draw({ is_disable: true }).props.is_disabled, true, "set automatically");
    assert.equal(e.draw({ is_disable: false, is_disabled: true }).props.is_disabled, true, "or turned off by the page");
    const empty = await thresholdEntry(context, { ui_threshold: null });
    assert.equal(empty.field().ui_variable, "");
});

test("the field follows the saved threshold, except while it is pending or set automatically", async context => {
    const e = await thresholdEntry(context, { confirmedThreshold: { state: "ok", data: 300 } });
    e.draw();
    assert.equal(e.redraw({ confirmedThreshold: { state: "ok", data: 450 } }).props.ui_variable, 450);
    assert.equal(e.redraw({ confirmedThreshold: { state: "pending", data: 600 } }).props.ui_variable, 450);
    assert.equal(e.redraw({ confirmedThreshold: { state: "ok", data: 700 }, is_disable: true }).props.ui_variable, 450);
    assert.equal(e.redraw({ is_disable: false }).props.ui_variable, 700);
    // The value the field goes back to after an empty entry is the saved one.
    e.type("");
    e.field().onBlur();
    assert.equal(e.field().ui_variable, 700);
});

test("the field follows the value the slider sets, unless the user is typing in it", async context => {
    const e = await thresholdEntry(context);
    e.draw();
    assert.equal(e.redraw({ ui_threshold: 500 }).props.ui_variable, 500);
    e.field().onFocus();
    e.type("12");
    assert.equal(e.redraw({ ui_threshold: 900 }).props.ui_variable, "12", "what the user types stays");
    // Leaving with nothing typed goes back to the last value the slider set.
    e.type("");
    e.field().onBlur();
    assert.equal(e.field().ui_variable, 900);
    assert.equal(e.ui.at(-1), 900);
    // An empty value from the page is shown as empty and is not what an empty entry goes back to.
    e.redraw({ ui_threshold: "" });
    assert.equal(e.field().ui_variable, "");
    e.type("");
    e.field().onBlur();
    assert.equal(e.field().ui_variable, 900);
    e.redraw({ ui_threshold: null });
    e.type("");
    e.field().onBlur();
    assert.equal(e.field().ui_variable, 900);
});

test("typing digits moves the slider at once and saves a second after the last key, kept within the limits", async context => {
    const e = await thresholdEntry(context, { min: 100 });
    e.draw();
    assert.equal(e.type("4").ui_variable, "4");
    assert.deepEqual(e.ui.at(-1), 100, "below the lower limit the slider stops at it");
    assert.equal(e.type("45").ui_variable, "45");
    assert.deepEqual(e.type("450").ui_variable, "450");
    assert.equal(e.ui.at(-1), 450);
    vi.advanceTimersByTime(999);
    assert.deepEqual(e.saved, [], "not before a second without a key");
    vi.advanceTimersByTime(1);
    assert.deepEqual(e.saved, ["450"]);
    e.type("50");
    vi.advanceTimersByTime(1000);
    assert.deepEqual(e.saved.at(-1), "100", "saved at the lower limit");
    // Letters and signs are not typed at all.
    assert.equal(e.type("4a").ui_variable, "50");
    assert.equal(e.type("-1").ui_variable, "50");
    // An empty field waits for the user to leave it.
    e.type("");
    vi.advanceTimersByTime(2000);
    assert.equal(e.saved.length, 2);
});

test("a value above the upper limit moves the slider to it but waits to be confirmed before it is saved", async context => {
    const e = await thresholdEntry(context, { max: 2000 });
    e.draw();
    e.type("2500");
    assert.equal(e.ui.at(-1), 2000);
    vi.advanceTimersByTime(5000);
    assert.deepEqual(e.saved, []);
    e.field().onEnterPressed();
    assert.deepEqual([e.saved, e.field().ui_variable], [["2000"], "2000"]);
    // A key before the second is up starts the second again, and leaving the field saves at once.
    e.type("15");
    vi.advanceTimersByTime(600);
    e.type("150");
    vi.advanceTimersByTime(600);
    assert.deepEqual(e.saved, ["2000"]);
    e.field().onBlur();
    assert.deepEqual(e.saved, ["2000", "150"]);
    vi.advanceTimersByTime(2000);
    assert.deepEqual(e.saved, ["2000", "150"], "the timer that was waiting is dropped");
});

test("leaving or Enter saves the value within the limits; text that is not a number goes back to the last value saved", async context => {
    const e = await thresholdEntry(context, { min: 10, max: 100, ui_threshold: 50 });
    e.draw();
    e.type("5");
    e.field().onBlur();
    assert.deepEqual([e.saved.at(-1), e.ui.at(-1), e.field().ui_variable], ["10", "10", "10"]);
    // The automatic threshold's words in the field are not a number: they stay, and nothing is saved.
    e.redraw({ ui_threshold: "Automatic" });
    e.field().onFocus();
    e.field().onBlur();
    assert.deepEqual([e.field().ui_variable, e.ui.at(-1), e.saved.length], ["Automatic", "Automatic", 1]);
    // Enter does nothing while the threshold is set automatically or the field is off.
    e.redraw({ ui_threshold: 60 });
    e.type("70");
    e.draw({ is_disable: true }).props.onEnterPressed();
    e.draw({ is_disable: false, is_disabled: true }).props.onEnterPressed();
    assert.equal(e.saved.length, 1);
    e.draw({ is_disabled: false }).props.onEnterPressed();
    assert.deepEqual(e.saved.at(-1), "70");
    // Closed while waiting, nothing is saved later.
    e.type("80");
    e.runtime.unmount();
    vi.advanceTimersByTime(2000);
    assert.equal(e.saved.at(-1), "70");
});

test("without limits any number is saved as typed, and the slider is not told without its setter", async context => {
    const e = await thresholdEntry(context, { min: undefined, max: undefined, setUiThresholdFunction: undefined });
    e.draw();
    e.type("99999");
    vi.advanceTimersByTime(1000);
    e.type("0");
    e.field().onBlur();
    e.type("");
    e.field().onBlur();
    assert.deepEqual([e.saved, e.ui, e.field().ui_variable], [["99999", "0"], [], "0"]);
});

test("before the page has a value the field is empty and goes back to empty, and a value given then is kept", async context => {
    const e = await thresholdEntry(context, { ui_threshold: undefined });
    assert.equal(e.field().ui_variable, "");
    e.field().onBlur();
    assert.deepEqual([e.field().ui_variable, e.ui.at(-1), e.saved], ["", "", []]);
    assert.equal(e.redraw({ ui_threshold: 400 }).props.ui_variable, 400);
    e.redraw({ ui_threshold: undefined });
    assert.equal(e.field().ui_variable, "", "the page's value went: an empty field");
    e.type("");
    e.field().onBlur();
    assert.equal(e.field().ui_variable, 400, "an empty entry goes back to the last value, not to none");
});

test("words in the field go back to the value the page set while the user was in it", async context => {
    const e = await thresholdEntry(context, { ui_threshold: "Automatic" });
    e.draw();
    e.field().onFocus();
    e.redraw({ ui_threshold: 500 });
    assert.equal(e.field().ui_variable, "Automatic", "kept while the user is in the field");
    e.field().onBlur();
    assert.deepEqual([e.field().ui_variable, e.ui.at(-1), e.saved], [500, 500, []]);
});

test("the upper limit itself is saved after the pause, like every value within the limits", async context => {
    const e = await thresholdEntry(context, { max: 2000 });
    e.draw();
    e.type("2000");
    vi.advanceTimersByTime(1000);
    assert.deepEqual(e.saved, ["2000"]);
});
