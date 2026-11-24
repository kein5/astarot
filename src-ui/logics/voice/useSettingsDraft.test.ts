import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, stubGlobals, eventTarget, fieldOf, unchecked } from "../test/hookHarness.ts";
import { rebaseDraft } from "./draftRebase.ts";
import type { DraftWrite, SettingsDraft } from "./useSettingsDraft.tsx";
import type { StdoutResult } from "../common/useStdoutToPython.ts";

// The form the tests edit: a vocabulary and a model.
interface Vocabulary {
    vocabulary: { terms: string[] };
    model: string;
}
interface Request {
    value: Vocabulary;
    resolve: (response: unknown) => void;
}

// A whole form as the tests write it.
const isVocabulary = (value: unknown): value is Vocabulary =>
    Array.isArray(fieldOf(value, "vocabulary", "terms")) && typeof fieldOf(value, "model") === "string";
// The form's draft; a form without one fails here, as reading a field of it would.
const draftOf = (form: SettingsDraft<Vocabulary>) => {
    assert.ok(form.draft);
    return form.draft;
};

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function setup(context: TestContext, savedFromResponse?: (result: unknown) => Vocabulary) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const runtime = hooks(), requests: Request[] = [];
    context.onTestFinished(() => runtime.unmount());
    stubGlobals(context, { window: eventTarget() });
    const state: { saved: Vocabulary; error: string | null } = { saved: { vocabulary: { terms: [] }, model: "old" }, error: null };
    const { useSettingsDraft } = await loadModule<typeof import("./useSettingsDraft.tsx")>(new URL("./useSettingsDraft.tsx", import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, "./saveBar": { changedPaths: () => [], setSaveBarEntry() {} },
    });
    // Without patch the form writes its whole draft.
    const write: DraftWrite<Vocabulary> = value => {
        assert.ok(isVocabulary(value), "the form writes its whole draft");
        // Test data: the tests answer with only what the draft reads of an answer (status and
        // result), or with false.
        return new Promise<StdoutResult>(resolve => requests.push({ value, resolve: response => resolve(unchecked<StdoutResult>(response)) }));
    };
    const updateError = (value: string | null) => { state.error = value; };
    const render = () => {
        runtime.render(() => useSettingsDraft(state.saved, state.error, updateError, { write, savedFromResponse }));
        return runtime.render(() => useSettingsDraft(state.saved, state.error, updateError, { write, savedFromResponse }));
    };
    const edit = () => { render().setDraft({ ...state.saved, vocabulary: { terms: ["VRChat = ブイアールチャット"] } }); render(); };
    const reply = async (index: number, value: Vocabulary) => {
        state.saved = value;
        render();
        requests[index].resolve({ status: 200, result: value });
        await flush();
        return render();
    };
    render();
    return { state, requests, render, edit, reply, write };
}

test("a successful write adopts canonical vocabulary and clears saving without a timeout", async context => {
    const s = await setup(context);
    s.edit(); s.render().submit(s.write); s.render();
    const canonical = { ...s.state.saved, vocabulary: { terms: ["VRChat=ブイアールチャット"] } };
    const form = await s.reply(0, canonical);
    assert.deepEqual(form.draft, canonical);
    assert.equal(form.dirty, false);
    assert.equal(form.saving, false);
    vi.advanceTimersByTime(5000);
    assert.equal(s.render().saveState, "saved");
});

test("a late owned acknowledgement clears uncertainty but discard revokes ownership", async context => {
    const s = await setup(context);
    s.edit(); s.render().submit(s.write); s.render();
    vi.advanceTimersByTime(5000); s.render();
    const canonical = { ...s.state.saved, vocabulary: { terms: ["VRChat=ブイアールチャット"] } };
    assert.equal((await s.reply(0, canonical)).saveState, "saved");
    s.edit(); s.render().submit(s.write); s.render();
    s.render().discard(); s.render();
    s.render().setDraft({ ...draftOf(s.render()), model: "newer" }); s.render();
    assert.equal(draftOf(await s.reply(1, canonical)).model, "newer");
    assert.equal(s.render().saveState, "unsaved");
});

test("direct-voice responses acknowledge their nested settings without adopting runtime state", async context => {
    // The reply's settings, which this test sends as the form's value.
    const s = await setup(context, value => {
        const settings = fieldOf(value, "settings");
        assert.ok(isVocabulary(settings), "the reply carries the form's settings");
        return settings;
    });
    s.edit(); s.render().submit(s.write); s.render();
    const canonical = { ...s.state.saved, vocabulary: { terms: ["VRChat=ブイアールチャット"] } };
    s.state.saved = canonical;
    s.requests[0].resolve({ status: 200, result: { requested: false, generation: 3, settings: canonical } });
    await flush();
    assert.deepEqual(s.render().draft, canonical);
    assert.equal(s.render().saveState, "saved");
});

test("canonical acknowledgement preserves edits made after submission", async context => {
    const s = await setup(context);
    s.edit(); s.render().submit(s.write);
    s.render().setDraft({ ...draftOf(s.render()), model: "newer" }); s.render();
    const canonical = { ...s.state.saved, vocabulary: { terms: ["VRChat=ブイアールチャット"] } };
    const form = await s.reply(0, canonical);
    assert.deepEqual(form.draft, { ...canonical, model: "newer" });
    assert.equal(form.dirty, true);
    assert.equal(form.saving, false);
});

test("editing back to the old saved value while saving survives the response atom update", async context => {
    const s = await setup(context);
    s.edit(); s.render().submit(s.write); s.render();
    s.render().setDraft({ ...draftOf(s.render()), vocabulary: { terms: [] } }); s.render();
    const canonical = { ...s.state.saved, vocabulary: { terms: ["VRChat=ブイアールチャット"] } };
    const form = await s.reply(0, canonical);
    assert.deepEqual(draftOf(form).vocabulary.terms, []);
    assert.equal(form.dirty, true);
    assert.equal(form.saving, false);
});

test("an identical GET cannot acknowledge a write and an older response cannot confirm its retry", async context => {
    const s = await setup(context);
    s.edit(); s.render().submit(s.write); s.render();
    s.state.saved = structuredClone(s.requests[0].value); s.render();
    assert.equal(s.render().saving, true);
    vi.advanceTimersByTime(5000); s.render();
    assert.equal(s.state.error, "save_unconfirmed");
    s.state.error = null; s.render();
    assert.equal(s.render().saveState, "save_failed", "a refresh clearing the feature error still cannot confirm delivery");
    assert.equal(s.render().dirty, true);
    s.render().setDraft({ ...draftOf(s.render()), model: "newer" }); s.render();
    s.render().submit(s.write); s.render();
    await s.reply(0, s.requests[0].value);
    assert.equal(s.render().saving, true);
    await s.reply(1, s.requests[1].value);
    assert.equal(s.render().saveState, "saved");
});

test("another request's failure on the page neither marks an unedited form failed nor ends a save (#458)", async context => {
    const s = await setup(context);
    s.state.error = "voice_request_failed";
    assert.equal(s.render().saveState, "saved", "a failed mute is not a failed save");
    s.state.error = null;
    s.edit(); s.render().submit(s.write); s.render();
    s.state.error = "voice_request_failed"; s.render();
    assert.equal(s.render().saving, true, "the save stays in progress until its own reply");
    assert.equal(s.render().saveState, "saving");
    const canonical = { ...s.state.saved, vocabulary: { terms: ["VRChat=ブイアールチャット"] } };
    assert.equal((await s.reply(0, canonical)).saveState, "saved");
});

test("a write that throws stays failed until the next save or discard", async context => {
    const s = await setup(context);
    s.edit();
    await s.render().submit(() => Promise.reject(new Error("closed")));
    assert.equal(s.state.error, "save_unconfirmed");
    s.state.error = null;
    assert.equal(s.render().saveState, "save_failed");
    s.render().discard();
    assert.equal(s.render().saveState, "saved");
});

for (const response of [false, { status: 400 }]) test(`a rejected draft remains failed even after an identical refresh: ${JSON.stringify(response)}`, async context => {
    const s = await setup(context);
    s.edit();
    const saving = s.render().submit(s.write); s.render();
    s.state.saved = structuredClone(s.requests[0].value);
    s.state.error = "specific_backend_error";
    s.render();
    s.requests[0].resolve(response); await saving;
    assert.equal(s.render().dirty, true);
    assert.equal(s.render().saveState, "save_failed");
    assert.equal(s.state.error, "specific_backend_error");
    s.state.error = null;
    assert.equal(s.render().saveState, "save_failed");
    s.render().discard();
    assert.equal(s.render().saveState, "saved");
});

// #1111: a group that saves by itself is saved by its page when focus leaves it, so it is not in the
// save bar, and leaving the page with an edit drops it without asking (decided 4).
for (const autoSave of [false, true]) test(`a draft ${autoSave ? "that saves by itself is not in the save bar and does not guard leaving" : "saved from the bar is in it and guards leaving"}`, async context => {
    const runtime = hooks(), window = eventTarget(), entries: string[] = [];
    context.onTestFinished(() => runtime.unmount());
    stubGlobals(context, { window });
    const { useSettingsDraft } = await loadModule<typeof import("./useSettingsDraft.tsx")>(new URL("./useSettingsDraft.tsx", import.meta.url), runtime, {
        "./draftRebase": { rebaseDraft }, "./saveBar": { changedPaths: () => [["model"]], setSaveBarEntry: (id: string) => { entries.push(id); } },
    });
    const saved: Vocabulary = { vocabulary: { terms: [] }, model: "old" };
    const write: DraftWrite<Vocabulary> = () => new Promise<StdoutResult>(() => {});
    const render = () => runtime.render(() => useSettingsDraft(saved, null, () => {}, { write, autoSave }));
    render();
    render().setDraft({ ...saved, model: "new" });
    assert.equal(render().dirty, true);
    const guards = window.added.filter(([type]) => type === "vrct:settings-leave" || type === "beforeunload");
    assert.equal(guards.length > 0, !autoSave);
    assert.equal(entries.length > 0, !autoSave);
});
