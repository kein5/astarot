import assert from "node:assert/strict";
import { test } from "vitest";
import { runVrVoiceAction, voiceActions, voiceStopState } from "./voiceActions.ts";

// #1314 (V-4): the VR panel's launcher shows the top bar's stop and presses the main window's own
// text to speech switch and stop. These are the main window's views of them.

test("the stop's state is published once per change, and listeners hear each change", () => {
    const heard: unknown[] = [];
    const off = voiceStopState.subscribe(() => heard.push(voiceStopState.get()));
    voiceStopState.publish({ offered: true, phase: "idle" });
    voiceStopState.publish({ offered: true, phase: "idle" });
    voiceStopState.publish({ offered: true, phase: "stopping" });
    off();
    voiceStopState.publish({ offered: false, phase: "idle" });
    assert.deepEqual(heard, [{ offered: true, phase: "idle" }, { offered: true, phase: "stopping" }]);
    assert.deepEqual(voiceStopState.get(), { offered: false, phase: "idle" });
});

test("the launcher's requests run the main window's switch and stop, and nothing else", () => {
    const ran: string[] = [];
    const saved = { ...voiceActions };
    voiceActions.toggleTts = () => ran.push("tts");
    voiceActions.stop = () => ran.push("stop");
    voiceActions.toggleRvc = () => ran.push("rvc");
    voiceActions.toggleMute = () => ran.push("mute");
    try {
        assert.equal(runVrVoiceAction("toggle_tts"), true);
        assert.equal(runVrVoiceAction("stop"), true);
        for (const other of ["toggle_rvc", "toggle_mute", "", null, { action: "stop" }]) assert.equal(runVrVoiceAction(other), false);
        assert.deepEqual(ran, ["tts", "stop"]);
        // Before the main window has drawn its switch, a request does nothing.
        voiceActions.toggleTts = null;
        assert.equal(runVrVoiceAction("toggle_tts"), true);
        assert.deepEqual(ran, ["tts", "stop"]);
    } finally {
        Object.assign(voiceActions, saved);
    }
});
