import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import { MIC_CAPTURE_WAIT_NOTICE, micCaptureWaiting } from "./micCaptureWait.ts";
import type { RealtimeSession } from "./realtimeCaptionState.ts";

// #1300 (decided on 2026-11-28): while Mic input's microphone waits to open, as Windows holds it for
// its permission question on the desktop, the main window says so once and the VR panel reads the
// same atom.

test("Mic input waits on its microphone while its captions start and the core reports the wait", () => {
    assert.equal(micCaptureWaiting(undefined), false);
    assert.equal(micCaptureWaiting({ generation: 1, state: "starting" }), false);
    assert.equal(micCaptureWaiting({ generation: 1, state: "starting", capture_waiting: true }), true);
    // Once the captions run, or have stopped, nothing waits.
    assert.equal(micCaptureWaiting({ generation: 1, state: "ready", capture_waiting: true }), false);
    assert.equal(micCaptureWaiting({ generation: 1, state: "failed", capture_waiting: true }), false);
});

async function fixture(context: TestContext) {
    const runtime = hooks(), events: unknown[][] = [];
    const state = { mic: undefined as RealtimeSession | undefined, atom: false };
    const hook = await loadModule<typeof import("./useMicCaptureWait.ts")>(new URL("./useMicCaptureWait.ts", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@store": { useStore_MicCaptureWaiting: () => ({ currentMicCaptureWaiting: { data: state.atom },
            updateMicCaptureWaiting: (value: boolean) => { state.atom = value; events.push(["atom", value]); } }) },
        "./useRealtimeASR": { useRealtimeASR: () => ({ state: { mic: state.mic } }) },
        "./micCaptureWait": await import("./micCaptureWait.ts"),
        "../common/useNotificationStatus": { useNotificationStatus: () => ({
            showNotification_Warning: (message: unknown, options: unknown) => events.push(["warning", message, options]),
            dismissNotification: (id: unknown) => events.push(["dismiss", id]),
        }) },
    });
    context.onTestFinished(() => runtime.unmount());
    return { state, events, render: () => runtime.render(hook.useMicCaptureWaitSource) };
}

test("the main window says it once for a wait, keeps the VR panel's atom, and takes the notice away after", async context => {
    const s = await fixture(context);
    s.render();
    assert.deepEqual(s.events, [], "nothing while nothing waits");
    s.state.mic = { generation: 1, state: "starting", capture_waiting: false };
    s.render();
    assert.deepEqual(s.events, []);
    s.state.mic = { generation: 1, state: "starting", capture_waiting: true };
    s.render();
    s.render();
    assert.deepEqual(s.events, [["atom", true], ["warning", "realtime.mic_permission_wait", { category_id: MIC_CAPTURE_WAIT_NOTICE, hide_duration: null }]],
        "once for the wait, and kept until it ends");
    s.events.length = 0;
    s.state.mic = { generation: 1, state: "ready", capture_waiting: false };
    s.render();
    assert.deepEqual(s.events, [["atom", false], ["dismiss", MIC_CAPTURE_WAIT_NOTICE]]);
});
