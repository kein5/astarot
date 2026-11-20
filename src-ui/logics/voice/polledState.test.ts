import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createStore } from "jotai/vanilla";
import type { Atom, PrimitiveAtom } from "jotai/vanilla";
import { hooks, loadModule, unchecked } from "../test/hookHarness.ts";
import type { HookRuntime } from "../test/hookHarness.ts";
import * as polledState from "../common/polledState.ts";
import * as routeState from "./routeState.ts";
import * as pendingVoiceRequest from "./pendingVoiceRequest.ts";
import type { ModelDownloadState } from "./useModelDownloads.ts";

type VoiceModule = typeof import("./useVoice.ts");
type DownloadsModule = typeof import("./useModelDownloads.ts");
type ServersModule = typeof import("./useSpeechServers.ts");

// Loads a hook's module with the polled state it shares, and draws the hook that name picks.
async function setup<M, R>(file: string, name: (module: M) => () => R) {
    const runtime = hooks();
    const module = await loadModule<M>(new URL(file, import.meta.url), runtime, {
        "../common/polledState.ts": polledState, "./routeState": routeState,
        "./pendingVoiceRequest.ts": pendingVoiceRequest,
    });
    const useHook = name(module);
    const render = () => runtime.render(useHook);
    return { runtime, render, useHook };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// The harness makes every atom with atom(initial), so each can be set as well as read.
const writable = (target: Atom<unknown>): target is PrimitiveAtom<unknown> => "write" in target;
const observe = (runtime: HookRuntime, value: unknown) => {
    const target = runtime.targets.find(target => runtime.store.get(target) === value);
    assert.ok(target && writable(target));
    let changes = 0;
    const unsubscribe = runtime.store.sub(target, () => changes++);
    return { target, get changes() { return changes; }, unsubscribe };
};
// The loops below name the field they read and the update they call.
const read = (value: unknown, name: string): unknown => {
    assert.ok(value && typeof value === "object");
    return Reflect.get(value, name);
};
const call = (hook: object, name: string, ...args: unknown[]): unknown => {
    const method = Reflect.get(hook, name);
    assert.ok(typeof method === "function");
    return Reflect.apply(method, hook, args);
};

for (const [field, update, first, change] of [
    ["status", "updateStatus", { tts_generation: 2, tts_enabled: true, engines: ["one"] }, { tts_enabled: false }],
    ["route", "updateRoute", { generation: 2, requested_muted: false, observed_muted: false }, { requested_muted: true }],
    ["directState", "updateDirectState", { generation: 2, requested: true, mode: "converted", settings: { engine: "rvc" } }, { requested: false }],
] satisfies [string, string, object, object][]) test(`${field}: equal polls do not notify; an overtaken response cannot roll back state`, async () => {
    const { runtime, render } = await setup("./useVoice.ts", (module: VoiceModule) => module.useVoice);
    call(render(), update, { ...first, observation_id: "100" });
    const before = read(render(), field), subscription = observe(runtime, before);
    // The cursor advances even though the rendered state keeps its old ID.
    call(render(), update, { ...clone(first), observation_id: "103" });
    call(render(), update, { ...clone(first), ...change, observation_id: "102" });
    assert.equal(read(render(), field), before);
    assert.equal(subscription.changes, 0);
    call(render(), update, { ...clone(first), ...change, observation_id: "104" });
    assert.notEqual(read(render(), field), before);
    assert.equal(subscription.changes, 1);
    const changed = read(render(), field);
    call(render(), update, { ...clone(first), observation_id: "104" });
    for (const observation_id of [undefined, "bad", "-1"]) call(render(), update, { ...first, observation_id });
    assert.equal(read(render(), field), changed);
    render().backendStopped();
    const stopped = read(render(), field);
    call(render(), update, { ...first, observation_id: "103" });
    assert.equal(read(render(), field), stopped);
    render().reset();
    call(render(), update, { ...first, observation_id: "1" });
    assert.equal(read(read(render(), field), "observation_id"), "1");
    subscription.unsubscribe();
});

test("separate voice hook instances share ordering before another render", async () => {
    const { runtime, useHook } = await setup("./useVoice.ts", (module: VoiceModule) => module.useVoice);
    const render = () => runtime.render(() => [useHook(), useHook()] as const);
    const [first, second] = render();
    first.updateRoute({ observation_id: "100", observed_muted: false });
    const before = render()[0].route;
    second.updateRoute({ observation_id: "103", observed_muted: false });
    first.updateRoute({ observation_id: "102", observed_muted: true });
    assert.equal(render()[0].route, before);
    assert.equal(render()[1].route, before);
});

test("observation cursors are isolated by store and atom", async () => {
    const { runtime, render } = await setup("./useVoice.ts", (module: VoiceModule) => module.useVoice);
    const firstStore = runtime.store;
    const first = { observation_id: "100", tts_generation: 1, tts_enabled: true };
    render().updateStatus(first);
    render().updateStatus({ ...first, observation_id: "200" });
    render().updateRoute({ observation_id: "2", ready: true });
    assert.equal(render().route.ready, true);
    runtime.store = createStore();
    render().updateStatus({ ...first, observation_id: "1", tts_enabled: false });
    assert.equal(render().status.tts_enabled, false);
    runtime.store = firstStore;
    render().updateStatus({ ...first, observation_id: "150", tts_enabled: false });
    assert.equal(render().status, first);
});

for (const [field, update, pending, error, command, first, acknowledged] of [
    ["status", "updateStatus", "ttsPending", "ttsError", "/run/enable_tts",
        { tts_generation: 3, tts_enabled: false }, { tts_generation: 4, tts_enabled: true }],
    ["directState", "updateDirectState", "directPending", "directError", "/run/start_direct_voice",
        { generation: 3, requested: false, mode: "off" }, { generation: 4, requested: true, mode: "converted", settings: { engine: "rvc" } }],
] satisfies [string, string, string, string, string, object, object][]) test(`${pending}: acknowledgement runs even when the accepted snapshot keeps its reference`, async t => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { runtime, render } = await setup("./useVoice.ts", (module: VoiceModule) => module.useVoice);
    call(render(), update, { ...first, observation_id: "100" });
    await render().send(command, { mode: "converted", options: { engine: "rvc" } });
    const request = read(render(), pending), pendingTarget = observe(runtime, request).target;
    vi.advanceTimersByTime(5000);
    assert.equal(read(render(), error), "voice_request_unconfirmed");
    call(render(), update, { ...acknowledged, observation_id: "102" });
    assert.equal(read(render(), pending), null);
    assert.equal(read(render(), error), null);
    const before = read(render(), field), subscription = observe(runtime, before);
    // Recreate an outstanding acknowledgement independently of rendered state.
    runtime.store.set(pendingTarget, request);
    call(render(), update, { ...clone(acknowledged), observation_id: "104" });
    assert.equal(read(render(), pending), null);
    assert.equal(read(render(), field), before);
    assert.equal(subscription.changes, 0);
    runtime.store.set(pendingTarget, request);
    call(render(), update, { ...acknowledged, observation_id: "103" });
    assert.equal(read(render(), pending), request);
    subscription.unsubscribe();
});

test("TTS generation guard and direct stop/error acknowledgement conditions remain intact", async t => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { render } = await setup("./useVoice.ts", (module: VoiceModule) => module.useVoice);
    render().updateStatus({ observation_id: "1", tts_generation: 5, tts_enabled: true });
    const status = render().status;
    render().updateStatus({ observation_id: "2", tts_generation: 4, tts_enabled: false });
    assert.equal(render().status, status);
    render().updateDirectState({ observation_id: "1", generation: 5, requested: true });
    await render().send("/run/stop_direct_voice");
    render().updateDirectState({ observation_id: "2", generation: 6, requested: false, stopping: true });
    assert.ok(render().directPending);
    render().updateDirectState({ observation_id: "3", generation: 6, requested: false, stopping: false });
    assert.equal(render().directPending, null);
    await render().send("/run/start_direct_voice", { mode: "converted" });
    render().updateDirectState({ observation_id: "4", generation: 7, requested: false, error: "failed" });
    assert.equal(render().directPending, null);
});

test("downloads and hardware skip equal observations, reject overtaken responses and reset their cursors", async () => {
    const { runtime, render } = await setup("./useModelDownloads.ts", (module: DownloadsModule) => module.useModelDownloads);
    for (const [field, update, first, changed] of [
        ["state", "updateState", { jobs: { model: { phase: "downloading", bytes: 10 } } }, { jobs: { model: { phase: "downloading", bytes: 20 } } }],
        ["hardware", "updateHardware", { phase: "ready", devices: [{ name: "gpu", memory: 8 }] }, { phase: "failed", devices: [] }],
    ] satisfies [string, string, object, object][]) {
        call(render(), update, { ...first, observation_id: "100" });
        const before = read(render(), field), subscription = observe(runtime, before);
        call(render(), update, { ...clone(first), observation_id: "103" });
        call(render(), update, { ...changed, observation_id: "102" });
        assert.equal(read(render(), field), before);
        assert.equal(subscription.changes, 0);
        call(render(), update, { ...changed, observation_id: "104" });
        assert.notEqual(read(render(), field), before);
        render().reset();
        call(render(), update, { ...first, observation_id: "1" });
        assert.equal(read(read(render(), field), "observation_id"), "1");
        subscription.unsubscribe();
    }
    const snapshot = { observation_id: "5", jobs: {} };
    assert.equal(render().updateState(snapshot), true);
    const before = render().state;
    assert.equal(render().updateState({ ...snapshot, observation_id: "8" }), true);
    assert.equal(render().state, before);
    await render().send("/run/start_model_download", { id: "model" });
    assert.ok(render().pending);
    // A job with only its phase: the acknowledgement reads no more of it.
    render().acknowledge(unchecked<ModelDownloadState>({ observation_id: "7", jobs: { model: { phase: "queued" } } }), "/run/start_model_download");
    assert.equal(render().pending, null);
    assert.equal(render().state, before);
});

test("speech servers preserve rows and pending objects while retaining generation/phase guards", async () => {
    const { runtime, render } = await setup("./useSpeechServers.ts", (module: ServersModule) => module.useSpeechServers);
    const first = { japanese: { generation: 2, state: "ready", base_url: "local" }, asr: { generation: 1, state: "stopped" } };
    render().updateState(first);
    const state = render().state, pending = render().pending, subscription = observe(runtime, state);
    render().updateState(clone(first));
    assert.equal(render().state, state);
    assert.equal(render().pending, pending);
    assert.equal(subscription.changes, 0);
    render().updateState({ japanese: { ...first.japanese, base_url: "changed" } });
    assert.notEqual(render().state, state);
    assert.equal(render().state.asr, state.asr);
    await render().send("/run/stop_speech_server", { profile: "japanese" });
    const request = render().pending, target = observe(runtime, request).target;
    const stopped = { japanese: { generation: 3, state: "stopped", base_url: null } };
    render().updateState(stopped);
    assert.deepEqual(render().pending, {});
    const confirmed = render().state;
    runtime.store.set(target, request);
    render().updateState(clone(stopped));
    assert.deepEqual(render().pending, {});
    assert.equal(render().state, confirmed);
    render().updateState(first);
    assert.equal(render().state, confirmed);
    render().updateState({ japanese: { generation: 3, state: "ready" } });
    const ready = render().state;
    render().updateState({ japanese: { generation: 3, state: "preparing" } });
    assert.equal(render().state, ready);
    subscription.unsubscribe();
});

test("speech server devices keep what the CPU and GPU choices run on, and nothing unknown", async () => {
    const { render } = await setup("./useSpeechServers.ts", (module: ServersModule) => module.useSpeechServers);
    assert.deepEqual(render().builds, { cpu_build: null, gpu_build: null });
    // Linux: the CPU build of its own, and a Vulkan build that does not start on this PC.
    render().updateDevices({ devices: [], cpu_build: "separate", gpu_build: "unavailable" });
    assert.deepEqual(render().builds, { cpu_build: "separate", gpu_build: "unavailable" });
    // Windows: the CPU runs on the one Vulkan build.
    render().updateDevices({ devices: [{ name: "Vulkan0", kind: "gpu", label: "GPU" }], cpu_build: "shared", gpu_build: "ready" });
    assert.deepEqual(render().builds, { cpu_build: "shared", gpu_build: "ready" });
    assert.equal(render().devices.length, 1);
    // An answer without the fields (an older backend) or with unknown values shows nothing extra.
    render().updateDevices({ devices: [], cpu_build: "other", gpu_build: 3 });
    assert.deepEqual(render().builds, { cpu_build: null, gpu_build: null });
    render().updateDevices({ devices: [], cpu_build: "separate" });
    render().updateDevices(null);
    assert.deepEqual(render().builds, { cpu_build: "separate", gpu_build: null });
    render().reset();
    assert.deepEqual(render().builds, { cpu_build: null, gpu_build: null });
});