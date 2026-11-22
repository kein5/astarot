import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, unchecked } from "../../test/hookHarness.ts";
import type { SaveButtonLogicOptions, SliderLogicOptions } from "./useSettingsLogics.ts";
import type { SaveBarEntry } from "../../voice/saveBar.ts";
import type { StdoutResult } from "../../common/useStdoutToPython.ts";

// A save the test answers later, with the value it was asked to save.
interface PendingSave {
    value: unknown;
    resolve: (answer: unknown) => void;
}

async function setup(context: TestContext) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), requests: PendingSave[] = [];
    context.onTestFinished(() => runtime.unmount());
    let entry: SaveBarEntry | null | undefined;
    const { useSaveButtonLogic } = await loadModule<typeof import("./useSettingsLogics.ts")>(new URL("./useSettingsLogics.ts", import.meta.url), runtime, {
        "@store": {}, "@logics_common": {}, "@utils": {},
        "../../voice/saveBar": { setSaveBarEntry: (_id: string, value: SaveBarEntry | null) => { entry = value; } },
    });
    const props: SaveButtonLogicOptions = { variable: "old", state: "ok", label: "Field",
        // Test data: the answers carry only the fields the save reads (no endpoint).
        setFunction: value => new Promise<StdoutResult>(resolve => requests.push({ value, resolve: answer => resolve(unchecked<StdoutResult>(answer)) })) };
    const render = () => {
        runtime.render(useSaveButtonLogic, props);
        return runtime.render(useSaveButtonLogic, props);
    };
    render();
    return { props, requests, render, get entry() { return entry; } };
}

for (const result of [false, { status: 400, result: { data: "old" } }]) {
    test(`text save retains its draft and reports failure on ${JSON.stringify(result)}`, async context => {
        const s = await setup(context);
        s.render().onChangeFunction("attempted");
        const saving = s.render().saveFunction();
        s.props.state = "pending"; s.render();
        s.props.state = "ok"; s.render();
        s.requests[0].resolve(result); await saving;
        assert.equal(s.render().variable, "attempted");
        assert.equal(s.entry?.saveState, "save_failed");
        assert.equal(s.entry?.edited, true);
        const retry = s.entry?.save();
        assert.equal(s.requests[1].value, "attempted");
        s.props.variable = "canonical"; s.render();
        s.requests[1].resolve({ status: 200, result: "canonical" }); await retry;
        assert.equal(s.render().variable, "canonical");
        assert.equal(s.entry?.saveState, "saved");
    });
}

test("batched transport failure and thrown saves preserve text until explicit discard", async context => {
    const s = await setup(context);
    s.render().onChangeFunction("draft");
    s.props.setFunction = async () => false;
    await s.render().saveFunction();
    assert.equal(s.render().variable, "draft");
    assert.equal(s.entry?.saveState, "save_failed");
    s.props.setFunction = async () => { throw new Error("transport"); };
    await s.render().saveFunction();
    assert.equal(s.render().variable, "draft");
    s.entry?.discard();
    assert.equal(s.render().variable, "old");
    assert.equal(s.entry?.saveState, "saved");
});

test("text saves await their own response, preserve later edits and ignore discarded responses", async context => {
    const s = await setup(context);
    s.render().onChangeFunction("first");
    const saving = s.render().saveFunction(); s.render();
    s.props.variable = "first"; s.render(); // A GET is not an acknowledgement.
    assert.equal(s.entry?.saveState, "saving");
    vi.advanceTimersByTime(5000); s.render();
    assert.equal(s.entry?.saveState, "save_failed");
    s.render().onChangeFunction("newer"); s.render();
    s.requests[0].resolve({ status: 200, result: "first" }); await saving;
    assert.equal(s.render().variable, "newer");
    const second = s.entry?.save(); s.render();
    s.entry?.discard(); s.render().onChangeFunction("latest"); s.render();
    s.requests[1].resolve({ status: 400 }); await second;
    assert.equal(s.render().variable, "latest");
    assert.equal(s.entry?.saveState, "unsaved");
});

test("VR sliders can hand edits to the parent debounce synchronously", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const writes: number[] = [], runtime = hooks();
    const props: SliderLogicOptions = { variable: 0, min: 0, max: 1, setter_timing: "on_change", debounce_ms: 0,
        setterFunction: value => writes.push(value) };
    const { useSliderLogic } = await loadModule<typeof import("./useSettingsLogics.ts")>(new URL("./useSettingsLogics.ts", import.meta.url), runtime, {
        "@store": {}, "@logics_common": {}, "@utils": {}, "../../voice/saveBar": {},
    });
    // Set for both timings; a missing one fails on the assertion below, as the TypeError did.
    runtime.render(useSliderLogic, props).onChangeFunction?.(0.1);
    assert.deepEqual(writes, [0.1]);
    runtime.unmount();
});

test("text acknowledgement preserves an edit back to the old value in a batched render", async context => {
    const s = await setup(context);
    s.render().onChangeFunction("attempted");
    const saving = s.render().saveFunction(); s.render();
    s.render().onChangeFunction("old"); s.render();
    s.props.variable = "canonical";
    s.requests[0].resolve({ status: 200, result: "canonical" }); await saving;
    assert.equal(s.render().variable, "old");
    assert.equal(s.entry?.saveState, "unsaved");
});
