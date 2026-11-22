import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import { localeAt, readLocale } from "../test/locales.ts";
import * as shapes from "./voiceAudition.ts";
import type { AuditionProfile, AuditionState, AuditionView } from "./voiceAudition.ts";

const playing = (run: number, profile: AuditionProfile = "japanese"): AuditionState =>
    ({ state: "playing", run, kind: "tts", profile, entry: null, stage: "playing", last_run: null, outcome: null, error_code: null });
const converting = (run: number, entry: string, stage: AuditionState["stage"] = "recording"): AuditionState =>
    ({ state: "playing", run, kind: "rvc", profile: null, entry, stage, last_run: null, outcome: null, error_code: null });
// The input an RVC audition records from, as the RVC page names it.
const MIC = { cookie: "1", serial: "42", name: "Mic (Realtek)", media_class: "Audio/Source" };
const ended = (run: number, last: number | null, outcome: AuditionState["outcome"], error_code: string | null = null): AuditionState =>
    ({ state: "idle", run, kind: null, profile: null, entry: null, stage: null, last_run: last, outcome, error_code });

test("only a well-formed state is used, and only a failure carries a code", () => {
    assert.deepEqual(shapes.normalizeAuditionState(playing(2)), playing(2));
    assert.deepEqual(shapes.normalizeAuditionState(converting(2, "rvc-saisho")), converting(2, "rvc-saisho"));
    assert.deepEqual(shapes.normalizeAuditionState(ended(3, 3, "failed", "monitor_output_missing")), ended(3, 3, "failed", "monitor_output_missing"));
    assert.equal(shapes.normalizeAuditionState(ended(3, 3, "completed", "x"))?.error_code, null);
    // A code that is not a plain identifier is not shown as one, nor an entry that is not an id.
    assert.equal(shapes.normalizeAuditionState(ended(3, 3, "failed", "Device <b>"))?.error_code, "voice_audition_failed");
    assert.equal(shapes.normalizeAuditionState(converting(2, "C:\\voices\\model.pth"))?.entry, null);
    // A core from before the RVC audition names no kind or stage: a playing profile is TTS.
    const older = { state: "playing", run: 4, profile: "multilingual", last_run: null, outcome: null, error_code: null };
    assert.deepEqual(shapes.normalizeAuditionState(older), { ...playing(4, "multilingual"), stage: null });
    for (const bad of [null, "playing", {}, { state: "playing" }, { state: "busy", run: 1 }, { state: "idle", run: -1 }, { state: "idle", run: 1.5 }])
        assert.equal(shapes.normalizeAuditionState(bad), null, JSON.stringify(bad));
});

test("an RVC card plays any model on this PC with valid form values, no conversion running and an input to record from", () => {
    const values = { pitch: 3, index_rate: 0.5 };
    const ok = { status: "downloaded", values, converting: false, input: MIC, monitor: "on", muted: false };
    assert.equal(shapes.rvcAuditionBlock(ok), null);
    assert.equal(shapes.rvcAuditionBlock({ ...ok, status: "in_use" }), null);
    assert.equal(shapes.rvcAuditionBlock({ ...ok, status: "ready" }), null);
    for (const status of ["not_downloaded", "working", "missing"]) assert.equal(shapes.rvcAuditionBlock({ ...ok, status }), "not_downloaded");
    assert.equal(shapes.rvcAuditionBlock({ ...ok, values: null }), "values_invalid");
    assert.equal(shapes.rvcAuditionBlock({ ...ok, converting: true }), "conversion_running");
    for (const input of [null, undefined, ""]) assert.equal(shapes.rvcAuditionBlock({ ...ok, input }), "input_missing");
    assert.equal(shapes.rvcAuditionBlock({ ...ok, monitor: "off" }), "monitor_off");
    assert.equal(shapes.rvcAuditionBlock({ ...ok, muted: true }), "muted");
    // The first thing to fix is named first.
    assert.equal(shapes.rvcAuditionBlock({ ...ok, values: null, converting: true, input: null, monitor: "off", muted: true }), "values_invalid");
    // The form's values, as the core takes them.
    assert.deepEqual(shapes.rvcAuditionValues(-24, 1), { pitch: -24, index_rate: 1 });
    for (const [pitch, rate] of [[25, 0], [1.5, 0], [Number.NaN, 0], [0, 1.2], [0, -0.1], [0, Number.NaN], ["3", 0], [0, "0.5"]])
        assert.equal(shapes.rvcAuditionValues(pitch, rate), null, `${pitch} ${rate}`);
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
    const pending: AuditionView = { ...shapes.IDLE_AUDITION, phase: "pending", kind: "tts", profile: "japanese" };
    // A poll from before the press does not end it.
    assert.equal(shapes.auditionAfterState(pending, ended(0, null, null)), pending);
    const view = shapes.auditionAfterState(pending, playing(1));
    const shown = { phase: "playing", kind: "tts", profile: "japanese", entry: null, stage: "playing", run: 1, error: null };
    assert.deepEqual(view, shown);
    // An older run's end is not this one's.
    const second = { ...view, run: 2 };
    assert.equal(shapes.auditionAfterState(second, ended(2, 1, "stopped")), second);
    assert.deepEqual(shapes.auditionAfterState(view, ended(1, 1, "completed")), { ...shown, phase: "idle", stage: null });
    assert.deepEqual(shapes.auditionAfterState(view, ended(1, 1, "failed", "monitor_output_missing")),
        { ...shown, phase: "idle", stage: null, error: "monitor_output_missing" });
    // A later press elsewhere replaced it and has ended too: no error is pinned on this one.
    assert.deepEqual(shapes.auditionAfterState(view, ended(2, 2, "failed", "x")), { ...shown, phase: "idle", stage: null });
    // An RVC card's audition prepares, plays, and keeps its model's id for its outcome.
    const rvc = shapes.auditionAfterState({ ...shapes.IDLE_AUDITION, phase: "pending", kind: "rvc", entry: "user-0123456789ab" }, converting(7, "user-0123456789ab"));
    assert.deepEqual([rvc.kind, rvc.entry, rvc.stage], ["rvc", "user-0123456789ab", "recording"]);
    assert.equal(shapes.auditionAfterState(rvc, converting(7, "user-0123456789ab", "playing")).stage, "playing");
    assert.deepEqual(shapes.auditionAfterState(rvc, ended(7, 7, "failed", "vc_runtime_missing")),
        { ...rvc, phase: "idle", stage: null, error: "vc_runtime_missing" });
    // A stale "playing" answer never moves the page back to a replaced run.
    const replaced = { ...view, run: 3 };
    assert.equal(shapes.auditionAfterState(replaced, playing(2)), replaced);
    assert.deepEqual(shapes.auditionAfterFailure(pending, "voice_audition_muted"), { ...pending, phase: "idle", error: "voice_audition_muted" });
    assert.equal(shapes.auditionAfterFailure(view, "x"), view);
});

async function hook(context: TestContext, sent: [string, unknown][] = []) {
    const runtime = hooks();
    const { useVoiceAudition } = await loadModule<typeof import("./useVoiceAudition.ts")>(new URL("./useVoiceAudition.ts", import.meta.url), runtime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (endpoint: string, data?: unknown) => { sent.push([endpoint, data]); return true; } }) },
        "./voiceAudition.ts": shapes,
    });
    context.onTestFinished(() => runtime.unmount());
    return () => runtime.render(useVoiceAudition);
}

test("a press sends the sentence's id, never its text, and repeat presses wait for the answer", async context => {
    const sent: [string, unknown][] = [];
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

test("an RVC press names its model by id, the input to record from and the form's values, never a path", async context => {
    const sent: [string, unknown][] = [];
    const use = await hook(context, sent);
    await use().startRvc("rvc-saisho", { pitch: -5, index_rate: 0.75 }, MIC);
    assert.deepEqual(sent, [["/run/start_voice_audition", { kind: "rvc", entry: "rvc-saisho", source: "recording", input: MIC, seconds: shapes.RVC_AUDITION_SECONDS, pitch: -5, index_rate: 0.75 }]]);
    assert.deepEqual([use().audition.phase, use().audition.kind, use().audition.entry, use().audition.profile], ["pending", "rvc", "rvc-saisho", null]);
    // One waits for its answer, whichever card is pressed next.
    await use().start("japanese");
    assert.equal(sent.length, 1);
    use().updateState(converting(3, "rvc-saisho"));
    assert.deepEqual([use().audition.phase, use().audition.stage], ["playing", "recording"]);
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

// The RVC audition's own codes and the worker's codes it may end with (the rest are the live
// conversion's, in voice.input_errors).
const RVC_CODES = ["voice_audition_failed", "voice_audition_model_missing", "voice_audition_conversion_running", "voice_audition_recording_silent",
    "voice_audition_input_unavailable", "asr_capture_failed", "voice_audition_timeout", "vc_runtime_missing", "vc_worker_stalled", "vc_worker_eof"];

for (const language of ["en", "ja"]) test(`${language}: every reason and code of the audition has its text`, () => {
    const locale = readLocale(language);
    for (const key of ["play", "pending", "stop", "tooltip", "rvc_tooltip", "rvc_recording", "rvc_preparing"]) assert.equal(typeof localeAt(locale, `voice_audition.${key}`), "string", key);
    for (const block of ["not_in_use", "server_stopped", "monitor_off", "muted"]) assert.equal(typeof localeAt(locale, `voice_audition.blocked.${block}`), "string", block);
    // An RVC card's own reasons; it shares monitor_off and muted with the TTS cards.
    for (const block of ["values_invalid", "conversion_running", "input_missing"]) assert.equal(typeof localeAt(locale, `voice_audition.rvc_blocked.${block}`), "string", block);
    for (const code of CODES) assert.equal(typeof localeAt(locale, `voice_audition.errors.${code}`), "string", code);
    for (const code of RVC_CODES) assert.equal(typeof localeAt(locale, `voice_audition.rvc_errors.${code}`), "string", code);
});
