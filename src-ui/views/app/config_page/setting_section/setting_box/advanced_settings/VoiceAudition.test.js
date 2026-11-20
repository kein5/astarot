import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import * as shapes from "../../../../../../logics/voice/voiceAudition.ts";

// The audition's button and note on a TTS card (#415), with the voice, the servers and the
// audition as the card reads them.
async function card(context, { monitor = "on", server = "ready", muted = false, audition = shapes.IDLE_AUDITION } = {}) {
    const runtime = hooks(), pressed = [];
    context.onTestFinished(() => runtime.unmount());
    const module = await loadModule(new URL("./VoiceAudition.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: { monitor }, route: { requested_muted: muted }, status: {} }) },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ state: { japanese: { state: server } } }) },
        "../../../../../../logics/voice/useVoiceAudition": { useVoiceAudition: () => ({ audition,
            start: profile => pressed.push(["start", profile]), stop: () => pressed.push(["stop"]) }) },
        "../../../../../../logics/voice/voiceAudition": shapes,
    });
    const button = (status = "in_use", target = "japanese") => runtime.render(module.AuditionButton, { target, status });
    const note = (status = "in_use", target = "japanese") => runtime.render(module.AuditionNote, { target, status });
    return { button, note, pressed };
}

test("the model in use with its server running plays on a press, and nothing plays by itself", async context => {
    const c = await card(context);
    const button = c.button();
    assert.equal(button.type, "button");
    assert.equal(button.props.children, "voice_audition.play");
    assert.equal(button.props.title, "voice_audition.tooltip");
    assert.deepEqual(c.pressed, [], "rendering pressed it");
    button.props.onClick();
    assert.deepEqual(c.pressed, [["start", "japanese"]]);
    assert.equal(c.note(), null);
});

test("other cards and other uses say why instead of showing a dead button", async context => {
    for (const [options, status, reason] of [[{}, "downloaded", "not_in_use"], [{ server: "stopped" }, "in_use", "server_stopped"],
        [{ monitor: "off" }, "in_use", "monitor_off"], [{ muted: true }, "in_use", "muted"]]) {
        const c = await card(context, options);
        assert.equal(c.button(status), null, reason);
        const note = c.note(status);
        assert.deepEqual([note.type, note.props.children], ["p", `voice_audition.blocked.${reason}`]);
    }
    // A model not downloaded has its download as the step; RVC and recognition have no audition.
    const c = await card(context);
    assert.equal(c.button("not_downloaded"), null);
    assert.equal(c.note("not_downloaded"), null);
    assert.equal(c.button("in_use", "asr"), null);
    assert.equal(c.note("in_use", "rvc"), null);
});

test("a press waiting for the engine keeps its focus and ignores presses; one playing is the stop", async context => {
    const waiting = await card(context, { audition: { phase: "pending", profile: "japanese", run: null, error: null } });
    const button = waiting.button();
    assert.deepEqual([button.props["aria-disabled"], button.props["aria-busy"], button.props.disabled], [true, true, undefined]);
    assert.equal(button.props.children, "voice_audition.pending");
    button.props.onClick();
    assert.deepEqual(waiting.pressed, []);
    // While it plays the stop stays reachable, even after the mute that is ending it.
    const playing = await card(context, { muted: true, audition: { phase: "playing", profile: "japanese", run: 3, error: null } });
    const stop = playing.button();
    assert.equal(stop.props.children, "voice_audition.stop");
    stop.props.onClick();
    assert.deepEqual(playing.pressed, [["stop"]]);
    assert.equal(playing.note(), null);
    // Another profile's audition leaves this card as it is.
    const other = await card(context, { audition: { phase: "playing", profile: "multilingual", run: 3, error: null } });
    assert.equal(other.button().props.children, "voice_audition.play");
});

test("a refused or failed audition says why on the card it was pressed on, until something else stands in the way", async context => {
    const failed = { phase: "idle", profile: "japanese", run: 2, error: "voice_audition_server_not_ready" };
    const c = await card(context, { audition: failed });
    const alert = c.note();
    assert.equal(alert.props.role, "alert");
    // Its own text, or the general one when the code has none (the test's t() returns the keys).
    assert.deepEqual(alert.props.children, ["voice_audition.errors.voice_audition_server_not_ready", "voice_audition.errors.voice_audition_failed"]);
    // Cards that are not in use keep their own note.
    assert.equal(c.note("downloaded").props.children, "voice_audition.blocked.not_in_use");
    // What stands in the way now replaces the older failure.
    const muted = await card(context, { muted: true, audition: failed });
    assert.equal(muted.note().props.children, "voice_audition.blocked.muted");
});
