import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule, fieldOf } from "../test/hookHarness.ts";
import * as coordinator from "./languageMutationCoordinator.ts";
import type { LanguageMutationState } from "./languageMutationCoordinator.ts";

// The stand-in for jotai the adapter is given (made in setup): what it keeps per atom name, and
// each value it set, in order.
interface FakeAtom {
    state: string;
    data: unknown;
}
interface FakeStorage {
    history: { name: string; value: FakeAtom }[];
    values: Record<string, FakeAtom> & {
        LanguageMutation: { state: string; data: LanguageMutationState & { isResyncing?: boolean } };
        NotificationStatus: { state: string; data: { status?: string } };
    };
}

const atomNames = ["LanguageMutation", "NotificationStatus", "SelectedPresetTabNumber", "SelectedYourLanguages",
    "SelectedTargetLanguages", "SelectedTranslationEngines", "TranslationEngines"];
const getters = ["selected_tab_no", "selected_your_languages", "selected_target_languages", "selected_translation_engines", "selectable_translation_engines"];
const fields = ["SelectedPresetTabNumber", "SelectedYourLanguages", "SelectedTargetLanguages", "SelectedTranslationEngines", "TranslationEngines"];

async function setup() {
    // Load the actual adapter with only its storage and translation replaced: each atom is its
    // name, and jotai's default store keeps the values by name.
    const history: FakeStorage["history"] = [];
    const values: FakeStorage["values"] = {
        ...Object.fromEntries(atomNames.map(name => [name, { state: "ok", data: {} }])),
        SelectedPresetTabNumber: { state: "ok", data: "1" },
        LanguageMutation: { state: "ok", data: { inFlight: null, lastVrResult: null, isResyncing: false } },
        NotificationStatus: { state: "ok", data: {} },
    };
    const store = {
        get: (name: string) => values[name],
        set: (name: string, value: unknown) => {
            values[name] = typeof value === "function" ? value(values[name]) : value;
            history.push({ name, value: structuredClone(values[name]) });
        },
    };
    const adapter = await loadModule<typeof import("./languageMutations.ts")>(new URL("./languageMutations.ts", import.meta.url), hooks(), {
        jotai: { getDefaultStore: () => store },
        "@store": Object.fromEntries(atomNames.map(name => [`Atom_${name}`, name])),
        i18next: { t: (key: string) => key },
        "./languageMutationCoordinator": coordinator,
    });
    const request = (id = "first", source = "vr") => ({ requestId: id, source,
        endpoint: "/set/data/selected_target_languages", expectedSnapshot: adapter.getLanguageSnapshot() });
    const calls: string[] = [];
    const send = async (endpoint: string) => { calls.push(endpoint); return true; };
    return { adapter, history, values, request, calls, send };
}

test("early push does not release the shared write guard", async () => {
    const {adapter,values,request} = await setup();
    try {
        const write = request();
        assert.equal(adapter.beginLanguageMutation(write), true);
        values.SelectedTargetLanguages = {state:"ok",data:{changed:"push"}};
        assert.equal(adapter.canChangeLanguageSettings(), false);
        adapter.receiveLanguageMutation({endpoint:write.endpoint,status:200},async () => true);
        assert.equal(adapter.canChangeLanguageSettings(), true);
    } finally {adapter.resetLanguageMutations();}
});

test("failure publishes resync ownership before its result and retains it until all five GETs", async () => {
    const {adapter,values,history,request,calls,send} = await setup();
    try {
        const write = request();adapter.beginLanguageMutation(write);
        adapter.receiveLanguageMutation({endpoint:write.endpoint,status:500},send);
        assert.equal(calls.length,5);
        const failure = history.find(item => item.name === "LanguageMutation" && fieldOf(item.value, "data", "lastVrResult", "kind") === "failure");
        assert.equal(fieldOf(failure?.value, "data", "isResyncing"),true);
        for (let i=0;i<5;i++) {
            values[fields[i]] = {state:"ok",data:i === 2 ? {partial:"backend value"} : values[fields[i]].data};
            adapter.receiveLanguageMutation({endpoint:`/get/data/${getters[i]}`,status:200},send);
            assert.equal(adapter.canChangeLanguageSettings(),i === 4);
        }
        assert.deepEqual(values.SelectedTargetLanguages.data,{partial:"backend value"});
        assert.equal(values.LanguageMutation.data.lastVrResult?.kind,"failure");
    } finally {adapter.resetLanguageMutations();}
});

test("failed GETs block stale writes; a successful retry restores editing", async () => {
    const {adapter,values,request,send} = await setup();
    try {
        const write=request();adapter.beginLanguageMutation(write);
        adapter.receiveLanguageMutation({endpoint:write.endpoint,status:500},send);
        for (const getter of getters) adapter.receiveLanguageMutation({endpoint:`/get/data/${getter}`,status:500},send);
        assert.equal(values.LanguageMutation.data.isResyncing,false);
        assert.equal(adapter.canChangeLanguageSettings(),false);
        assert.equal(adapter.beginLanguageMutation(request("stale retry")),false);
        for(let i=0;i<5;i++) {
            values[fields[i]] = {...values[fields[i]],state:"ok"};
            adapter.receiveLanguageMutation({endpoint:`/get/data/${getters[i]}`,status:200},send);
        }
        assert.equal(adapter.canChangeLanguageSettings(),true);
    } finally {adapter.resetLanguageMutations();}
});

test("timeout cannot start an old GET batch before a late failing write", async () => {
    const {adapter,values,request,calls,send} = await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
        const write=request();adapter.beginLanguageMutation(write);
        vi.advanceTimersByTime(adapter.LANGUAGE_RESPONSE_WAIT_MS);
        assert.equal(values.LanguageMutation.data.inFlight?.kind,"unconfirmed");
        assert.equal(calls.length,0);
        assert.equal(adapter.beginLanguageMutation(request("retry")),false);
        adapter.receiveLanguageMutation({endpoint:write.endpoint,status:500},send);
        assert.equal(calls.length,5);
        assert.equal(values.LanguageMutation.data.isResyncing,true);
    } finally {adapter.resetLanguageMutations();vi.useRealTimers();}
});

test("uncertain write failures retain ownership without concurrent GETs", async () => {
    const {adapter,values,request,calls,send} = await setup();
    try {
        const write=request();adapter.beginLanguageMutation(write);
        adapter.languageMutationWriteUnconfirmed(write.requestId);
        assert.equal(values.LanguageMutation.data.inFlight?.requestId,write.requestId);
        assert.equal(calls.length,0);
        values.SelectedTargetLanguages.state="ok";
        adapter.receiveLanguageMutation({endpoint:write.endpoint,status:200},send);
        adapter.languageMutationWriteUnconfirmed(write.requestId);
        assert.equal(values.LanguageMutation.data.lastVrResult?.kind,"success");
    } finally {adapter.resetLanguageMutations();}
});

test("missing backend is a failure and requires current state before retry", async () => {
    const {adapter,values,request} = await setup();
    try {
        const write=request();adapter.beginLanguageMutation(write);
        adapter.failLanguageMutationBeforeSend(write.requestId);
        assert.equal(values.LanguageMutation.data.inFlight,null);
        assert.equal(values.LanguageMutation.data.lastVrResult?.kind,"failure");
        assert.equal(adapter.canChangeLanguageSettings(),false);
    } finally {adapter.resetLanguageMutations();}
});

test("a PC rejection is visible without overwriting the VR request result", async () => {
    const {adapter,values,request} = await setup();
    try {
        adapter.beginLanguageMutation(request("owner"));
        assert.equal(adapter.beginLanguageMutation(request("pc", "pc")),false);
        assert.equal(values.NotificationStatus.data.status,"warning");
        assert.equal(values.LanguageMutation.data.lastVrResult,null);
    } finally {adapter.resetLanguageMutations();}
});

test("a VR request that went through the emit round trip is accepted by the main adapter", async () => {
    const { adapter, values } = await setup();
    // 実データに近い値 (内側のキー順が辞書順でないもの)
    values.SelectedYourLanguages = { state: "ok", data: { 1: { 1: { language: "Japanese", country: "Japan", enable: true } } } };
    values.SelectedTargetLanguages = { state: "ok", data: { 1: { 1: { language: "English", country: "United States", enable: true },
        2: { language: "English", country: "United States", enable: false } } } };
    values.SelectedTranslationEngines = { state: "ok", data: { 1: "CTranslate2", 2: "Google" } };
    const sortKeysDeep = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeysDeep)
        : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeysDeep(Reflect.get(value, key))])) : value;
    const viaEmit = (value: unknown) => JSON.parse(JSON.stringify(sortKeysDeep(value)));
    const request = { requestId: "vr-emit", source: "vr", endpoint: "/set/data/selected_target_languages",
        expectedSnapshot: adapter.getLanguageSnapshot() };
    assert.equal(adapter.beginLanguageMutation(viaEmit(request)), true); // 内容が同じなら受け付ける
    adapter.resetLanguageMutations();
    const stale = viaEmit({ ...request, requestId: "vr-stale", expectedSnapshot: { ...request.expectedSnapshot, tab: "2" } });
    assert.equal(adapter.beginLanguageMutation(stale), false); // 内容が違えば断る
});

// The settings each language write expects to change, by the stand-in atom names.
const pendingFields = (values: FakeStorage["values"]) => fields.filter(name => values[name].state === "pending");

test("a language write marks as pending only the settings it changes", async () => {
    const changes: Record<string, string[]> = {
        "/set/data/selected_tab_no": ["SelectedPresetTabNumber"],
        "/set/data/selected_your_languages": ["SelectedYourLanguages"],
        "/set/data/selected_target_languages": ["SelectedTargetLanguages"],
        "/set/data/selected_translation_engines": ["SelectedTranslationEngines"],
        "/run/swap_your_language_and_target_language": ["SelectedYourLanguages", "SelectedTargetLanguages"],
    };
    assert.deepEqual(Object.keys(changes), [...coordinator.LANGUAGE_MUTATION_ENDPOINTS]);
    for (const [endpoint, changed] of Object.entries(changes)) {
        const { adapter, values } = await setup();
        try {
            assert.equal(adapter.beginLanguageMutation({ requestId: endpoint, source: "vr", endpoint,
                expectedSnapshot: adapter.getLanguageSnapshot() }), true, endpoint);
            assert.deepEqual(pendingFields(values), changed, endpoint);
        } finally { adapter.resetLanguageMutations(); }
    }
});

test("only a refused write from the main window asks the user to try again", async () => {
    const { adapter, values, request } = await setup();
    try {
        adapter.beginLanguageMutation(request("owner"));
        assert.equal(adapter.beginLanguageMutation(request("second panel write")), false);
        assert.deepEqual(values.NotificationStatus.data, {}, "the VR panel shows its own result");
        assert.equal(adapter.beginLanguageMutation(request("pc", "pc")), false);
        assert.deepEqual(values.NotificationStatus.data, { status: "warning", is_open: true, category_id: null,
            message: "vr_panel.language.pc_retry", options: {} });
    } finally { adapter.resetLanguageMutations(); }
});

test("a write leaves no timer behind once it is answered, fails before sending or is reset", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
        for (const end of ["answered", "failed before sending", "reset"]) {
            const { adapter, request } = await setup();
            try {
                const write = request();
                adapter.beginLanguageMutation(write);
                assert.equal(vi.getTimerCount(), 1, end);
                if (end === "answered") adapter.receiveLanguageMutation({ endpoint: write.endpoint, status: 200 }, async () => true);
                if (end === "failed before sending") adapter.failLanguageMutationBeforeSend(write.requestId);
                if (end === "reset") adapter.resetLanguageMutations();
                assert.equal(vi.getTimerCount(), 0, end);
            } finally { adapter.resetLanguageMutations(); vi.clearAllTimers(); }
        }
    } finally { vi.useRealTimers(); }
});

test("each way a write ends tells the VR panel why", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
        const timedOut = await setup();
        try {
            timedOut.adapter.beginLanguageMutation(timedOut.request());
            vi.advanceTimersByTime(timedOut.adapter.LANGUAGE_RESPONSE_WAIT_MS);
            assert.equal(timedOut.values.LanguageMutation.data.lastVrResult?.reason, "timeout");
        } finally { timedOut.adapter.resetLanguageMutations(); }

        const missing = await setup();
        try {
            const write = missing.request();
            missing.adapter.beginLanguageMutation(write);
            missing.adapter.failLanguageMutationBeforeSend(write.requestId);
            assert.equal(missing.values.LanguageMutation.data.lastVrResult?.reason, "backend-unavailable");
        } finally { missing.adapter.resetLanguageMutations(); }

        const restarted = await setup();
        try {
            restarted.adapter.beginLanguageMutation(restarted.request());
            restarted.adapter.resetLanguageMutations();
            assert.equal(restarted.values.LanguageMutation.data.lastVrResult?.reason, "backend-restarted");
        } finally { restarted.adapter.resetLanguageMutations(); }
    } finally { vi.useRealTimers(); }
});

test("an unconfirmed write stops its own timer, and only its own", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { adapter, values, request } = await setup();
    try {
        const write = request();
        adapter.beginLanguageMutation(write);
        // Read through a function: an assertion on the value would narrow its type for the rest.
        const lastResult = () => values.LanguageMutation.data.lastVrResult;
        adapter.languageMutationWriteUnconfirmed("another request");
        assert.equal(vi.getTimerCount(), 1, "an answer for another request changes nothing");
        assert.equal(lastResult(), null);
        adapter.languageMutationWriteUnconfirmed(write.requestId);
        assert.equal(vi.getTimerCount(), 0);
        assert.equal(lastResult()?.reason, "write-unconfirmed");
        vi.advanceTimersByTime(adapter.LANGUAGE_RESPONSE_WAIT_MS);
        assert.equal(lastResult()?.reason, "write-unconfirmed");
    } finally { adapter.resetLanguageMutations(); vi.useRealTimers(); }
});

test("a resync announces itself at once, and a read it cannot send marks its setting as failed", async () => {
    const { adapter, values, history } = await setup();
    try {
        const answers: Record<string, () => Promise<unknown>> = {
            "/get/data/selected_tab_no": async () => false,
            "/get/data/selected_your_languages": () => Promise.reject(Error("no backend")),
        };
        adapter.resyncLanguageSettings(endpoint => answers[endpoint]?.() ?? Promise.resolve(true));
        assert.equal(values.LanguageMutation.data.isResyncing, true);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(values.SelectedPresetTabNumber.state, "error");
        assert.equal(values.SelectedYourLanguages.state, "error");
        assert.deepEqual(pendingFields(values), ["SelectedTargetLanguages", "SelectedTranslationEngines", "TranslationEngines"]);
        const published = history.length;
        for (const getter of getters.slice(2)) {
            values[fields[getters.indexOf(getter)]].state = "ok";
            adapter.receiveLanguageMutation({ endpoint: `/get/data/${getter}`, status: 200 }, async () => true);
        }
        const announced = history.slice(published).filter(item => item.name === "LanguageMutation");
        assert.equal(announced.length, 1, "the end of the resync is published once, with the last read");
        assert.equal(fieldOf(announced[0].value, "data", "isResyncing"), false);
    } finally { adapter.resetLanguageMutations(); }
});

test("no write starts while a resync waits for reads, or while a setting is not current", async () => {
    const resyncing = await setup();
    try {
        resyncing.adapter.resyncLanguageSettings(async () => true);
        for (const name of fields) resyncing.values[name].state = "ok";
        assert.equal(resyncing.adapter.beginLanguageMutation(resyncing.request()), false);
        assert.equal(resyncing.values.LanguageMutation.data.lastVrResult?.reason, "syncing");
    } finally { resyncing.adapter.resetLanguageMutations(); }

    const oneFailed = await setup();
    try {
        oneFailed.values.SelectedPresetTabNumber.state = "error";
        assert.equal(oneFailed.adapter.beginLanguageMutation(oneFailed.request()), false);
        assert.deepEqual(pendingFields(oneFailed.values), []);
    } finally { oneFailed.adapter.resetLanguageMutations(); }
});

test("a write made for older settings is refused and changes nothing", async () => {
    const { adapter, values, request } = await setup();
    try {
        const stale = { ...request(), expectedSnapshot: { ...adapter.getLanguageSnapshot(), tab: "2" } };
        assert.equal(adapter.beginLanguageMutation(stale), false);
        assert.deepEqual(pendingFields(values), []);
        assert.equal(values.LanguageMutation.data.lastVrResult?.reason, "stale");
    } finally { adapter.resetLanguageMutations(); }
});

test("a write refused before it reaches the owner is reported only for a language write", async () => {
    const { adapter, values, request } = await setup();
    try {
        adapter.rejectLanguageMutation(null, "relay-refused");
        adapter.rejectLanguageMutation({ ...request("osc"), endpoint: "/set/data/osc_port" }, "relay-refused");
        assert.equal(values.LanguageMutation.data.lastVrResult, null);
        adapter.rejectLanguageMutation(request("refused"), "relay-refused");
        assert.deepEqual(values.LanguageMutation.data.lastVrResult, { requestId: "refused",
            endpoint: "/set/data/selected_target_languages", kind: "rejected", reason: "relay-refused" });
    } finally { adapter.resetLanguageMutations(); }
});

test("a read that fails marks its own setting and counts as answered for the resync", async () => {
    const { adapter, values } = await setup();
    try {
        adapter.failLanguageRead("/get/data/unknown_setting");
        assert.deepEqual(fields.map(name => values[name].state), fields.map(() => "ok"));
        adapter.resyncLanguageSettings(async () => true);
        for (const getter of getters) adapter.failLanguageRead(`/get/data/${getter}`);
        assert.deepEqual(fields.map(name => values[name].state), fields.map(() => "error"));
        assert.equal(values.LanguageMutation.data.isResyncing, false);
    } finally { adapter.resetLanguageMutations(); }
});

test("a failed read with no write in flight marks only that setting as failed", async () => {
    const { adapter, values } = await setup();
    try {
        adapter.receiveLanguageMutation({ endpoint: "/get/data/selected_tab_no", status: 200 }, async () => true);
        assert.equal(values.SelectedPresetTabNumber.state, "ok");
        adapter.receiveLanguageMutation({ endpoint: "/get/data/selected_tab_no", status: 500 }, async () => true);
        assert.deepEqual(fields.filter(name => values[name].state === "error"), ["SelectedPresetTabNumber"]);
    } finally { adapter.resetLanguageMutations(); }
});

test("a reset forgets the write in flight and the resync it started", async () => {
    for (const before of ["in flight", "resyncing"]) {
        const { adapter, values, request, send } = await setup();
        try {
            const write = request();
            adapter.beginLanguageMutation(write);
            if (before === "resyncing") adapter.receiveLanguageMutation({ endpoint: write.endpoint, status: 500 }, send);
            adapter.resetLanguageMutations();
            for (const name of fields) values[name].state = "ok";
            assert.equal(adapter.canChangeLanguageSettings(), true, before);
            assert.equal(adapter.beginLanguageMutation(request("next")), true, before);
        } finally { adapter.resetLanguageMutations(); }
    }
});

test("each request gets its own id", async () => {
    const { adapter } = await setup();
    const ids = [adapter.createLanguageRequestId(), adapter.createLanguageRequestId()];
    assert.match(ids[0], /^[0-9a-f-]{36}$/);
    assert.notEqual(ids[0], ids[1]);
});
