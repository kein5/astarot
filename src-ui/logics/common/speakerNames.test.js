import assert from "node:assert/strict";
import { test } from "vitest";
import { applySpeakerNames, isSpeakerName, speakerContinuations, tidySpeakerName } from "./speakerNames.ts";

test("the core's answer replaces the names of its session and keeps the latest sessions", () => {
    let names = applySpeakerNames({}, { namespace: "one", names: { A: "ミカ", B: "ユウ" } });
    assert.deepEqual(names, { one: { A: "ミカ", B: "ユウ" } });
    // The whole set of the session: a label left out has no name any more.
    names = applySpeakerNames(names, { namespace: "one", names: { B: "ユウ" } });
    assert.deepEqual(names, { one: { B: "ユウ" } });
    // Labels and names the core would never send are dropped; a malformed answer changes nothing.
    names = applySpeakerNames(names, { namespace: "two", names: { a: "x", AB: "", C: "x".repeat(33), D: "ok" } });
    assert.deepEqual(names.two, { D: "ok" });
    for (const bad of [null, "x", { namespace: "", names: {} }, { namespace: "one", names: [] }, { names: {} }]) {
        assert.equal(applySpeakerNames(names, bad), names);
    }
    for (let session = 0; session < 10; session++) names = applySpeakerNames(names, { namespace: `s${session}`, names: {} });
    assert.equal(Object.keys(names).length, 8);
    assert.equal(names.one, undefined, "the oldest sessions go");
});

test("a name is tidied as the core keeps it and refused when too long or not one line", () => {
    assert.equal(tidySpeakerName("  ミカ   さん "), "ミカ さん");
    assert.equal(isSpeakerName(""), true);
    assert.equal(isSpeakerName("x".repeat(32)), true);
    assert.equal(isSpeakerName("x".repeat(33)), false);
    assert.equal(isSpeakerName("a\nb"), false);
});

test("rows of one session with the same voices go on from the row above them", () => {
    const row = (id, speakers, extra = {}) => ({ id, category: "received", status: "ok", speakers,
        realtime: { namespace: "n", generation: 1 }, ...extra });
    const rows = [
        row("1", ["A"]), row("2", ["A"]), row("3", ["A", "B"]), row("4", ["A", "B"]),
        row("5", ["A"], { status: "pending" }), row("6", ["A"]),
        row("7", ["A"], { realtime: { namespace: "m", generation: 2 } }),
        { id: "8", category: "sent", status: "ok", speakers: ["A"] }, row("9", []), row("10", []),
    ];
    assert.deepEqual([...speakerContinuations(rows)], ["2", "4", "6"]);
});
