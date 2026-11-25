import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as shapes from "../../../../../../logics/voice/voiceAudition.ts";

interface CardOptions {
    monitor?: string;
    server?: string;
    muted?: boolean;
    // A live conversion running (direct voice in converted mode).
    converting?: boolean;
    audition?: shapes.AuditionView;
}

const VALUES = { pitch: 3, index_rate: 0.5 };
const MODEL = "user-0123456789ab";
const MIC = { cookie: "1", serial: "42", name: "Mic (Realtek)", media_class: "Audio/Source" };

// The button inside the app's tooltip, which keeps no box of its own (bare) so the button keeps its
// place in the card's row of actions: the button, its words, and what the tooltip says, which is
// also the button's description, kept in the page while the tooltip is closed.
const inTooltip = (tree: TreeNode | null) => {
    if (!tree) return null;
    assert.deepEqual([tree.type, tree.props.bare, tree.props.placement], ["tooltip", true, undefined]);
    const button: TreeNode = tree.props.children;
    const [words, about] = button.props.children;
    assert.deepEqual([about.type, about.props.hidden, about.props.children], ["span", true, tree.props.title]);
    assert.ok(about.props.id);
    assert.equal(button.props["aria-describedby"], about.props.id);
    assert.equal(button.props.title, undefined, "no native title");
    return { button, words, tip: tree.props.title };
};

// The audition's button and note on a TTS or RVC card (#415), with the voice, the servers and the
// audition as the card reads them.
async function card(context: TestContext, { monitor = "on", server = "ready", muted = false, converting = false, audition = shapes.IDLE_AUDITION }: CardOptions = {}) {
    const runtime = hooks(), pressed: unknown[][] = [];
    context.onTestFinished(() => runtime.unmount());
    const module = await loadModule<typeof import("./VoiceAudition.tsx")>(new URL("./VoiceAudition.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: { monitor }, route: { requested_muted: muted }, status: {},
            directState: converting ? { mode: "converted", requested: true } : { mode: "passthrough", requested: true } }) },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ state: { japanese: { state: server } } }) },
        "../../../../../../logics/voice/useVoiceAudition": { useVoiceAudition: () => ({ audition,
            start: (profile: string) => pressed.push(["start", profile]), startRvc: (entry: string, values: unknown, input: unknown) => pressed.push(["startRvc", entry, values, input]),
            stop: () => pressed.push(["stop"]) }) },
        "../../../../../../logics/voice/voiceAudition": shapes,
        // The words' key, with the seconds an RVC sample records where they are given.
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: { seconds?: number }) => options?.seconds ? `${key}:${options.seconds}` : key }) },
    });
    const button = (status = "in_use", target = "japanese") => inTooltip(runtime.render(module.AuditionButton, { target, status }));
    const note = (status = "in_use", target = "japanese") => runtime.render(module.AuditionNote, { target, status });
    // An RVC card: its model's id, the form's values (null while they are not valid) and the input.
    const rvcButton = (status = "downloaded", values: shapes.RvcAuditionValues | null = VALUES, entry = MODEL, input: unknown = MIC) =>
        inTooltip(runtime.render(module.AuditionButton, { target: "rvc", status, entry, values, input }));
    const rvcNote = (status = "downloaded", values: shapes.RvcAuditionValues | null = VALUES, entry = MODEL, input: unknown = MIC) =>
        runtime.render(module.AuditionNote, { target: "rvc", status, entry, values, input });
    return { button, note, rvcButton, rvcNote, pressed };
}

const tts = (view: Partial<shapes.AuditionView>): shapes.AuditionView => ({ ...shapes.IDLE_AUDITION, kind: "tts", profile: "japanese", ...view });
const rvc = (view: Partial<shapes.AuditionView>): shapes.AuditionView => ({ ...shapes.IDLE_AUDITION, kind: "rvc", entry: MODEL, ...view });

test("the model in use with its server running plays on a press, and nothing plays by itself", async context => {
    const c = await card(context);
    const drawn = c.button();
    assert.ok(drawn);
    const { button } = drawn;
    assert.equal(button.type, "button");
    assert.equal(drawn.words, "voice_audition.play");
    // Ready to play: the plain look, and nothing waits.
    assert.deepEqual([button.props.className, button.props["aria-disabled"], button.props["aria-busy"]], [undefined, undefined, undefined]);
    // What the sample does: the app's tooltip and the button's description, no longer a native title.
    assert.equal(drawn.tip, "voice_audition.tooltip");
    assert.equal(button.props["data-voice-audition"], "japanese");
    assert.deepEqual(c.pressed, [], "rendering pressed it");
    button.props.onClick();
    assert.deepEqual(c.pressed, [["start", "japanese"]]);
    assert.equal(c.note(), null);
});

test("other cards and other uses say why instead of showing a dead button", async context => {
    const cases: [CardOptions, string, string][] = [[{}, "downloaded", "not_in_use"], [{ server: "stopped" }, "in_use", "server_stopped"],
        [{ monitor: "off" }, "in_use", "monitor_off"], [{ muted: true }, "in_use", "muted"]];
    for (const [options, status, reason] of cases) {
        const c = await card(context, options);
        assert.equal(c.button(status), null, reason);
        const note = c.note(status);
        assert.ok(note);
        assert.deepEqual([note.type, note.props.children], ["p", `voice_audition.blocked.${reason}`]);
    }
    // A model not downloaded has its download as the step; recognition has no audition, and an
    // RVC card without its model's id has none either.
    const c = await card(context);
    assert.equal(c.button("not_downloaded"), null);
    assert.equal(c.note("not_downloaded"), null);
    assert.equal(c.button("in_use", "asr"), null);
    assert.equal(c.note("in_use", "rvc"), null);
});

test("a press waiting for the engine keeps its focus and ignores presses; one playing is the stop", async context => {
    const waiting = await card(context, { audition: tts({ phase: "pending" }) });
    const pending = waiting.button();
    assert.ok(pending);
    const { button } = pending;
    assert.deepEqual([button.props["aria-disabled"], button.props["aria-busy"], button.props.disabled], [true, true, undefined]);
    assert.deepEqual([pending.words, pending.tip], ["voice_audition.pending", "voice_audition.tooltip"]);
    button.props.onClick();
    assert.deepEqual(waiting.pressed, []);
    // While it plays the stop stays reachable, even after the mute that is ending it.
    const playing = await card(context, { muted: true, audition: tts({ phase: "playing", stage: "playing", run: 3 }) });
    const stop = playing.button();
    assert.ok(stop);
    assert.deepEqual([stop.words, stop.tip], ["voice_audition.stop", "voice_audition.tooltip"]);
    // The stop is the quiet look of the forms, and it does not wait.
    assert.deepEqual([stop.button.props.className, stop.button.props["aria-disabled"], stop.button.props["aria-busy"]], ["quiet", undefined, undefined]);
    stop.button.props.onClick();
    assert.deepEqual(playing.pressed, [["stop"]]);
    assert.equal(playing.note(), null);
    // Another profile's audition, or an RVC card's, leaves this card as it is.
    for (const audition of [tts({ phase: "playing", profile: "multilingual", run: 3 }), rvc({ phase: "playing", stage: "playing", run: 3 })]) {
        const other = await card(context, { audition });
        const play = other.button();
        assert.ok(play);
        assert.equal(play.words, "voice_audition.play");
    }
});

test("a refused or failed audition says why on the card it was pressed on, until something else stands in the way", async context => {
    const failed = tts({ phase: "idle", run: 2, error: "voice_audition_server_not_ready" });
    const c = await card(context, { audition: failed });
    const alert = c.note();
    assert.ok(alert);
    assert.equal(alert.props.role, "alert");
    // Its own text, or the general one when the code has none (the test's t() returns the keys).
    assert.deepEqual(alert.props.children, ["voice_audition.errors.voice_audition_server_not_ready", "voice_audition.errors.voice_audition_failed"]);
    // Cards that are not in use keep their own note.
    const own = c.note("downloaded");
    assert.ok(own);
    assert.equal(own.props.children, "voice_audition.blocked.not_in_use");
    // What stands in the way now replaces the older failure.
    const muted = await card(context, { muted: true, audition: failed });
    const blocked = muted.note();
    assert.ok(blocked);
    assert.equal(blocked.props.children, "voice_audition.blocked.muted");
});

test("an RVC card plays its model whether in use or not, with the form's values and the chosen input, on a press only", async context => {
    const c = await card(context);
    for (const status of ["downloaded", "in_use", "ready"]) {
        const drawn = c.rvcButton(status);
        assert.ok(drawn, status);
        assert.deepEqual([drawn.words, drawn.tip, drawn.button.props["data-voice-audition"]],
            ["voice_audition.play", `voice_audition.rvc_tooltip:${shapes.RVC_AUDITION_SECONDS}`, MODEL]);
        assert.equal(c.rvcNote(status), null);
    }
    assert.deepEqual(c.pressed, [], "rendering pressed it");
    c.rvcButton()?.button.props.onClick();
    assert.deepEqual(c.pressed, [["startRvc", MODEL, VALUES, MIC]]);
    // Not on this PC: its download or registration is the step, and nothing more is said.
    assert.equal(c.rvcButton("not_downloaded"), null);
    assert.equal(c.rvcNote("missing"), null);
});

test("an RVC card says why it cannot play: the form's values, a conversion, no input, the monitor, the mute", async context => {
    const cases: [CardOptions, shapes.RvcAuditionValues | null, unknown, string][] = [[{}, null, MIC, "values_invalid"], [{ converting: true }, VALUES, MIC, "conversion_running"],
        [{}, VALUES, null, "input_missing"], [{ monitor: "off" }, VALUES, MIC, "monitor_off"], [{ muted: true }, VALUES, MIC, "muted"]];
    for (const [options, values, input, reason] of cases) {
        const c = await card(context, options);
        assert.equal(c.rvcButton("downloaded", values, MODEL, input), null, reason);
        const note = c.rvcNote("downloaded", values, MODEL, input);
        assert.ok(note, reason);
        // Its own wording first; the monitor and the mute share the TTS cards'.
        assert.deepEqual(note.props.children, [`voice_audition.rvc_blocked.${reason}`, `voice_audition.blocked.${reason}`]);
    }
    // Input forwarding without conversion does not hold the worker, and no TTS server is needed.
    const forwarding = await card(context, { converting: false, server: "stopped" });
    assert.ok(forwarding.rvcButton());
});

test("an RVC audition says it records, then prepares, until the converted voice plays, and its failure names its code", async context => {
    const recording = await card(context, { audition: rvc({ phase: "playing", stage: "recording", run: 4 }) });
    assert.deepEqual([recording.rvcButton()?.words, recording.rvcButton()?.tip],
        ["voice_audition.stop", `voice_audition.rvc_tooltip:${shapes.RVC_AUDITION_SECONDS}`], "the recording can be stopped");
    const speak = recording.rvcNote();
    assert.ok(speak);
    assert.deepEqual([speak.props.role, speak.props.children], ["status", `voice_audition.rvc_recording:${shapes.RVC_AUDITION_SECONDS}`]);
    const preparing = await card(context, { audition: rvc({ phase: "playing", stage: "preparing", run: 4 }) });
    const stop = preparing.rvcButton();
    assert.ok(stop);
    assert.equal(stop.words, "voice_audition.stop");
    stop.button.props.onClick();
    assert.deepEqual(preparing.pressed, [["stop"]]);
    const status = preparing.rvcNote();
    assert.ok(status);
    assert.deepEqual([status.props.role, status.props.children], ["status", "voice_audition.rvc_preparing"]);
    // Another model's card stays as it is.
    assert.equal(preparing.rvcButton("downloaded", VALUES, "rvc-saisho")?.words, "voice_audition.play");
    const playing = await card(context, { audition: rvc({ phase: "playing", stage: "playing", run: 4 }) });
    assert.equal(playing.rvcNote(), null);
    // The worker's code, or the microphone's (voice.input_errors has both).
    for (const code of ["vc_gpu_unavailable", "asr_capture_stream_create_failed"]) {
        const failed = await card(context, { audition: rvc({ phase: "idle", run: 4, error: code }) });
        const alert = failed.rvcNote();
        assert.ok(alert);
        assert.deepEqual(alert.props.children, [`voice_audition.rvc_errors.${code}`, `voice_audition.errors.${code}`,
            `voice.input_errors.${code}`, "voice_audition.rvc_errors.voice_audition_failed"]);
    }
});
