import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { test, vi } from "vitest";
import { loadBridgeRoutes, loadBridgeStore, settingAtom } from "./test/bridgeHarness.ts";
import { loadModule } from "./test/hookHarness.ts";
import * as ioFlow from "./flow/ioFlow.ts";
import * as realtimeCaptions from "./transcription/realtimeCaptionState.ts";
import { keepRecentLogs } from "./common/messageLogLimit.ts";
import { atom } from "jotai/vanilla";
import { NONE, RECEIVE_ONLY, notices, receivers, requests, uiOnly } from "./test/ipcReference.ts";
import { loadRecordedRoutes } from "./test/routeRecorder.ts";

test("the reference lists the requests, the notices and the UI's own routes", () => {
    // A heading or table that changes shape would empty a set and pass every route below.
    assert.ok(requests.size > 400 && notices.size > 50 && uiOnly.size > 20, `${requests.size} ${notices.size} ${uiOnly.size}`);
});

test("every route the UI listens on is an endpoint of the IPC reference", async () => {
    const { routeTable } = await loadBridgeRoutes();
    assert.ok(routeTable.length > 300, String(routeTable.length));
    const unknown = routeTable.map(route => route.endpoint)
        .filter(endpoint => !requests.has(endpoint) && !notices.has(endpoint) && !uiOnly.has(endpoint));
    assert.deepEqual(unknown, []);
});

test("every route of the settings reaches a method of its settings hook", async () => {
    // A route whose hook or method the settings do not have logs it and does nothing.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { routeTable } = await loadBridgeRoutes();
    const missing = [...errors.mock.calls, ...warnings.mock.calls]
        .filter(([message]) => message === "Method not found." || String(message).startsWith("Hook not found on namespace"));
    assert.deepEqual(missing, []);
    // The settings make most routes; each names a hook of a settings category.
    assert.ok(routeTable.filter(route => route.hook_name?.startsWith("use")).length > 300);
});

test("every endpoint of the reference is routed to the receiver the reference names, or not routed", async () => {
    // A row that changes shape would drop out of the map and pass below.
    assert.equal(receivers.size, new Set([...requests, ...notices]).size);
    const { routeTable } = await loadRecordedRoutes({ settings: true });
    const routed = new Map(routeTable.map(({ endpoint, hook_name, method_name }) =>
        [endpoint, hook_name === null ? RECEIVE_ONLY : `${hook_name}.${method_name}`]));
    const differing = [...receivers].filter(([endpoint, receiver]) => (routed.get(endpoint) ?? NONE) !== receiver)
        .map(([endpoint, receiver]) => `${endpoint}: ${routed.get(endpoint) ?? NONE}, the reference ${receiver}`);
    assert.deepEqual(differing, []);
    // The routes only the UI has (the flow panel's traces, the realtime captions and routes the settings make).
    assert.deepEqual([...uiOnly].filter(endpoint => !routed.has(endpoint)), []);
});

test("the route table lists each endpoint once", async () => {
    const { routeTable } = await loadRecordedRoutes({ settings: true });
    const endpoints = routeTable.map(route => route.endpoint);
    assert.deepEqual(endpoints.filter((endpoint, index) => endpoints.indexOf(endpoint) !== index), []);
});

test("an answer of 200 goes to its route's receiver with its result", async () => {
    const r = await loadRecordedRoutes({ settings: true });
    const missed: string[] = [];
    let routed = 0;
    for (const { endpoint, hook_name, method_name, url_method_name } of r.routeTable) {
        if (hook_name === null || method_name === null || url_method_name !== undefined) continue;
        routed++;
        r.clear();
        const result = { answer: endpoint };
        r.receive(endpoint, 200, result);
        // The model downloads' acknowledgements are told which request they answer.
        const expected = hook_name === "useModelDownloads" && method_name.startsWith("acknowledge") ? [result, endpoint] : [result];
        if (!isDeepStrictEqual(r.argsOf(`${hook_name}.${method_name}`), [expected])) missed.push(endpoint);
    }
    assert.ok(routed > 300, String(routed));
    assert.deepEqual(missed, []);
});

test("a route that only takes its answer hands the result to no hook and logs nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadRecordedRoutes({ settings: true });
    const receiveOnly = r.routeTable.filter(route => route.hook_name === null).map(route => route.endpoint);
    assert.ok(receiveOnly.length > 20, String(receiveOnly.length));
    const handed: string[] = [];
    for (const endpoint of receiveOnly) {
        r.clear();
        const result = { answer: endpoint };
        r.receive(endpoint, 200, result);
        handed.push(...r.calls.filter(call => call.args.includes(result)).map(call => `${endpoint}: ${call.name}`));
    }
    assert.deepEqual(handed, []);
    assert.deepEqual(errors.mock.calls, []);
});

// The two answers that save an auth key with its URL (#413): the URL and the key go to their
// settings, which the translation and transcription pages show.
for (const [endpoint, url, key] of [
    ["/set/data/openai_compatible_auth_key_and_url", "Atom_OpenAICompatibleURL", "Atom_OpenAICompatibleAuthKey"],
    ["/set/data/custom_whisper_auth_key_and_url", "Atom_CustomWhisperURL", "Atom_CustomWhisperAuthKey"],
]) test(`${endpoint} stores the URL and the auth key it saved`, async () => {
    const s = await loadBridgeRoutes();
    s.receiveRoutes({ endpoint, status: 200, result: { url: "http://127.0.0.1:1234/v1", auth_key: "sk-test" } });
    assert.equal(s.runtime.store.get(settingAtom(s.stores.dynamicStoreRegistry, url)).data, "http://127.0.0.1:1234/v1");
    assert.equal(s.runtime.store.get(settingAtom(s.stores.dynamicStoreRegistry, key)).data, "sk-test");
});

// The downloadable weight's template makes its get and set routes twice; the one route left of each
// reaches the weight's settings hook.
test("the weight's get and set answers reach its settings hook", async () => {
    const s = await loadBridgeRoutes();
    const weights = settingAtom(s.stores.dynamicStoreRegistry, "Atom_CTranslate2WeightTypeStatus");
    for (const endpoint of ["/get/data/ctranslate2_weight", "/set/data/ctranslate2_weight"]) {
        const before = s.runtime.store.get(weights);
        s.receiveRoutes({ endpoint, status: 200, result: [] });
        assert.notStrictEqual(s.runtime.store.get(weights), before, endpoint);
    }
});

// The routes only the UI has, through their real hooks: the flow panel's traces and the realtime
// captions in the message log.
test("a trace of the flow panel reaches the panel's traces", async () => {
    let read = () => [] as unknown;
    const r = await loadRecordedRoutes({ hooks: async runtime => {
        const { stores } = await loadBridgeStore(runtime);
        const { useIoFlow } = await loadModule<typeof import("./flow/useIoFlow.ts")>(new URL("./flow/useIoFlow.ts", import.meta.url), runtime, {
            "@store": stores, jotai: { ...runtime.jotai, getDefaultStore: () => runtime.store }, "./ioFlow.ts": ioFlow,
        });
        read = () => runtime.store.get(stores.Atom_IoTraces).data;
        return { useIoFlow };
    } });
    const trace = { id: "trace-1", input: "voice", text: "hello", stages: {}, outputs: {} };
    r.receive("/run/io_trace", 200, trace);
    assert.deepEqual(read(), [trace]);
});

test("a realtime caption reaches the message log", async () => {
    let rows = () => [] as unknown[];
    const r = await loadRecordedRoutes({ hooks: async runtime => {
        const { stores } = await loadBridgeStore(runtime);
        const { useMessage } = await loadModule<typeof import("./common/useMessage.ts")>(new URL("./common/useMessage.ts", import.meta.url), runtime, {
            "@store": stores,
            "../transcription/useRealtimeASR": { realtimeStateAtom: atom({ mic: { generation: 4, requested: true, state: "ready", namespace: "session" } }),
                realtimeRetiredAtom: atom<string[]>([]) },
            "../transcription/realtimeCaptionState": realtimeCaptions, "./messageLogLimit": { keepRecentLogs },
        });
        rows = () => runtime.store.get(stores.Atom_MessageLogs).data;
        return { useMessage };
    } });
    r.receive("/run/realtime_caption", 200, { source: "mic", namespace: "session", generation: 4, item_id: "one", revision: 1, state: "partial", text: "hello" });
    assert.equal(rows().length, 1);
});
