import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import { MIC_CAPTURE_WAIT_NOTICE, micCaptureWaiting, micWaitSystem } from "./micCaptureWait.ts";
import type { MicWaitSystem } from "./micCaptureWait.ts";
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

// #1314 (M-4): only Windows asks on the desktop. The webview names its system in the user agent.
test("the wait is worded for Windows only where the webview runs on Windows", () => {
    // WebView2 on Windows, WebKitGTK on Linux.
    assert.equal(micWaitSystem("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"), "windows");
    assert.equal(micWaitSystem("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)"), "linux");
    assert.equal(micWaitSystem(""), "linux");
});

async function fixture(context: TestContext, system: MicWaitSystem = "windows") {
    const runtime = hooks(), events: unknown[][] = [];
    const state = { mic: undefined as RealtimeSession | undefined, atom: false };
    const hook = await loadModule<typeof import("./useMicCaptureWait.ts")>(new URL("./useMicCaptureWait.ts", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@store": { useStore_MicCaptureWaiting: () => ({ currentMicCaptureWaiting: { data: state.atom },
            updateMicCaptureWaiting: (value: boolean) => { state.atom = value; events.push(["atom", value]); } }) },
        "./useRealtimeASR": { useRealtimeASR: () => ({ state: { mic: state.mic } }) },
        "./micCaptureWait": { ...await import("./micCaptureWait.ts"), micWaitSystem: () => system },
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
    assert.deepEqual(s.events, [["atom", true], ["warning", "realtime.mic_wait.windows", { category_id: MIC_CAPTURE_WAIT_NOTICE, hide_duration: null }]],
        "once for the wait, and kept until it ends");
    s.events.length = 0;
    s.state.mic = { generation: 1, state: "ready", capture_waiting: false };
    s.render();
    assert.deepEqual(s.events, [["atom", false], ["dismiss", MIC_CAPTURE_WAIT_NOTICE]]);
});

test("on Linux the notice says what holds a microphone there, not that Windows may be asking", async context => {
    const s = await fixture(context, "linux");
    s.state.mic = { generation: 1, state: "starting", capture_waiting: true };
    s.render();
    assert.deepEqual(s.events, [["atom", true], ["warning", "realtime.mic_wait.linux", { category_id: MIC_CAPTURE_WAIT_NOTICE, hide_duration: null }]]);
});
