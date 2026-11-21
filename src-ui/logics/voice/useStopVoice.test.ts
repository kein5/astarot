import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as shapes from "./stopVoice.ts";

// #937: the top bar's stop answers its press, as the hexagram's switches do (#911).
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function setup(sendResult: unknown = true) {
    const runtime = hooks(), sent: string[] = [];
    const { useStopVoice } = await loadModule<typeof import("./useStopVoice.ts")>(new URL("./useStopVoice.ts", import.meta.url), runtime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string) => { sent.push(endpoint); return sendResult; } }) },
        "./stopVoice.ts": shapes,
    });
    return { stop: () => runtime.render(useStopVoice), sent };
}

test("a press waits for the answer and takes no other press, says stopped a moment, then is idle", async () => {
    const s = await setup();
    assert.equal(s.stop().stop.phase, "idle");
    await s.stop().press();
    assert.deepEqual([s.stop().stop.phase, s.sent], ["stopping", ["/run/stop_voice"]]);
    assert.equal(await s.stop().press(), false, "a second press while it waits is ignored");
    assert.equal(s.sent.length, 1);
    s.stop().answered();
    assert.equal(s.stop().stop.phase, "stopped");
    vi.advanceTimersByTime(shapes.STOPPED_MS - 1);
    assert.equal(s.stop().stop.phase, "stopped");
    vi.advanceTimersByTime(1);
    assert.equal(s.stop().stop.phase, "idle");
    // An answer with no press waiting changes nothing.
    s.stop().answered();
    assert.equal(s.stop().stop.phase, "idle");
});

test("a press refused, not sent or not answered in time is idle at once", async () => {
    const refused = await setup();
    await refused.stop().press();
    refused.stop().failed();
    assert.equal(refused.stop().stop.phase, "idle");

    const unsent = await setup(false);
    await unsent.stop().press();
    assert.equal(unsent.stop().stop.phase, "idle");

    const silent = await setup();
    await silent.stop().press();
    vi.advanceTimersByTime(shapes.STOP_ANSWER_MS);
    assert.equal(silent.stop().stop.phase, "idle");
});

test("the stop is offered only while something it stops runs", () => {
    const idle = { status: {}, audition: { phase: "idle" }, check: { phase: "idle" } };
    assert.equal(shapes.somethingToStop(idle), false);
    assert.equal(shapes.somethingToStop({ ...idle, status: { queued: 0, active: false } }), false);
    for (const running of [{ status: { active: true } }, { status: { queued: 3 } }, { audition: { phase: "pending" } },
        { audition: { phase: "playing" } }, { check: { phase: "running" } }])
        assert.equal(shapes.somethingToStop({ ...idle, ...running }), true, JSON.stringify(running));
});
