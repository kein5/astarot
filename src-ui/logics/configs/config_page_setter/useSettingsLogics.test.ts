import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { fieldOf, hooks, loadModule, unchecked } from "../../test/hookHarness.ts";
import { settingAtom } from "../../test/bridgeHarness.ts";
import { loadSettingsList } from "../../test/settingsHarness.ts";
import type { SentRequest, SettingsList } from "../../test/settingsHarness.ts";
import * as utils from "../../utils.ts";
import { ctranslate2_weight_type_status } from "../../ui_configs.ts";
import type { SaveButtonLogicOptions, SettingLogicsEntry, SliderLogicOptions } from "./useSettingsLogics.ts";
import type { SaveBarEntry } from "../../voice/saveBar.ts";
import type { StdoutResult } from "../../common/useStdoutToPython.ts";
import * as fieldErrors from "../fieldErrors.ts";

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
    let saveNotices = 0;
    const { useSaveButtonLogic } = await loadModule<typeof import("./useSettingsLogics.ts")>(new URL("./useSettingsLogics.ts", import.meta.url), runtime, { "../fieldErrors.ts": fieldErrors,
        "@store": {}, "@logics_common": { useNotificationStatus: () => ({ showNotification_SaveSuccess: () => { saveNotices += 1; } }) }, "@utils": {},
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
    return { props, requests, render, get entry() { return entry; }, get saveNotices() { return saveNotices; } };
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
        assert.equal(s.saveNotices, 0);
        const retry = s.entry?.save();
        assert.equal(s.requests[1].value, "attempted");
        s.props.variable = "canonical"; s.render();
        s.requests[1].resolve({ status: 200, result: "canonical" }); await retry;
        assert.equal(s.render().variable, "canonical");
        assert.equal(s.entry?.saveState, "saved");
        assert.equal(s.saveNotices, 1);
    });
}

// #1111: a field that saves by itself is out of the save bar, sends only a changed value that its
// check accepts, says a refused value or a failed save under it, and shows no "saved" notice.
test("a field that saves by itself checks a changed value before sending it and shows no saved notice", async context => {
    const s = await setup(context);
    s.props.autoSave = true;
    s.props.validate = value => value.trim() ? null : "empty";
    s.render();
    assert.equal(s.entry, null);
    await s.render().saveFunction();
    assert.equal(s.requests.length, 0, "an unchanged value has nothing to save");
    s.render().onChangeFunction("  ");
    await s.render().saveFunction();
    assert.equal(s.requests.length, 0, "a refused value is not sent");
    assert.equal(s.render().error, "empty");
    s.render().onChangeFunction("new");
    assert.equal(s.render().error, null, "editing takes the problem away");
    const saving = s.render().saveFunction();
    assert.equal(s.requests[0].value, "new");
    s.props.variable = "new";
    s.requests[0].resolve({ status: 200, result: "new" }); await saving;
    assert.equal(s.render().variable, "new");
    assert.equal(s.render().error, null);
    assert.equal(s.saveNotices, 0);
    assert.equal(s.entry, null);
});

test("a field that saves by itself says a failed save under it and keeps the value until it is put back", async context => {
    const s = await setup(context);
    s.props.autoSave = true;
    s.render();
    s.render().onChangeFunction("attempted");
    const saving = s.render().saveFunction();
    s.requests[0].resolve({ status: 400, result: { data: "old" } }); await saving;
    assert.equal(s.render().variable, "attempted");
    assert.equal(s.render().error, "config_page.auto_save.save_failed");
    s.render().revert();
    assert.equal(s.render().variable, "old");
    assert.equal(s.render().error, null);
    assert.equal(s.entry, null);
});

// #1111, decided 2: an API key that saves by itself is kept when its field is left empty, and
// deleted only by Enter on the empty field.
test("a key left empty is put back, and only Enter on the empty field deletes it", async context => {
    const s = await setup(context);
    let deletes = 0;
    s.props.autoSave = true;
    s.props.deleteFunction = async () => { deletes += 1; return unchecked<StdoutResult>({ status: 200, result: "" }); };
    s.render();
    s.render().onChangeFunction("");
    await s.render().leaveFunction?.();
    assert.equal(s.render().variable, "old", "leaving the empty field keeps the saved key");
    assert.equal(deletes, 0);
    assert.equal(s.requests.length, 0);
    s.render().onChangeFunction("");
    await s.render().saveFunction();
    assert.equal(deletes, 1, "Enter on the empty field deletes the key");
});

// A refusal of the field's own save is said under it in its code's words (fieldErrors.ts).
test("a field that saves by itself waits for its own answer and says a coded refusal in that code's words", async context => {
    const fieldErrors = await import("../fieldErrors.ts");
    const s = await setup(context);
    s.props.autoSave = true;
    s.props.endpoint = "/set/data/openai_auth_key";
    s.render();
    s.render().onChangeFunction("sk-bad");
    const saving = s.render().saveFunction();
    s.requests[0].resolve({ status: 400, result: { error_code: "AUTH_OPENAI_FAILED", data: "old" } }); await saving;
    assert.equal(fieldErrors.takeInlineRefusal("/set/data/openai_auth_key"), true, "the refusal is the field's to say");
    assert.deepEqual(s.render().error, ["backend_errors.AUTH_OPENAI_FAILED", "config_page.auto_save.save_failed"]);
    s.render().onChangeFunction("sk-good");
    const accepted = s.render().saveFunction();
    s.props.variable = "sk-good";
    s.requests[1].resolve({ status: 200, result: "sk-good" }); await accepted;
    assert.equal(fieldErrors.takeInlineRefusal("/set/data/openai_auth_key"), false, "an accepted save leaves no refusal to take");
});

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
    const { useSliderLogic } = await loadModule<typeof import("./useSettingsLogics.ts")>(new URL("./useSettingsLogics.ts", import.meta.url), runtime, { "../fieldErrors.ts": fieldErrors,
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

// --- The functions made for a setting, by its template --------------------------------------

// useSettingsLogics with a store of the test's own: each named setting's store hook gives what the
// test put there, and a setting that is not named has no store hook.
async function loadTemplates(stores: Record<string, Record<string, unknown>>) {
    const runtime = hooks(), sent: SentRequest[] = [];
    const logics = await loadModule<typeof import("./useSettingsLogics.ts")>(new URL("./useSettingsLogics.ts", import.meta.url), runtime, { "../fieldErrors.ts": fieldErrors,
        "@store": { getStoreHook: (name: string) => name in stores ? () => stores[name] : undefined },
        "@utils": utils, "@logics_common": { useNotificationStatus: () => ({ showNotification_SaveSuccess: () => {} }) },
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (...request: SentRequest) => { sent.push(request); return true; } }) },
        "../../voice/saveBar": {},
    });
    const settings = (list: readonly SettingLogicsEntry[], category = "Test") => runtime.render(() => logics.useSettingsLogics(list, category)).settings;
    return { sent, settings, logics, runtime };
}
// A store hook's fields for a setting named name: its value, and the updates and waits it records.
const storeOf = (name: string, data: unknown = null) => {
    const updates: unknown[] = [], waits: string[] = [];
    return { updates, waits, fields: { [`current${name}`]: { state: "ok", data },
        [`update${name}`]: (value: unknown) => updates.push(value), [`pending${name}`]: () => waits.push(name) } };
};
const run = (settings: Record<string, unknown>, name: string, ...args: unknown[]): unknown => {
    const fn = settings[name];
    assert.equal(typeof fn, "function", name);
    return typeof fn === "function" ? fn(...args) : undefined;
};

test("a listed setting (get_list) can be read and not written", async () => {
    const things = storeOf("Things", []);
    const t = await loadTemplates({ Things: things.fields });
    const settings = t.settings([{ Category: "Test", Base_Name: "Things", logics_template_id: "get_list", base_endpoint_name: "things" }]);
    await run(settings, "getThings");
    assert.deepEqual(t.sent, [["/get/data/things"]]);
    assert.deepEqual(things.waits, ["Things"]);
    for (const name of ["setThings", "setSuccessThings", "toggleThings", "deleteThings"]) assert.equal(settings[name], undefined, name);
    run(settings, "updateFromBackendThings", ["a"]);
    assert.deepEqual(things.updates, [["a"]]);
});

test("a setting the UI sends to the backend on its own gets a run function, and the others do not", async () => {
    const sent = storeOf("Sent"), received = storeOf("Received");
    const t = await loadTemplates({ Sent: sent.fields, Received: received.fields });
    const settings = t.settings([
        { Category: "Test", Base_Name: "Sent", logics_template_id: "get_only", base_endpoint_name: "sent", add_endpoint_run_array: ["to_backend"] },
        { Category: "Test", Base_Name: "Received", logics_template_id: "get_only", base_endpoint_name: "received", add_endpoint_run_array: ["from_backend"] },
    ]);
    run(settings, "runSuccessSent");
    assert.deepEqual(t.sent, [["/run/sent"]]);
    assert.equal(settings.runSuccessReceived, undefined);
    assert.deepEqual(sent.waits, [], "a run request does not wait for an answer");
});

test("only the settings of the category asked for are made, and one without a store atom is left out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = storeOf("Kept"), other = storeOf("Other");
    const t = await loadTemplates({ Kept: kept.fields, Other: other.fields });
    const settings = t.settings([
        { Category: "Test", Base_Name: "Missing", logics_template_id: "get_set", base_endpoint_name: "missing" },
        { Category: "Test", Base_Name: "Kept", logics_template_id: "get_set", base_endpoint_name: "kept" },
        { Category: "Elsewhere", Base_Name: "Other", logics_template_id: "get_set", base_endpoint_name: "other" },
    ]);
    assert.deepEqual(Object.keys(settings).sort(), ["currentKept", "getKept", "setKept", "setSuccessKept", "updateFromBackendKept", "updateKept"]);
});

test("a store without update or pending functions takes no answers, and the weights' changes stop there", async () => {
    // Fields that are not functions, given on purpose.
    const t = await loadTemplates({ Bare: { currentBare: { state: "ok", data: 1 }, updateBare: "update", pendingBare: true },
        Weights: { currentWeights: { state: "ok", data: [] }, updateWeights: {} } });
    const settings = t.settings([
        { Category: "Test", Base_Name: "Bare", logics_template_id: "get_set", base_endpoint_name: "bare" },
        { Category: "Test", Base_Name: "Weights", logics_template_id: "weight_download_status", base_endpoint_name: "weights" },
    ]);
    await run(settings, "getBare");
    await run(settings, "setBare", 2);
    run(settings, "setSuccessBare", 2);
    run(settings, "updateFromBackendBare", 3);
    assert.deepEqual(t.sent, [["/get/data/bare"], ["/set/data/bare", 2]]);
    for (const [name, value] of [["pendingWeights", "w"], ["downloadedWeights", "w"], ["updateDownloadedWeights", {}], ["updateDownloadProgressWeights", { weight_type: "w", progress: 1 }]] as const) {
        assert.throws(() => run(settings, name, value), { name: "TypeError", message: "[useSettingsLogics] updateWeights is not a function" }, name);
    }
});

test("a list answer becomes id and label pairs, and a transform the logic does not know stops with its name", async () => {
    const pairs = storeOf("Pairs"), odd = storeOf("Odd");
    const t = await loadTemplates({ Pairs: pairs.fields, Odd: odd.fields });
    const settings = t.settings([
        { Category: "Test", Base_Name: "Pairs", logics_template_id: "get_only", base_endpoint_name: "pairs", response_transform: "arrayToIdLabel" },
        // A transform name the type does not allow, given on purpose.
        { Category: "Test", Base_Name: "Odd", logics_template_id: "get_only", base_endpoint_name: "odd", response_transform: unchecked<SettingLogicsEntry["response_transform"]>("toSomething") },
    ]);
    run(settings, "updateFromBackendPairs", ["a", 2, null]);
    assert.deepEqual(pairs.updates, [[{ id: "a", label: "a" }, { id: 2, label: 2 }, { id: null, label: null }]]);
    assert.throws(() => run(settings, "updateFromBackendPairs", "a"), { name: "TypeError", message: "[transformResponse] arrayToIdLabel expects a list." });
    assert.throws(() => run(settings, "updateFromBackendOdd", []),
        { name: "Error", message: "[transformResponse] Unknown transform name: \"toSomething\". Please add it to the switch in useSettingsLogics.ts." });
});

test("a switch whose value is not a record of the store reads as off", async () => {
    // A value of the wrong shape, given on purpose: a function that has a data field.
    const odd = Object.assign(() => {}, { data: true });
    const t = await loadTemplates({ Flag: { currentFlag: odd, updateFlag: () => {} } });
    const settings = t.settings([{ Category: "Test", Base_Name: "Flag", logics_template_id: "toggle_enable_disable", base_endpoint_name: "flag" }]);
    run(settings, "toggleFlag");
    assert.deepEqual(t.sent, [["/set/enable/flag"]]);
});

test("a setting of a template the logic does not know gets only its value and its updates", async () => {
    const odd = storeOf("Odd");
    const t = await loadTemplates({ Odd: odd.fields });
    // A template the type does not allow, given on purpose.
    const settings = t.settings([{ Category: "Test", Base_Name: "Odd", logics_template_id: unchecked<SettingLogicsEntry["logics_template_id"]>("custom"), base_endpoint_name: "odd" }]);
    assert.deepEqual(Object.keys(settings).sort(), ["currentOdd", "updateFromBackendOdd", "updateOdd"]);
});

test("only the VR settings have functions of their own", async () => {
    const t = await loadTemplates({});
    const functions = (category: string) => t.runtime.render(() => t.logics.useConfigFunctions(category));
    assert.deepEqual(Object.keys(functions("Vr")), ["sendTextToOverlay"]);
    for (const category of ["Device", "Translation", "vr", ""]) assert.deepEqual(functions(category), {}, category);
});

// --- The translation weights' list (weight_download_status) ----------------------------------

const WEIGHTS = "CTranslate2WeightTypeStatus";
const weightsOf = (s: SettingsList) => s.runtime.store.get(settingAtom(s.stores.dynamicStoreRegistry, `Atom_${WEIGHTS}`)).data;
const weights = async () => {
    const s = await loadSettingsList();
    const send = (name: string, ...args: unknown[]) => {
        const fn = fieldOf(s.category("Translation"), `${name}${WEIGHTS}`);
        assert.equal(typeof fn, "function", name);
        if (typeof fn === "function") fn(...args);
    };
    const item = (id: string): unknown => {
        const list = weightsOf(s);
        return Array.isArray(list) ? list.find((entry: unknown) => fieldOf(entry, "id") === id) : undefined;
    };
    return { s, send, item, ids: ctranslate2_weight_type_status.map(entry => entry.id) };
};

test("a weight asked for waits, takes its progress in percent, and is ready once the backend says it is downloaded", async () => {
    const w = await weights();
    const [first, second, third] = w.ids;
    w.send("pending", first);
    assert.deepEqual(w.item(first), { ...ctranslate2_weight_type_status[0], is_pending: true, job_id: null });
    assert.deepEqual(w.item(second), ctranslate2_weight_type_status[1], "the others do not wait");
    w.send("updateDownloadProgress", { weight_type: first, job_id: "job-1", progress: 0.25 });
    w.send("updateDownloadProgress", { weight_type: second, job_id: "job-2", progress: 0.5 });
    assert.deepEqual(w.item(first), { ...ctranslate2_weight_type_status[0], is_pending: true, job_id: "job-1", progress: 25 });
    assert.deepEqual(w.item(second), ctranslate2_weight_type_status[1], "a weight that was not asked for takes no progress");
    w.send("downloaded", { weight_type: first, downloaded: false });
    w.send("downloaded", null);
    assert.equal(fieldOf(w.item(first), "is_pending"), true, "a download that failed leaves the weight waiting for its notice");
    w.send("downloaded", { weight_type: first, downloaded: true });
    assert.deepEqual(w.item(first), { ...ctranslate2_weight_type_status[0], is_pending: false, job_id: "job-1", progress: null, is_downloaded: true });
    w.send("downloaded", third);
    assert.deepEqual(w.item(third), { ...ctranslate2_weight_type_status[2], is_pending: false, progress: null, is_downloaded: true });
    w.s.sent.length = 0;
    w.send("download", { weight_type: second, consent: true });
    assert.deepEqual(w.s.sent, [["/run/download_ctranslate2_weight", { weight_type: second, consent: true }]]);
});

test("the backend's list of downloaded weights marks the built-in ones and lists the user's own after them", async () => {
    const w = await weights();
    const [first, second] = w.ids;
    // Test data: a value that is not a boolean, given on purpose.
    w.send("updateDownloaded", unchecked<Record<string, boolean>>({ [first]: true, "user:mine": true, "user:other": "yes", unknown: true }));
    assert.equal(fieldOf(w.item(first), "is_downloaded"), true);
    assert.equal(fieldOf(w.item(second), "is_downloaded"), false, "a weight the list does not name keeps what it had");
    const list = weightsOf(w.s);
    assert.deepEqual(Array.isArray(list) ? list.slice(w.ids.length) : null,
        [{ id: "user:mine", is_custom: true, is_downloaded: true }, { id: "user:other", is_custom: true, is_downloaded: false }]);
    w.send("updateDownloaded", { [second]: true, "user:new": true, "user:other": true, "user:mine": false });
    const next = weightsOf(w.s);
    assert.deepEqual(Array.isArray(next) ? next.map(entry => [fieldOf(entry, "id"), fieldOf(entry, "is_downloaded")]) : null,
        [[first, true], [second, true], ...w.ids.slice(2).map(id => [id, false]), ["user:mine", false], ["user:other", true], ["user:new", true]],
        "the user's models keep their places, and a new one comes after them");
    w.send("updateDownloaded", { "user:other": true });
    const last = weightsOf(w.s);
    assert.deepEqual(Array.isArray(last) ? last.map(entry => fieldOf(entry, "id")) : null, [...w.ids, "user:other"],
        "the user's models the backend no longer lists leave");
});

// --- Sliders ----------------------------------------------------------------------------------

async function slider(context: TestContext, props: Partial<SliderLogicOptions> = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), writes: number[] = [];
    context.onTestFinished(() => runtime.unmount());
    const { useSliderLogic } = await loadModule<typeof import("./useSettingsLogics.ts")>(new URL("./useSettingsLogics.ts", import.meta.url), runtime, { "../fieldErrors.ts": fieldErrors,
        "@store": {}, "@logics_common": {}, "@utils": {}, "../../voice/saveBar": {},
    });
    const options: SliderLogicOptions = { variable: 0, state: "ok", min: 0, max: 1, setterFunction: (value: number) => { writes.push(value); }, ...props };
    return { options, writes, runtime, render: () => runtime.render(useSliderLogic, options) };
}
const marksOf = async (context: TestContext, props: Partial<SliderLogicOptions>) => (await slider(context, props)).render().marks;

test("a slider has marks only when it is given a step or values to label", async context => {
    assert.equal(await marksOf(context, {}), null);
    assert.deepEqual(await marksOf(context, { show_label_values: [] }), []);
    assert.deepEqual(await marksOf(context, { marks_step: 0 }), []);
    assert.deepEqual(await marksOf(context, { marks_step: -0.5, show_label_values: [0.5] }), [{ value: 0.5, label: "0.5" }]);
});

test("a step marks the scale from min to max, labelled where asked, without the sums' rounding errors", async context => {
    assert.deepEqual(await marksOf(context, { marks_step: 0.25, show_label_values: [0, 1] }),
        [{ value: 0, label: "0" }, { value: 0.25, label: "" }, { value: 0.5, label: "" }, { value: 0.75, label: "" }, { value: 1, label: "1" }]);
    // 0.1 added three times is 0.30000000000000004: the mark is 0.3, and it is not past max.
    assert.deepEqual(await marksOf(context, { min: 0, max: 0.3, marks_step: 0.1 }),
        [0, 0.1, 0.2, 0.3].map(value => ({ value, label: "" })));
    assert.deepEqual(await marksOf(context, { min: -1, max: 2000, marks_step: 500, show_label_values: [999] }),
        [{ value: -1, label: "" }, { value: 499, label: "" }, { value: 999, label: "999" }, { value: 1499, label: "" }, { value: 1999, label: "" }]);
    // A scale longer than a thousand steps stops at the thousandth.
    const long = await marksOf(context, { min: 0, max: 5000, marks_step: 1 });
    assert.equal(long?.length, 1001);
    assert.deepEqual(long?.at(-1), { value: 1000, label: "" });
});

test("values to label are marks of their own, in order, when they are on the scale", async context => {
    assert.deepEqual(await marksOf(context, { min: -1, max: 1, show_label_values: [0.5, 1, -1, 2, -1.5, 0] }),
        [-1, 0, 0.5, 1].map(value => ({ value, label: `${value}` })));
});

test("marks follow a change of the scale", async context => {
    const s = await slider(context, { marks_step: 1, max: 2 });
    assert.deepEqual(s.render().marks?.map(mark => mark.value), [0, 1, 2]);
    s.options.max = 3;
    assert.deepEqual(s.render().marks?.map(mark => mark.value), [0, 1, 2, 3]);
    s.options.min = 1;
    assert.deepEqual(s.render().marks?.map(mark => mark.value), [1, 2, 3]);
    s.options.marks_step = 2;
    assert.deepEqual(s.render().marks?.map(mark => mark.value), [1, 3]);
    s.options.show_label_values = [2];
    assert.deepEqual(s.render().marks?.map(mark => mark.label), ["", "2", ""]);
});

test("by default a slider moves freely and saves when let go; a refused save puts it back", async context => {
    const s = await slider(context, { variable: 0.2 });
    const first = s.render();
    assert.equal(first.ui_value, 0.2);
    first.onChangeFunction?.(0.4);
    assert.deepEqual([s.render().ui_value, s.writes], [0.4, []]);
    vi.advanceTimersByTime(1000);
    assert.deepEqual(s.writes, [], "moving alone saves nothing");
    s.render().onChangeCommittedFunction?.(0.6);
    assert.deepEqual(s.writes, [0.6]);
    s.options.setterFunction = async () => false;
    s.render().onChangeFunction?.(0.8);
    s.render().onChangeCommittedFunction?.(0.8);
    assert.equal(s.render().ui_value, 0.8);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(s.render().ui_value, 0.2, "a save that was not sent puts the slider back to the saved value");
    s.options.setterFunction = () => true;
    s.render().onChangeFunction?.(0.9);
    s.render().onChangeCommittedFunction?.(0.9);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(s.render().ui_value, 0.9);
});

test("a slider that saves while it moves waits for a pause, sends the last value, and goes back when refused", async context => {
    const s = await slider(context, { setter_timing: "on_change", variable: 1, max: 10 });
    assert.equal(s.render().onChangeCommittedFunction, null);
    s.render().onChangeFunction?.(2);
    vi.advanceTimersByTime(150);
    s.render().onChangeFunction?.(3);
    vi.advanceTimersByTime(199);
    assert.deepEqual([s.writes, s.render().ui_value], [[], 3]);
    vi.advanceTimersByTime(1);
    assert.deepEqual(s.writes, [3]);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(s.render().ui_value, 3, "a save that was sent leaves the slider where it is");
    s.options.debounce_ms = 50;
    s.render().onChangeFunction?.(4);
    vi.advanceTimersByTime(50);
    assert.deepEqual(s.writes, [3, 4]);
    s.options.setterFunction = async () => false;
    s.render().onChangeFunction?.(5);
    vi.advanceTimersByTime(50);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(s.render().ui_value, 1, "a refused save puts the slider back to the saved value");
});

test("a slider uses the setter it was last given", async context => {
    const later: number[] = [];
    const moving = await slider(context, { setter_timing: "on_change", debounce_ms: 10 });
    moving.render();
    moving.options.setterFunction = (value: number) => { later.push(value); };
    moving.render().onChangeFunction?.(0.5);
    vi.advanceTimersByTime(10);
    const released = await slider(context, {});
    released.render();
    released.options.setterFunction = (value: number) => { later.push(-value); };
    released.render().onChangeCommittedFunction?.(0.5);
    assert.deepEqual([moving.writes, released.writes, later], [[], [], [0.5, -0.5]]);
});

test("a slider left before its pause saves nothing", async context => {
    const s = await slider(context, { setter_timing: "on_change" });
    s.render().onChangeFunction?.(0.5);
    s.runtime.unmount();
    vi.advanceTimersByTime(1000);
    assert.deepEqual(s.writes, []);
});

test("a slider with an unknown timing has no handlers", async context => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A timing the type does not allow, given on purpose.
    const s = await slider(context, { setter_timing: unchecked<SliderLogicOptions["setter_timing"]>("on_release") });
    const drawn = s.render();
    assert.deepEqual([drawn.onChangeFunction, drawn.onChangeCommittedFunction], [undefined, undefined]);
});

test("the slider follows the saved value, except while the setting waits, and then runs the follow-up", async context => {
    const followUps: number[] = [];
    const s = await slider(context, { variable: 0.1, postUpdateAction: () => { followUps.push(s.options.variable); } });
    s.render();
    assert.deepEqual(followUps, [0.1]);
    s.render().onChangeFunction?.(0.5);
    s.options.state = "pending";
    s.options.variable = 0.3;
    s.render();
    assert.deepEqual([s.render().ui_value, followUps], [0.5, [0.1]], "while the setting waits the slider stays where the user put it");
    s.options.state = "ok";
    s.render();
    assert.deepEqual([s.render().ui_value, followUps], [0.3, [0.1, 0.3]]);
    s.render();
    assert.deepEqual(followUps, [0.1, 0.3], "nothing runs again while nothing changed");
    s.options.variable = 0.3;
    s.render().onChangeFunction?.(0.7);
    s.options.state = "error";
    s.render();
    assert.deepEqual([s.render().ui_value, followUps], [0.3, [0.1, 0.3, 0.3]], "a new state brings the saved value back too");
});

// --- Text fields saved from the bar ------------------------------------------------------------

async function field(context: TestContext, props: Partial<SaveButtonLogicOptions> = {}) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), requests: PendingSave[] = [], deletes: number[] = [];
    let entry: SaveBarEntry | null | undefined, saveNotices = 0;
    context.onTestFinished(() => runtime.unmount());
    const { useSaveButtonLogic } = await loadModule<typeof import("./useSettingsLogics.ts")>(new URL("./useSettingsLogics.ts", import.meta.url), runtime, { "../fieldErrors.ts": fieldErrors,
        "@store": {}, "@utils": {},
        "@logics_common": { useNotificationStatus: () => ({ showNotification_SaveSuccess: () => { saveNotices += 1; } }) },
        "../../voice/saveBar": { setSaveBarEntry: (_id: string, value: SaveBarEntry | null) => { entry = value; } },
    });
    const options: SaveButtonLogicOptions = { variable: "old", state: "ok", label: "Field",
        // Test data: the answers carry only the fields the save reads (no endpoint).
        setFunction: value => new Promise<StdoutResult>(resolve => requests.push({ value, resolve: answer => resolve(unchecked<StdoutResult>(answer)) })),
        ...props };
    return { options, requests, deletes, runtime, render: () => runtime.render(useSaveButtonLogic, options),
        get entry() { return entry; }, get saveNotices() { return saveNotices; } };
}

test("an edit shows in the bar under the field's label, and a field without a label lists no change", async context => {
    const f = await field(context);
    f.render();
    assert.deepEqual([f.entry?.saveState, f.entry?.dirty, f.entry?.changes, f.entry?.canSave], ["saved", false, [], true]);
    f.render().onChangeFunction("new");
    f.render();
    assert.deepEqual([f.entry?.saveState, f.entry?.dirty, f.entry?.edited, f.entry?.changes], ["unsaved", true, true, ["Field"]]);
    f.options.label = undefined;
    f.render();
    assert.deepEqual(f.entry?.changes, []);
});

test("while its setting waits, the field cannot be saved", async context => {
    const f = await field(context, { state: "pending" });
    f.render().onChangeFunction("new");
    assert.equal(f.render().variable, "new");
    assert.equal(f.entry?.canSave, false);
    assert.equal(await f.render().saveFunction(), undefined);
    assert.deepEqual(f.requests, []);
    f.options.state = "ok";
    f.render();
    assert.equal(f.entry?.canSave, true);
});

test("a second save while one is on its way sends nothing", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    const saving = f.render().saveFunction();
    f.render();
    assert.equal(await f.render().saveFunction(), undefined);
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve({ status: 200, result: "new" });
    await saving;
});

test("an emptied field deletes the value where it can, and saves it empty where it cannot", async context => {
    for (const empty of ["", null]) {
        const f = await field(context, { deleteFunction: async () => { f.deletes.push(1); return unchecked<StdoutResult>({ status: 200, result: "" }); } });
        f.render().onChangeFunction(empty);
        await f.render().saveFunction();
        assert.deepEqual([f.deletes, f.requests.length], [[1], 0], JSON.stringify(empty));
        const plain = await field(context);
        plain.render().onChangeFunction(empty);
        void plain.render().saveFunction();
        assert.deepEqual(plain.requests.map(request => request.value), [""], JSON.stringify(empty));
    }
    const typed = await field(context, { deleteFunction: async () => false });
    typed.render().onChangeFunction(" ");
    void typed.render().saveFunction();
    assert.deepEqual(typed.requests.map(request => request.value), [" "], "a field with text is saved, not deleted");
});

test("a save waits for an answer with a status, and gives up after five seconds", async context => {
    for (const answer of [true, null, {}, { result: "x" }]) {
        const f = await field(context);
        f.render().onChangeFunction("new");
        const saving = f.render().saveFunction();
        f.render();
        f.requests[0].resolve(answer);
        assert.deepEqual(await saving, answer);
        f.render();
        assert.equal(f.entry?.saveState, "saving", JSON.stringify(answer));
        vi.advanceTimersByTime(4999); f.render();
        assert.equal(f.entry?.saveState, "saving");
        vi.advanceTimersByTime(1); f.render();
        assert.equal(f.entry?.saveState, "save_failed");
    }
});

test("only a save on its way can time out", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    f.render();
    vi.advanceTimersByTime(6000); f.render();
    assert.equal(f.entry?.saveState, "unsaved");
    const saving = f.render().saveFunction();
    f.render();
    f.requests[0].resolve({ status: 200, result: "new" });
    await saving;
    f.options.variable = "new";
    f.render();
    vi.advanceTimersByTime(6000); f.render();
    assert.equal(f.entry?.saveState, "saved", "an answered save does not time out later");
});

test("a save that failed stays failed until the field is edited; edited back, it is saved again", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    const saving = f.render().saveFunction();
    f.render();
    f.requests[0].resolve({ status: 400 });
    await saving;
    f.render();
    assert.deepEqual([f.entry?.saveState, f.entry?.dirty], ["save_failed", true]);
    f.render().onChangeFunction("old");
    f.render();
    assert.deepEqual([f.entry?.saveState, f.entry?.dirty], ["saved", false]);
});

test("while a save is on its way, edits keep it saving and the field counts as edited", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    const saving = f.render().saveFunction();
    f.options.variable = "new";
    f.render();
    assert.deepEqual([f.entry?.saveState, f.entry?.dirty], ["saving", true], "the backend's value is not the answer to the save");
    f.render().onChangeFunction("newer");
    f.render();
    assert.equal(f.entry?.saveState, "saving");
    f.requests[0].resolve({ status: 200, result: "new" });
    await saving;
    assert.equal(f.render().variable, "newer");
});

test("a save that fails after a newer save began leaves the newer one alone", async context => {
    const f = await field(context);
    f.render().onChangeFunction("first");
    let fail: (reason: Error) => void = () => {};
    f.options.setFunction = () => new Promise<StdoutResult>((_, reject) => { fail = reject; });
    const first = f.render().saveFunction();
    f.render();
    vi.advanceTimersByTime(5000); f.render();
    f.options.setFunction = value => new Promise<StdoutResult>(resolve => f.requests.push({ value, resolve: answer => resolve(unchecked<StdoutResult>(answer)) }));
    const second = f.render().saveFunction();
    f.render();
    fail(new Error("late"));
    assert.equal(await first, false);
    f.render();
    assert.equal(f.entry?.saveState, "saving");
    f.requests[0].resolve({ status: 200, result: "first" });
    await second;
    f.options.variable = "first";
    f.render();
    assert.equal(f.entry?.saveState, "saved");
});

test("an untouched field follows the saved value, and an edited one keeps the edit", async context => {
    const f = await field(context);
    f.render();
    f.options.variable = "from backend";
    f.render();
    assert.equal(f.render().variable, "from backend");
    f.render().onChangeFunction("mine");
    f.options.variable = "again";
    f.render();
    assert.equal(f.render().variable, "mine");
});

test("an empty field and a value not yet known read the same", async context => {
    for (const [variable, typed] of [[null, ""], ["", null], [undefined, ""]]) {
        const f = await field(context, { variable });
        f.render().onChangeFunction(typed);
        f.render();
        assert.deepEqual([f.entry?.saveState, f.entry?.dirty], ["saved", false], `${String(variable)} and ${JSON.stringify(typed)}`);
    }
});

test("a field that goes away takes its line off the bar", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    f.render();
    assert.equal(f.entry?.dirty, true);
    f.runtime.unmount();
    assert.equal(f.entry, null);
});

test("a save that throws is a failed save, and the next edit starts over", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    f.options.setFunction = async () => { throw new Error("transport"); };
    assert.equal(await f.render().saveFunction(), false);
    f.render();
    assert.deepEqual([f.entry?.saveState, f.render().variable], ["save_failed", "new"]);
    f.render().onChangeFunction("newer");
    f.render();
    assert.equal(f.entry?.saveState, "unsaved");
});

test("while a save is on its way, the field keeps what the user typed, also when it is the old value", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    void f.render().saveFunction();
    f.render().onChangeFunction("old");
    f.options.variable = "fresh";
    f.render();
    assert.equal(f.render().variable, "old");
});

test("a failed save keeps its line on the bar even when the backend's value comes to match the field", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    const saving = f.render().saveFunction();
    f.render();
    f.requests[0].resolve({ status: 500 });
    await saving;
    f.options.variable = "new";
    f.render();
    assert.deepEqual([f.entry?.saveState, f.entry?.dirty, f.entry?.changes], ["save_failed", true, ["Field"]]);
});

// --- Text fields that save by themselves (#1111) -----------------------------------------------

const SAVE_FAILED = "config_page.auto_save.save_failed";

test("a field saved from the bar says nothing under it when its save fails, and says it was saved when it succeeds", async context => {
    const f = await field(context);
    f.render().onChangeFunction("new");
    const failing = f.render().saveFunction();
    f.requests[0].resolve({ status: 400 });
    await failing;
    assert.deepEqual([f.render().error, f.entry?.saveState, f.saveNotices], [null, "save_failed", 0]);
    const saving = f.render().saveFunction();
    f.requests[1].resolve({ status: 200, result: "new" });
    await saving;
    assert.equal(f.saveNotices, 1);
});

test("Enter on a field saved from the bar sends its value even when it has not changed", async context => {
    const f = await field(context, { validate: () => "refused" });
    void f.render().saveFunction();
    assert.deepEqual(f.requests.map(request => request.value), ["old"], "only a field that saves by itself checks first");
});

test("a field that saves by itself says under it when a save throws or times out", async context => {
    const thrown = await field(context, { autoSave: true, setFunction: async () => { throw new Error("transport"); } });
    thrown.render().onChangeFunction("new");
    assert.equal(await thrown.render().saveFunction(), false);
    assert.equal(thrown.render().error, SAVE_FAILED);
    const slow = await field(context, { autoSave: true });
    slow.render().onChangeFunction("new");
    void slow.render().saveFunction();
    slow.render();
    vi.advanceTimersByTime(4999);
    assert.equal(slow.render().error, null);
    vi.advanceTimersByTime(1);
    slow.render();
    assert.equal(slow.render().error, SAVE_FAILED);
    assert.equal(slow.saveNotices + thrown.saveNotices, 0);
});

test("a field that saves by itself sends nothing while its setting waits or while a save is on its way", async context => {
    const waiting = await field(context, { autoSave: true, state: "pending" });
    waiting.render().onChangeFunction("new");
    assert.equal(await waiting.render().saveFunction(), undefined);
    assert.deepEqual(waiting.requests, []);
    const busy = await field(context, { autoSave: true });
    busy.render().onChangeFunction("new");
    void busy.render().saveFunction();
    busy.render().onChangeFunction("newer");
    assert.equal(await busy.render().saveFunction(), undefined);
    assert.deepEqual(busy.requests.map(request => request.value), ["new"]);
});

test("a refused value's note goes when the saved value comes to match the field", async context => {
    const f = await field(context, { autoSave: true, validate: value => value === "bad" ? "not that" : null });
    f.render().onChangeFunction("bad");
    await f.render().saveFunction();
    assert.equal(f.render().error, "not that");
    f.options.variable = "bad";
    f.render();
    await f.render().saveFunction();
    assert.deepEqual([f.render().error, f.requests.length], [null, 0]);
});

test("a field that saves by itself checks an emptied value as empty text", async context => {
    const checked: string[] = [];
    const f = await field(context, { autoSave: true, validate: value => { checked.push(value); return "empty"; } });
    f.render().onChangeFunction(null);
    await f.render().saveFunction();
    f.render().onChangeFunction(undefined);
    await f.render().saveFunction();
    assert.deepEqual(checked, ["", ""]);
});

test("putting a field that saves by itself back to its saved value while a save is on its way still lets that save time out", async context => {
    const f = await field(context, { autoSave: true });
    f.render().onChangeFunction("new");
    void f.render().saveFunction();
    f.render().onChangeFunction("old");
    assert.equal(await f.render().saveFunction(), undefined);
    f.render();
    vi.advanceTimersByTime(5000);
    f.render();
    assert.equal(f.render().error, SAVE_FAILED);
});

test("while its setting waits, a field that saves by itself keeps the note on a refused value", async context => {
    const f = await field(context, { autoSave: true, validate: value => value === "bad" ? "not that" : null });
    f.render().onChangeFunction("bad");
    await f.render().saveFunction();
    f.options.state = "pending";
    f.options.variable = "bad";
    f.render();
    await f.render().saveFunction();
    assert.equal(f.render().error, "not that");
});
