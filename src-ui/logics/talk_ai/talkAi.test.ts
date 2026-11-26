import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
    IDLE_STATUS, INTERVAL_CHOICES_MS, LONG_EDGE_CHOICES, MANAGED_TTS, audioRequest, choicesWith, errorKeys, isActive, readCatalog, readKey,
    readSources, readStatus, screenRequest, seconds, sessionRequest, startRequest, virtualMicDevice,
} from "./talkAi.ts";
import { AUDIO, INITIAL_VIEW, SCREEN, START, answered, refused, withStatus } from "./talkView.ts";
import type { TalkView } from "./talkView.ts";
import { FEATURE_TABS, SETTINGS_MENU_TABS, isTabAvailable } from "../configs/settingsMenu.ts";
import { ALWAYS_SHOWN_TABS, isTabShown } from "../configs/usagePresets.ts";
import { EXPERIMENTAL_FEATURES, experimentalFeatureLeadKey } from "../configs/experimentalFeatures.ts";

const OPENAI = { id: "openai", name: "OpenAI Realtime", vision: true, cloud: true, destination: "wss://api.openai.com/v1/realtime" };
const VLLM = { id: "vllm_omni", name: "vLLM-Omni", vision: false, cloud: false, destination: "ws://127.0.0.1:8000/v1/realtime",
    recommended_model: "Qwen3-Omni", minimum_gpu_memory_gib: 24, recommended_gpu_memory_gib: 32 };

test("a status the core did not send in its shape is no session, and nothing shows as sent", () => {
    assert.deepEqual(readStatus(null), IDLE_STATUS);
    assert.deepEqual(readStatus({ phase: "talking", session_id: "1", sending_audio: "yes" }), IDLE_STATUS);
    const ready = readStatus({ session_id: 3, phase: "ready", error: null, sending_audio: true, sending_screen: false, screen_source: "window" });
    assert.deepEqual(ready, { session_id: 3, phase: "ready", error: null, sending_audio: true, sending_screen: false, screen_source: "window" });
    assert.equal(isActive(ready), true);
    assert.equal(isActive(readStatus({ session_id: 3, phase: "connecting" })), true);
    assert.equal(isActive(readStatus({ session_id: 3, phase: "failed", error: "talk_unreachable" })), false);
    // The idle status the core sends has no session.
    assert.equal(isActive(readStatus({ session_id: null, phase: "ready" })), false);
});

test("the catalog keeps the entries it can read, with the local entry's model and GPU memory", () => {
    const catalog = readCatalog([OPENAI, VLLM, { id: "broken" }, "text"]);
    assert.deepEqual(catalog.map(item => item.id), ["openai", "vllm_omni"]);
    assert.equal(catalog[0].vision, true);
    assert.equal(catalog[0].recommended_model, null);
    assert.equal(catalog[1].cloud, false);
    assert.equal(catalog[1].recommended_model, "Qwen3-Omni");
    assert.deepEqual([catalog[1].minimum_gpu_memory_gib, catalog[1].recommended_gpu_memory_gib], [24, 32]);
    assert.deepEqual(readCatalog({}), []);
});

test("the key's state never carries the key, and the sources keep the core's order of the known ones", () => {
    assert.deepEqual(readKey({ configured: true, stored: false }), { configured: true, stored: false });
    assert.equal(readKey({ configured: "yes" }), null);
    assert.deepEqual(readSources(["monitor", "window", "screen", "vr"]), ["window", "vr", "monitor"]);
    assert.deepEqual(readSources(null), []);
});

test("the requests carry what the core checks: the destination with each consent, and the indicator", () => {
    assert.deepEqual(startRequest(OPENAI), { provider: "openai", destination: OPENAI.destination, consent: { audio: true } });
    assert.deepEqual(audioRequest(7, { device: null, share: false }), { session_id: 7, indicator_visible: true, output: null });
    // The virtual microphone is named, and its own consent goes with it.
    assert.deepEqual(audioRequest(7, { device: MANAGED_TTS, share: true }),
        { session_id: 7, indicator_visible: true, output: MANAGED_TTS, share_output: true });
    assert.deepEqual(screenRequest(7, OPENAI.destination, "vr"),
        { session_id: 7, destination: OPENAI.destination, source: "vr", consent: { screen: true }, indicator_visible: true });
    assert.deepEqual(sessionRequest(7), { session_id: 7 });
});

test("the virtual microphone is where text to speech speaks: the managed route on Linux, the chosen device otherwise", () => {
    assert.equal(virtualMicDevice({ routing: "managed", output_device: "ignored" }), MANAGED_TTS);
    assert.equal(virtualMicDevice({ routing: "device", output_device: "CABLE Input (VB-Audio Virtual Cable)" }), "CABLE Input (VB-Audio Virtual Cable)");
    assert.equal(virtualMicDevice({ routing: "device", output_device: "" }), null);
    assert.equal(virtualMicDevice(null), null);
    // The name the core plays into for the managed route (native/tts/src/settings.rs).
    const tts = readFileSync(new URL("../../../native/tts/src/settings.rs", import.meta.url), "utf8");
    assert.match(tts, new RegExp(`pub const MANAGED_TTS: &str = "${MANAGED_TTS.replaceAll(".", "\\.")}";`));
});

test("a start keeps its voice for the session it waits for, and an ended session drops it", () => {
    const starting: TalkView = { ...INITIAL_VIEW, pending: "start", partner: { id: "openai", name: "OpenAI Realtime" }, audio: { device: null, share: false } };
    // An older poll that still says idle does not drop the voice of the start waiting for its answer.
    const polled = withStatus(starting, { session_id: null, phase: "idle" });
    assert.deepEqual(polled.audio, { device: null, share: false });
    assert.equal(polled.partner?.name, "OpenAI Realtime");
    // The answer: the session is connecting; the voice waits for it to be ready and for the indicator.
    const connecting = answered(polled, { session_id: 4, phase: "connecting" });
    assert.equal(connecting.pending, null);
    assert.deepEqual(connecting.audio, { device: null, share: false });
    // The session ended before the voice started: nothing waits for it any more.
    const ended = withStatus(connecting, { session_id: 4, phase: "failed", error: "talk_unreachable" });
    assert.equal(ended.audio, null);
    assert.equal(ended.partner, null);
    assert.equal(ended.status.error, "talk_unreachable");
});

test("the virtual microphone is chosen for one conversation: when it ends, the answer goes back to the user's own output", () => {
    const chosen: TalkView = { ...INITIAL_VIEW, output: "virtual_mic" };
    // A status without a conversation, before one starts, keeps the choice.
    assert.equal(withStatus(chosen, { session_id: null, phase: "idle" }).output, "virtual_mic");
    const talking = withStatus(chosen, { session_id: 2, phase: "ready" });
    assert.equal(talking.output, "virtual_mic");
    assert.equal(withStatus(talking, { session_id: 2, phase: "idle" }).output, "headphones");
    assert.equal(withStatus(talking, { session_id: 2, phase: "failed", error: "talk_connection_lost" }).output, "headphones");
});

test("a refusal says why at the request it answered, and drops only what waited for that request", () => {
    const waiting: TalkView = { ...INITIAL_VIEW, pending: "start", audio: { device: null, share: false },
        screen: { source: "window", destination: OPENAI.destination, sent: false } };
    const start = refused(waiting, "talk_key_required", START);
    assert.deepEqual(start.error, { code: "talk_key_required", endpoint: START });
    assert.equal(start.audio, null);
    assert.equal(start.pending, null);
    const screen = refused({ ...waiting, pending: "screen" }, "talk_window_unavailable", SCREEN);
    assert.equal(screen.screen, null);
    assert.deepEqual(screen.audio, waiting.audio);
    assert.equal(refused(waiting, "talk_microphone_missing", AUDIO).audio, null);
});

test("a code without words of its own gets the general sentence", () => {
    assert.deepEqual(errorKeys("talk_unreachable"), ["talk_ai.errors.talk_unreachable", "talk_ai.errors.other"]);
});

test("every code the core and the connection send has words in both languages", async () => {
    const { load } = await import("js-yaml");
    const sources = ["native/core/src/controller/talk_ai.rs", "native/core/src/controller/talk_ai/audio.rs", "native/core/src/controller/talk_ai/screen.rs",
        "native/talk-ai/src/connection.rs", "native/talk-ai/src/protocol.rs", "native/talk-ai/src/talk.rs"]
        .map(path => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8")).join("\n");
    const codes = new Set([...sources.matchAll(/"(talk_[a-z_]+)"/g)].map(match => match[1])
        .filter(code => !code.startsWith("talk_ai") && code !== "talk_settings_invalid"));
    assert.ok(codes.size > 20, String(codes.size));
    for (const language of ["en", "ja"]) {
        const texts = load(readFileSync(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8")) as { talk_ai: { errors: Record<string, string> } };
        for (const code of codes) assert.ok(code in texts.talk_ai.errors, `${language}: ${code}`);
    }
});

test("the screen settings offer their choices, and a value saved outside them as it is", () => {
    assert.deepEqual(choicesWith(INTERVAL_CHOICES_MS, 1000, "interval"), [...INTERVAL_CHOICES_MS]);
    assert.deepEqual(choicesWith(INTERVAL_CHOICES_MS, 1500, "interval"), [500, 1000, 1500, 2000, 5000, 10000]);
    // Out of the core's range: not offered (the core would not have kept it).
    assert.deepEqual(choicesWith(INTERVAL_CHOICES_MS, 20, "interval"), [...INTERVAL_CHOICES_MS]);
    assert.deepEqual(choicesWith(LONG_EDGE_CHOICES, 640, "edge"), [512, 640, 768, 1024, 1536, 2048]);
    assert.deepEqual([seconds(500), seconds(1000), seconds(2500)], ["0.5", "1", "2.5"]);
});

test("the Talk AI page is in the menu only while its feature is on, whatever the usage presets", () => {
    assert.ok(SETTINGS_MENU_TABS.includes("talk_ai"));
    assert.equal(FEATURE_TABS.talk_ai, "talk_ai");
    assert.ok(EXPERIMENTAL_FEATURES.some(feature => feature.id === "talk_ai"));
    // Turning it on adds a page: the switch says so in a sentence that stays on screen.
    assert.equal(experimentalFeatureLeadKey("talk_ai"), "config_page.experimental_features.items.talk_ai.lead");
    assert.equal(isTabAvailable("talk_ai", () => false), false);
    assert.equal(isTabAvailable("talk_ai", id => id === "talk_ai"), true);
    assert.equal(isTabAvailable("translation", () => false), true);
    // The basic preset shows it too: the user added it by turning the feature on.
    assert.ok(ALWAYS_SHOWN_TABS.includes("talk_ai"));
    assert.equal(isTabShown(["basic"], "talk_ai"), true);
});
