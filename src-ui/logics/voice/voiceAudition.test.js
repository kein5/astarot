import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import yaml from "js-yaml";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as shapes from "./voiceAudition.ts";

const playing = (run, profile = "japanese") => ({ state: "playing", run, profile, last_run: null, outcome: null, error_code: null });
const ended = (run, last, outcome, error_code = null) => ({ state: "idle", run, profile: null, last_run: last, outcome, error_code });

test("only a well-formed state is used, and only a failure carries a code", () => {
    assert.deepEqual(shapes.normalizeAuditionState(playing(2)), playing(2));
    assert.deepEqual(shapes.normalizeAuditionState(ended(3, 3, "failed", "monitor_output_missing")), ended(3, 3, "failed", "monitor_output_missing"));
    assert.equal(shapes.normalizeAuditionState(ended(3, 3, "completed", "x")).error_code, null);
    // A code that is not a plain identifier is not shown as one.
    assert.equal(shapes.normalizeAuditionState(ended(3, 3, "failed", "Device <b>")).error_code, "voice_audition_failed");
    for (const bad of [null, "playing", {}, { state: "playing" }, { state: "busy", run: 1 }, { state: "idle", run: -1 }, { state: "idle", run: 1.5 }])
        assert.equal(shapes.normalizeAuditionState(bad), null, JSON.stringify(bad));
});

test("each profile reads the language it speaks in use, by id only", () => {
    assert.equal(shapes.auditionSentence("japanese"), "ja");
    assert.equal(shapes.auditionSentence("multilingual"), "en");
    assert.equal(shapes.isAuditionProfile("asr"), false);
});

test("a card can play only the model in use, with its server running, the monitor on and not muted", () => {
    const ok = { status: "in_use", server: "ready", monitor: "on", muted: false };
    assert.equal(shapes.auditionBlock(ok), null);
    assert.equal(shapes.auditionBlock({ ...ok, status: "not_downloaded" }), "not_downloaded");
    assert.equal(shapes.auditionBlock({ ...ok, status: "working" }), "not_downloaded");
    assert.equal(shapes.auditionBlock({ ...ok, status: "downloaded" }), "not_in_use");
    assert.equal(shapes.auditionBlock({ ...ok, status: "ready" }), "not_in_use");
    for (const server of ["stopped", "preparing", "failed", undefined]) assert.equal(shapes.auditionBlock({ ...ok, server }), "server_stopped");
    assert.equal(shapes.auditionBlock({ ...ok, monitor: "off" }), "monitor_off");
    assert.equal(shapes.auditionBlock({ ...ok, monitor: undefined }), "monitor_off");
    assert.equal(shapes.auditionBlock({ ...ok, muted: true }), "muted");
    // The first thing to fix is named first.
    assert.equal(shapes.auditionBlock({ status: "downloaded", server: "stopped", monitor: "off", muted: true }), "not_in_use");
});

test("a press waits for its own answer, plays, and ends with the outcome of its run", () => {
    const pending = { phase: "pending", profile: "japanese", run: null, error: null };
    // A poll from before the press does not end it.
    assert.equal(shapes.auditionAfterState(pending, ended(0, null, null)), pending);
    const view = shapes.auditionAfterState(pending, playing(1));
    assert.deepEqual(view, { phase: "playing", profile: "japanese", run: 1, error: null });
    // An older run's end is not this one's.
    const second = { ...view, run: 2 };
    assert.equal(shapes.auditionAfterState(second, ended(2, 1, "stopped")), second);
    assert.deepEqual(shapes.auditionAfterState(view, ended(1, 1, "completed")), { phase: "idle", profile: "japanese", run: 1, error: null });
    assert.deepEqual(shapes.auditionAfterState(view, ended(1, 1, "failed", "monitor_output_missing")),
        { phase: "idle", profile: "japanese", run: 1, error: "monitor_output_missing" });
    // A later press elsewhere replaced it and has ended too: no error is pinned on this one.
    assert.deepEqual(shapes.auditionAfterState(view, ended(2, 2, "failed", "x")), { phase: "idle", profile: "japanese", run: 1, error: null });
    // A stale "playing" answer never moves the page back to a replaced run.
    const replaced = { ...view, run: 3 };
    assert.equal(shapes.auditionAfterState(replaced, playing(2)), replaced);
    assert.deepEqual(shapes.auditionAfterFailure(pending, "voice_audition_muted"), { ...pending, phase: "idle", error: "voice_audition_muted" });
    assert.equal(shapes.auditionAfterFailure(view, "x"), view);
});

async function hook(context, sent = []) {
    const runtime = hooks();
    const { useVoiceAudition } = await loadModule(new URL("./useVoiceAudition.ts", import.meta.url), runtime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint, data) => { sent.push([endpoint, data]); return true; } }) },
        "./voiceAudition.ts": shapes,
    });
    context.onTestFinished(() => runtime.unmount());
    return () => runtime.render(useVoiceAudition);
}

test("a press sends the sentence's id, never its text, and repeat presses wait for the answer", async context => {
    const sent = [];
    const use = await hook(context, sent);
    await use().start("multilingual");
    assert.deepEqual(sent, [["/run/start_voice_audition", { kind: "tts", profile: "multilingual", sentence: "en" }]]);
    assert.equal(use().audition.phase, "pending");
    await use().start("multilingual");
    await use().start("japanese");
    assert.equal(sent.length, 1, "a press while one waits was sent");
    use().updateState(playing(4, "multilingual"));
    assert.deepEqual([use().audition.phase, use().audition.run], ["playing", 4]);
    // A new press while one plays replaces it in the engine.
    await use().start("japanese");
    assert.equal(sent.length, 2);
    use().updateState(playing(5));
    await use().stop();
    assert.deepEqual(sent[2], ["/run/stop_voice_audition", undefined]);
    use().updateState(ended(5, 5, "stopped"));
    assert.deepEqual([use().audition.phase, use().audition.error], ["idle", null]);
    // The engine stopped while one played.
    await use().start("japanese");
    use().updateState(playing(6));
    use().backendStopped();
    assert.deepEqual([use().audition.phase, use().audition.error], ["idle", "backend_unavailable"]);
});

test("a refusal reaches the card through its own route, and only a playing audition is polled", async () => {
    const { loadBridgeRoutes } = await import("../test/bridgeHarness.ts");
    const subject = await loadBridgeRoutes();
    const state = () => subject.voiceAudition();
    await state().start("japanese");
    subject.receiveRoutes({ status: 409, endpoint: "/run/start_voice_audition", result: { error_code: "voice_audition_monitor_off" } });
    assert.deepEqual([state().audition.phase, state().audition.error], ["idle", "voice_audition_monitor_off"]);
    // It is the card's message, not a general error notice.
    assert.deepEqual(subject.notices, []);
    await state().start("japanese");
    subject.receiveRoutes({ status: 200, endpoint: "/run/start_voice_audition", result: playing(2) });
    assert.equal(state().audition.phase, "playing");
    subject.receiveRoutes({ status: 200, endpoint: "/get/data/voice_audition_state", result: ended(2, 2, "completed") });
    assert.deepEqual([state().audition.phase, state().audition.error], ["idle", null]);
    // A failed poll or stop changes nothing and shows nothing.
    subject.receiveRoutes({ status: 500, endpoint: "/get/data/voice_audition_state", result: "Internal error" });
    assert.deepEqual(subject.notices, []);
    assert.deepEqual(subject.auditionSent.map(([endpoint]) => endpoint), ["/run/start_voice_audition", "/run/start_voice_audition"]);
});

// What the core answers (native/core/src/controller/voice/audition.rs and the voice controller),
// and what the UI makes itself: each has a text on the card in both languages.
const CODES = ["voice_audition_failed", "voice_audition_unconfirmed", "voice_audition_request_invalid", "voice_audition_closed",
    "voice_audition_muted", "voice_audition_monitor_off", "voice_audition_monitor_blocked", "voice_audition_devices_unavailable",
    "voice_audition_server_not_ready", "voice_audition_timeout", "monitor_output_missing", "monitor_feedback_blocked",
    "monitor_output_error", "backend_unavailable"];

for (const language of ["en", "ja"]) test(`${language}: every reason and code of the audition has its text`, () => {
    const locale = yaml.load(readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8")).voice_audition;
    for (const key of ["play", "pending", "stop", "tooltip"]) assert.equal(typeof locale[key], "string", key);
    for (const block of ["not_in_use", "server_stopped", "monitor_off", "muted"]) assert.equal(typeof locale.blocked[block], "string", block);
    for (const code of CODES) assert.equal(typeof locale.errors[code], "string", code);
});
