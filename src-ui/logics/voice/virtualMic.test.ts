import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, unchecked } from "../test/hookHarness.ts";
import * as shapes from "./virtualMic.ts";
import type { VirtualMicCable, VirtualMicStatus, VirtualMicStatusReply } from "./virtualMic.ts";

const id = (name: string) => JSON.stringify(["Windows WASAPI", name]);
const CABLE: VirtualMicCable = { playback: id("CABLE Input (VB-Audio Virtual Cable)"), recording: id("CABLE Output (VB-Audio Virtual Cable)"),
    playback_label: "CABLE Input (VB-Audio Virtual Cable)", recording_label: "CABLE Output (VB-Audio Virtual Cable)" };
const status = (extra: Partial<VirtualMicStatus> = {}): VirtualMicStatus => ({ supported: true, cables: [CABLE], error: null, tts_output: null, tts_output_is_cable: false, ...extra });

test("only a well-formed status is used", () => {
    assert.deepEqual(shapes.normalizeVirtualMicStatus(status()), status());
    for (const bad of [null, "x", {}, { supported: true }, { supported: "yes", cables: [] },
        { supported: true, cables: [{ playback: "a" }] }]) {
        // On purpose: replies of the wrong shape.
        assert.equal(shapes.normalizeVirtualMicStatus(unchecked<VirtualMicStatusReply>(bad)), null, JSON.stringify(bad));
    }
    // A label that is missing falls back to the device identity.
    // On purpose: a cable without its labels.
    const fallback = shapes.normalizeVirtualMicStatus(status({ cables: [unchecked<VirtualMicCable>({ playback: "p", recording: "r" })] }));
    assert.ok(fallback);
    assert.equal(fallback.cables[0].recording_label, "r");
});

test("levels are kept between 0 and 1, and results need their flags", () => {
    assert.deepEqual(shapes.normalizeVirtualMicLevel({ playback: "p", level: 1.4 }), { playback: "p", level: 1 });
    assert.deepEqual(shapes.normalizeVirtualMicLevel({ playback: "p", level: -1 }), { playback: "p", level: 0 });
    assert.equal(shapes.normalizeVirtualMicLevel({ playback: "p", level: Number.NaN }), null);
    assert.equal(shapes.normalizeVirtualMicLevel({ level: 0.5 }), null);
    assert.deepEqual(shapes.normalizeVirtualMicResult({ heard: true, stopped: false, peak_dbfs: -12, recording: "r" }),
        { heard: true, stopped: false, peak_dbfs: -12, recording: "r" });
    assert.equal(shapes.normalizeVirtualMicResult({ heard: true }), null);
});

test("the cable TTS already plays into is checked first, even under a cut MME name", () => {
    const other = { ...CABLE, playback: id("VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)"), playback_label: "VoiceMeeter Input" };
    assert.equal(shapes.preferredCable(status({ cables: [other, CABLE] })), other);
    assert.equal(shapes.preferredCable(status({ cables: [other, CABLE], tts_output: CABLE.playback, tts_output_is_cable: true })), CABLE);
    assert.equal(shapes.preferredCable(status({ cables: [] })), null);
    assert.equal(shapes.deviceName(CABLE.playback), "CABLE Input (VB-Audio Virtual Cable)");
    assert.equal(shapes.deviceName("plain"), "plain");
});

async function hook(context: TestContext, sent: [string, unknown][] = []) {
    const runtime = hooks();
    const { useVirtualMic } = await loadModule<typeof import("./useVirtualMic.ts")>(new URL("./useVirtualMic.ts", import.meta.url), runtime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string, data?: unknown) => { sent.push([endpoint, data]); return true; } }) },
        "./virtualMic.ts": shapes,
    });
    context.onTestFinished(() => runtime.unmount());
    return () => runtime.render(useVirtualMic);
}

test("a check moves the meter only for its own cable and ends with its outcome", async context => {
    const sent: [string, unknown][] = [];
    const use = await hook(context, sent);
    await use().startCheck(CABLE.playback);
    assert.deepEqual(sent, [["/run/virtual_mic_test", { playback: CABLE.playback }]]);
    // A second press while it runs sends nothing.
    await use().startCheck(CABLE.playback);
    assert.equal(sent.length, 1);
    use().updateLevel({ playback: "other", level: 0.9 });
    assert.equal(use().check.level, 0);
    use().updateLevel({ playback: CABLE.playback, level: 0.8 });
    assert.equal(use().check.level, 0.8);
    use().updateResult({ heard: true, stopped: false, peak_dbfs: -12.1 });
    assert.equal(use().check.phase, "done");
    assert.equal(use().check.level, 0);
    assert.equal(use().check.result?.heard, true);
    // A late level after the end does not move the meter again.
    use().updateLevel({ playback: CABLE.playback, level: 0.5 });
    assert.equal(use().check.level, 0);
});

test("a refused check shows its code, and a stopped backend ends a check under way", async context => {
    const use = await hook(context);
    await use().startCheck(CABLE.playback);
    use().failCheck("virtual_mic_voice_muted");
    assert.deepEqual([use().check.phase, use().check.error], ["failed", "virtual_mic_voice_muted"]);
    use().resetCheck();
    await use().startCheck(CABLE.playback);
    use().backendStopped();
    assert.deepEqual([use().check.phase, use().check.error], ["failed", "backend_unavailable"]);
});

// #943: the guide opens only when asked; the notice the engine keeps opens nothing and is not changed.
test("the guide opens and closes when asked, and nothing is sent about the notice", async context => {
    const sent: [string, unknown][] = [];
    const use = await hook(context, sent);
    use().updateNotice(true);
    assert.equal(use().notice, true);
    assert.equal(use().opened, false);
    use().openGuide();
    assert.equal(use().opened, true);
    use().closeGuide();
    assert.equal(use().opened, false);
    assert.deepEqual(sent.filter(([endpoint]) => endpoint.includes("virtual_mic_notice")), []);
});

test("the status, the level, the outcome and a refusal arrive through their own routes", async () => {
    const { loadBridgeRoutes } = await import("../test/bridgeHarness.ts");
    const subject = await loadBridgeRoutes();
    const state = () => subject.virtualMic();
    subject.receiveRoutes({ status: 200, endpoint: "/get/data/virtual_mic_notice", result: true });
    subject.receiveRoutes({ status: 200, endpoint: "/get/data/virtual_mic_status", result: status() });
    assert.equal(state().notice, true);
    assert.deepEqual(state().status, status());
    await state().startCheck(CABLE.playback);
    subject.receiveRoutes({ status: 200, endpoint: "/run/virtual_mic_level", result: { playback: CABLE.playback, level: 0.7 } });
    assert.equal(state().check.level, 0.7);
    subject.receiveRoutes({ status: 200, endpoint: "/run/virtual_mic_test", result: { heard: false, stopped: false, peak_dbfs: null } });
    assert.deepEqual([state().check.phase, state().check.result?.heard], ["done", false]);
    // A refusal is the guide's own message, not a general error notice.
    state().resetCheck();
    await state().startCheck(CABLE.playback);
    subject.receiveRoutes({ status: 409, endpoint: "/run/virtual_mic_test", result: { error_code: "virtual_mic_voice_muted" } });
    assert.deepEqual([state().check.phase, state().check.error], ["failed", "virtual_mic_voice_muted"]);
    assert.deepEqual(subject.notices, []);
});
