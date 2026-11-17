import assert from "node:assert/strict";
import { test } from "node:test";
import { shownTelemetry, telemetryUnanswered, toggleTelemetryOrAnswer } from "./telemetryToggle.ts";

const switchWith = (enabled, pending) => {
    const calls = [];
    return { calls, others: {
        currentTelemetry: { data: enabled }, currentTelemetryNotice: { data: { pending, enabled } },
        toggleTelemetry: () => calls.push(["toggle"]),
        setTelemetryNotice: answer => { calls.push(["answer", answer]); return Promise.resolve(); },
        getTelemetry: () => calls.push(["read"]),
    } };
};

// SEC-07: /set/enable/telemetry is no answer to the notice; the settings page answers it itself.
// ENABLE_TELEMETRY starts true, so an unanswered notice comes with enabled=true: the switch shows
// off then, and one press answers "send" (it used to answer "don't send" and stay off).
test("one press while the notice is unanswered answers send, whatever the setting says", async () => {
    for (const enabled of [true, false]) {
        const { calls, others } = switchWith(enabled, true);
        await toggleTelemetryOrAnswer(others);
        assert.deepEqual(calls, [["answer", { send: true }], ["read"]], `enabled=${enabled}`);
    }
});

test("until the notice is answered the switch shows off, as nothing is sent", () => {
    const notice = pending => ({ state: "ok", data: { pending, enabled: true } });
    assert.deepEqual(shownTelemetry({ state: "ok", data: true }, notice(true)), { state: "ok", data: false });
    assert.equal(telemetryUnanswered(notice(true)), true);
    // Answered (or VRCT_TELEMETRY=off, which reports no pending notice): the setting as it is.
    const telemetry = { state: "ok", data: true };
    assert.equal(shownTelemetry(telemetry, notice(false)), telemetry);
    assert.equal(telemetryUnanswered(notice(false)), false);
    assert.equal(shownTelemetry({ state: "ok", data: false }, notice(false)).data, false);
    // Not known yet: the setting as it is.
    assert.equal(shownTelemetry(telemetry, undefined), telemetry);
    // The answer given from the switch is on its way: the switch waits.
    assert.deepEqual(shownTelemetry(telemetry, { state: "pending", data: { pending: true } }), { state: "pending", data: false });
});

test("switching after the notice was answered uses the switch", async () => {
    for (const [enabled, pending] of [[true, false], [false, false]]) {
        const { calls, others } = switchWith(enabled, pending);
        await toggleTelemetryOrAnswer(others);
        assert.deepEqual(calls, [["toggle"]], `enabled=${enabled} pending=${pending}`);
    }
});
