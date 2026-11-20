import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as captions from "./realtimeCaptionState.ts";
import { keepRecentLogs } from "../common/messageLogLimit.ts";

const owner = { generation: 4, requested: true, state: "ready", namespace: "session" };
const payload = { source: "mic", namespace: "session", generation: 4, item_id: "one", revision: 1, state: "partial", text: "hello" };

for (const source of ["mic", "speaker"]) {
    for (const [outcome, status, reason] of [["delivered", "ok", null], ["not_delivered", "not_sent", "expired"],
        ["not_delivered", "not_sent", "revoked"], ["not_delivered", "not_sent", "superseded"],
        ["not_delivered", "not_sent", "filtered"], ["failed", "failed", "processing_failed"]]) {
        test(`${source} recognized row stays pending until ${outcome}/${reason}`, () => {
            const event = { ...payload, source, state: "final" };
            const active = { [source]: owner };
            const final = captions.applyRealtimeCaption({ rows: [], retired: [] }, event, active);
            assert.equal(final.rows[0].status, "pending");
            const translated = captions.applyRealtimeCaption(final, { ...event, state: "translated", revision: 2,
                translations: [{ message: "訳", transliteration: [] }] }, active);
            assert.equal(translated.rows[0].status, "pending");
            // Terminal notifications remain useful after a stop or a new session.
            const result = { ...event, state: "outcome", text: undefined, revision: 3, outcome, reason };
            const settled = captions.applyRealtimeCaption(translated, result, {});
            assert.equal(settled.rows[0].status, status);
            assert.equal(settled.rows[0].category, source === "mic" ? "sent" : "received");
            assert.equal(settled.rows[0].created_at, final.rows[0].created_at);
            assert.equal(settled.rows[0].messages, translated.rows[0].messages);
            for (const later of [result, { ...result, revision: 100, outcome: "delivered" },
                { ...result, revision: 100, outcome: "failed" }, { ...event, revision: 100 },
                { ...event, revision: 100, state: "partial" }, { ...event, revision: 100, state: "translated" }]) {
                assert.equal(captions.applyRealtimeCaption(settled, later, active), settled);
            }
        });
    }
}

test("a speaker caption keeps the speakers its final names, through translation and the outcome", () => {
    const active = { speaker: owner }, event = { ...payload, source: "speaker" };
    const partial = captions.applyRealtimeCaption({ rows: [], retired: [] }, { ...event, speakers: [] }, active);
    assert.equal("speakers" in partial.rows[0], false);
    const final = captions.applyRealtimeCaption(partial, { ...event, revision: 2, state: "final", speakers: ["C", "B"] }, active);
    assert.deepEqual(final.rows[0].speakers, ["C", "B"]);
    // The translated row is built again from its payload; one without the list keeps what the final said.
    for (const speakers of [["C", "B"], undefined]) {
        const translated = captions.applyRealtimeCaption(final, { ...event, revision: 3, state: "translated", speakers,
            translations: [{ message: "訳", transliteration: [] }] }, active);
        assert.deepEqual(translated.rows[0].speakers, ["C", "B"]);
        const settled = captions.applyRealtimeCaption(translated, { ...event, text: undefined, revision: 4, state: "outcome", outcome: "delivered" }, {});
        assert.deepEqual(settled.rows[0].speakers, ["C", "B"]);
    }
});

test("speakers that are not short capital labels, or that come for the microphone, are left out", () => {
    const row = (source, speakers) => captions.applyRealtimeCaption({ rows: [], retired: [] },
        { ...payload, source, state: "final", speakers }, { [source]: owner }).rows[0];
    for (const speakers of ["A", [1], ["a"], [""], ["ABCD"], ["A", "B", "C", "D", "E"], [["A"]], null, {}]) {
        assert.equal("speakers" in row("speaker", speakers), false, JSON.stringify(speakers));
    }
    assert.equal("speakers" in row("mic", ["A"]), false);
    assert.deepEqual(row("speaker", ["A", "AB", "ABC"]).speakers, ["A", "AB", "ABC"]);
});

test("outcomes cannot create rows or settle another caption identity or a partial", () => {
    const empty = { rows: [], retired: [] };
    const event = { ...payload, state: "outcome", revision: 3, outcome: "delivered" };
    assert.equal(captions.applyRealtimeCaption(empty, event, { mic: owner }), empty);
    const partial = captions.applyRealtimeCaption(empty, payload, { mic: owner });
    assert.equal(captions.applyRealtimeCaption(partial, event, { mic: owner }), partial);
    const final = captions.applyRealtimeCaption(partial, { ...payload, revision: 2, state: "final" }, { mic: owner });
    for (const changes of [{ source: "speaker" }, { generation: 5 }, { namespace: "new" }, { item_id: "new" },
        { outcome: "unknown" }, { outcome: "toString" }, { revision: 2 }]) {
        assert.equal(captions.applyRealtimeCaption(final, { ...event, ...changes }, { mic: owner }), final);
    }
    const pruned = { rows: [], retired: [final.rows[0].id] };
    assert.equal(captions.applyRealtimeCaption(pruned, event, { mic: owner }), pruned);
});

test("equal realtime rows retain state; generations and namespaces still publish", () => {
    const state = { mic: owner, speaker: { ...owner, namespace: "speaker" } };
    assert.equal(captions.mergeRealtimeState(state, { mic: { ...owner } }), state);
    assert.equal(captions.mergeRealtimeState(state, { mic: { ...owner, namespace: null } }), state);
    const next = captions.mergeRealtimeState(state, { mic: { ...owner, generation: 5 } });
    assert.notEqual(next, state);
    assert.equal(next.speaker, state.speaker);
    assert.equal(captions.mergeRealtimeState(next, state), next);
    assert.notEqual(captions.mergeRealtimeState(state, { mic: { ...owner, namespace: "new" } }), state);
    assert.equal(captions.mergeRealtimeState(state, { mic: { ...owner, state: "starting" } }), state);
    for (const phase of ["stopping", "closed", "failed"]) {
        const stopped = captions.mergeRealtimeState(state, { mic: { ...owner, state: phase, requested: false } });
        assert.equal(captions.mergeRealtimeState(stopped, state), stopped);
    }
});

test("caption pruning retains unchanged lists and retires only stale partial captions", () => {
    const partial = captions.applyRealtimeCaption({ rows: [], retired: [] }, payload, { mic: owner });
    assert.equal(captions.pruneRealtimeCaptions(partial, { mic: owner }), partial);
    const final = captions.applyRealtimeCaption(partial, { ...payload, item_id: "final", state: "final" }, { mic: owner });
    const pruned = captions.pruneRealtimeCaptions(final, { mic: { ...owner, requested: false } });
    assert.equal(pruned.rows.length, 1);
    assert.equal(pruned.rows[0].realtime.state, "final");
    assert.deepEqual(pruned.retired, [partial.rows[0].id]);
    assert.equal(captions.pruneRealtimeCaptions(pruned, {}), pruned);
    assert.equal(captions.applyRealtimeCaption(pruned, { ...payload, revision: 2 }, { mic: owner }), pruned);
});

test("production realtime and message hooks preserve logs on polls and handle captions, stop and settings invalidation", async () => {
    const runtime = hooks(), Atom_MessageLogs = runtime.jotai.atom({ state: "ok", data: [] });
    const storeImports = {
        Atom_MessageLogs, store: {},
        useStore_MessageLogs: () => ({ currentMessageLogs: runtime.store.get(Atom_MessageLogs),
            updateMessageLogs(update) { runtime.store.set(Atom_MessageLogs, value => ({ ...value, data: update(value) })); } }),
        useStore_MessageInputValue: () => ({ currentMessageInputValue: { data: "" }, updateMessageInputValue() {} }),
    };
    const realtime = await loadModule(new URL("./useRealtimeASR.ts", import.meta.url), runtime, {
        "@store": storeImports, "./realtimeCaptionState": captions,
    });
    const { useMessage } = await loadModule(new URL("../common/useMessage.ts", import.meta.url), runtime, {
        "@store": storeImports, "../transcription/useRealtimeASR": realtime,
        "../transcription/realtimeCaptionState": captions, "./messageLogLimit": { keepRecentLogs },
    });
    const render = () => runtime.render(() => ({ asr: realtime.useRealtimeASR(), messages: useMessage() }));
    const logs = () => runtime.store.get(Atom_MessageLogs);
    let logChanges = 0;
    const unsubscribe = runtime.store.sub(Atom_MessageLogs, () => logChanges++);
    render().asr.updateState({ mic: { ...owner, state: "starting", namespace: null } });
    assert.equal(logChanges, 0);
    const starting = render().asr.state;
    render().messages.updateRealtimeCaption({ ...payload, namespace: "unknown", state: "outcome", outcome: "delivered" });
    assert.equal(render().asr.state, starting);
    assert.equal(logChanges, 0);
    // A caption can bind the namespace before the first ready poll arrives.
    render().messages.updateRealtimeCaption(payload);
    assert.equal(render().asr.state.mic.namespace, "session");
    assert.equal(logs().data.length, 1);
    const before = logs(), state = render().asr.state;
    render().asr.updateState({ mic: { ...owner, state: "starting", namespace: null } });
    assert.equal(render().asr.state, state);
    assert.equal(logs(), before);
    assert.equal(logChanges, 1);
    render().messages.updateRealtimeCaption({ ...payload, revision: 2, state: "final", text: "complete" });
    render().messages.failSentMessageLog({});
    assert.equal(logs().data[0].status, "pending");
    render().messages.updateRealtimeCaption({ ...payload, revision: 3, state: "translated", text: "complete", translations: [{ message: "translation" }] });
    assert.equal(logs().data[0].realtime.state, "translated");
    assert.equal(logs().data[0].status, "pending");
    render().messages.updateRealtimeCaption({ ...payload, item_id: "partial" });
    render().asr.updateState({ mic: { ...owner, state: "closed", requested: false } });
    assert.equal(logs().data.length, 1);
    render().messages.updateRealtimeCaption({ ...payload, revision: 4, state: "outcome", outcome: "not_delivered", reason: "revoked" });
    assert.equal(logs().data[0].status, "not_sent");
    const stoppedLogs = logs(), stopped = render().asr.state;
    render().asr.updateState({ mic: { ...owner } });
    render().messages.updateRealtimeCaption({ ...payload, item_id: "late" });
    assert.equal(render().asr.state, stopped);
    assert.equal(logs(), stoppedLogs);
    render().asr.updateState({ mic: { ...owner, generation: 5, namespace: "new" } });
    const newCaption = { ...payload, generation: 5, namespace: "new", item_id: "new" };
    render().messages.updateRealtimeCaption(newCaption);
    const settings = { server: "bundled", model: "first", mic: {}, speaker: {} };
    render().asr.updateSettings(settings);
    render().asr.updateSettings({ ...settings, model: "changed" });
    assert.equal(render().asr.state.mic.state, "stopping");
    assert.equal(logs().data.length, 1);
    // Even an equal poll must prune a partial added since the last state update.
    runtime.store.set(Atom_MessageLogs, { ...logs(), data: [...logs().data, { id: "stale", realtime: { ...newCaption } }] });
    const invalidated = render().asr.state;
    render().asr.updateState({ mic: { ...invalidated.mic } });
    assert.equal(render().asr.state, invalidated);
    assert.equal(logs().data.length, 1);
    assert.ok(runtime.store.get(realtime.realtimeRetiredAtom).includes("stale"));
    render().asr.updateState({ mic: { ...owner, generation: 6, namespace: "restart" } });
    render().messages.updateRealtimeCaption({ ...payload, generation: 6, namespace: "restart", state: "final" });
    render().messages.updateRealtimeCaption({ ...payload, generation: 6, namespace: "restart", item_id: "partial" });
    render().asr.backendStopped();
    assert.deepEqual(logs().data.map(row => row.status), ["not_sent", "failed"]);
    assert.equal(logs().data[1].realtime.reason, "backend_unavailable");
    const lostLogs = logs();
    render().messages.updateRealtimeCaption({ ...payload, generation: 6, namespace: "restart", revision: 3, state: "outcome", outcome: "delivered" });
    assert.equal(logs(), lostLogs);
    unsubscribe();
});

const empty = () => ({ rows: [], retired: [] });

test("a caption with a malformed identity is ignored; the limits themselves are accepted", () => {
    const start = empty();
    const ok = changes => captions.applyRealtimeCaption(start, { ...payload, ...changes },
        { mic: { ...owner, namespace: changes.namespace ?? owner.namespace, generation: changes.generation ?? owner.generation } });
    for (const changes of [{ namespace: "n".repeat(129) }, { item_id: "i".repeat(257) }, { namespace: 5 }, { item_id: 5 },
        { namespace: "" }, { item_id: "" }, { revision: 0 }, { revision: 1.5 }, { generation: -1 }, { source: "game" }, { state: "done" }]) {
        assert.equal(ok(changes), start, JSON.stringify(changes));
    }
    for (const changes of [{ namespace: "n".repeat(128) }, { item_id: "i".repeat(256) }, { generation: 0 }]) {
        assert.equal(ok(changes).rows.length, 1, JSON.stringify(changes));
    }
});

test("a caption shows only while its own session runs", () => {
    for (const active of [{ mic: { ...owner, generation: 5 } }, { mic: { ...owner, namespace: "other" } },
        { mic: { ...owner, requested: false } }, { speaker: owner }]) {
        const start = empty();
        assert.equal(captions.applyRealtimeCaption(start, payload, active), start, JSON.stringify(active));
    }
});

test("a new caption row reads its time as 24-hour hours and minutes, and its text as the original", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 18, 15, 4));
    const row = captions.applyRealtimeCaption(empty(), payload, { mic: owner }).rows[0];
    assert.equal(row.created_at, "15:04");
    assert.deepEqual(row.messages, { original: { message: "hello", transliteration: [] }, translations: [] });
    assert.deepEqual([row.category, row.source, row.status], ["sent", "realtime_mic", "pending"]);
});

test("a blank or discarded caption removes its row, and that caption never comes back", () => {
    const active = { mic: owner };
    const shown = captions.applyRealtimeCaption(empty(), payload, active);
    const other = captions.applyRealtimeCaption(shown, { ...payload, item_id: "two" }, active);
    const blank = captions.applyRealtimeCaption(other, { ...payload, revision: 2, text: "  " }, active);
    assert.deepEqual(blank.rows.map(row => row.realtime.item_id), ["two"]);
    const discarded = captions.applyRealtimeCaption(blank, { ...payload, item_id: "two", revision: 2, state: "discarded" }, active);
    assert.deepEqual(discarded.rows, []);
    assert.deepEqual(discarded.retired, [shown.rows[0].id, other.rows[1].id]);
    for (const item_id of ["one", "two"]) {
        assert.equal(captions.applyRealtimeCaption(discarded, { ...payload, item_id, revision: 9 }, active), discarded, item_id);
    }
});

test("only the latest 256 retired captions are remembered", () => {
    let log = empty();
    for (let i = 0; i < 257; i++) {
        log = captions.applyRealtimeCaption(log, { ...payload, item_id: `item${i}`, state: "discarded" }, { mic: owner });
    }
    assert.equal(log.retired.length, 256);
    assert.equal(log.retired[0], "realtime:mic:4:session:item1");
    assert.equal(log.retired.at(-1), "realtime:mic:4:session:item256");
});

test("a caption only moves forward: newer revisions, then final, then translated", () => {
    const active = { mic: owner };
    const partial = captions.applyRealtimeCaption(empty(), { ...payload, revision: 2 }, active);
    for (const revision of [1, 2]) {
        assert.equal(captions.applyRealtimeCaption(partial, { ...payload, revision, text: "late" }, active), partial, `revision ${revision}`);
    }
    const final = captions.applyRealtimeCaption(partial, { ...payload, revision: 3, state: "final", text: "hello there" }, active);
    assert.equal(final.rows[0].messages.original.message, "hello there");
    for (const state of ["partial", "final"]) {
        assert.equal(captions.applyRealtimeCaption(final, { ...payload, revision: 4, state }, active), final, state);
    }
    const translated = captions.applyRealtimeCaption(final, { ...payload, revision: 4, state: "translated", text: "hello there" }, active);
    assert.equal(translated.rows[0].realtime.state, "translated");
    assert.equal(captions.applyRealtimeCaption(translated, { ...payload, revision: 5, state: "translated" }, active), translated);
    // A recognized row that was settled before its translation stays settled.
    const settled = captions.applyRealtimeCaption(final, { ...payload, state: "outcome", revision: 4, outcome: "delivered" }, {});
    assert.equal(captions.applyRealtimeCaption(settled, { ...payload, revision: 5, state: "translated" }, active), settled);
});

test("settling one caption keeps the other rows", () => {
    const active = { mic: owner };
    const first = captions.applyRealtimeCaption(empty(), { ...payload, state: "final" }, active);
    const both = captions.applyRealtimeCaption(first, { ...payload, item_id: "two" }, active);
    const settled = captions.applyRealtimeCaption(both, { ...payload, state: "outcome", revision: 2, outcome: "failed" }, active);
    assert.deepEqual(settled.rows.map(row => [row.realtime.item_id, row.status]), [["one", "failed"], ["two", "pending"]]);
});

test("session states: both sources update together, negative generations are refused, and starting replaces any state but ready", () => {
    const state = { mic: owner, speaker: { ...owner, namespace: "speaker" } };
    const both = captions.mergeRealtimeState(state, { mic: { ...owner, generation: 5 }, speaker: { ...owner, generation: 6 } });
    assert.deepEqual([both.mic.generation, both.speaker.generation], [5, 6]);
    assert.equal(captions.mergeRealtimeState(state, { mic: { ...owner, generation: -1 } }), state);
    const none = {};
    assert.equal(captions.mergeRealtimeState(none, { mic: { ...owner, generation: -1 } }), none, "even with no session yet");
    assert.equal(captions.mergeRealtimeState({}, { mic: { ...owner, generation: 0 } }).mic.generation, 0);
    const connecting = { mic: { ...owner, state: "connecting" } };
    assert.equal(captions.mergeRealtimeState(connecting, { mic: { ...owner, state: "starting" } }).mic.state, "starting");
});
