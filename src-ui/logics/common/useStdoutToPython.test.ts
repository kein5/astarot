import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as recovery from "./pendingRequestRecovery.ts";
import * as exitExpectation from "./sidecarExitExpectation.ts";
import type { ExitExpectingSession } from "./sidecarExitExpectation.ts";
import * as writeResponses from "./settingsWriteResponses.ts";
import type { LanguageMutationRequest } from "../main/languageMutationCoordinator.ts";

// The adapter runs with the real recovery, exit expectation and write response modules: the ones
// this file imports, so the test and the adapter share their state.
const { pendingRequestRecovery } = recovery;
const { rejectExpectedExit } = exitExpectation;
const { settingsWriteResponses } = writeResponses;

// The store's fields the adapter reads, as the tests set them. rejectLanguage is the stand-in
// language owner's: it refuses the language writes while true.
interface StandInStore {
    backend_subprocess: { write: (line: string) => unknown } | null;
    backend_session: ExitExpectingSession;
    backend_stopped?: boolean;
    rejectLanguage?: boolean;
}

async function setup() {
    settingsWriteResponses.stop();
    // Exercise the actual transport adapter; only Tauri, hooks and the language owner are stubs.
    const store: StandInStore = { backend_subprocess: null, backend_session: { expectedExits: new Map() } };
    const events: unknown[][] = [], notices: unknown[][] = [];
    const { useStdoutToPython } = await loadModule<typeof import("./useStdoutToPython.ts")>(new URL("./useStdoutToPython.ts", import.meta.url), hooks(), {
        "@store": { store },
        "js-base64": { encode: (value: string) => Buffer.from(value).toString("base64") },
        "./useNotificationStatus": { useNotificationStatus: () => ({ showNotification_Error: (...args: unknown[]) => notices.push(args) }) },
        "./pendingRequestRecovery.ts": recovery,
        "./sidecarExitExpectation.ts": exitExpectation,
        "./settingsWriteResponses.ts": writeResponses,
        "./vrPanelSend.ts": { sendToMain: async (...args: unknown[]) => events.push(["relay", ...args]) },
        "../main/languageMutations": {
            isLanguageMutation: (path: string) => path === "/set/data/selected_target_languages",
            beginLanguageMutation: (request: LanguageMutationRequest) => { events.push(["begin", request.requestId]); return !store.rejectLanguage; },
            createLanguageRequestId: () => "language-request",
            getLanguageSnapshot: () => ({}),
            failLanguageMutationBeforeSend: (id: string) => events.push(["before-send", id]),
            languageMutationWriteUnconfirmed: (id: string) => events.push(["unconfirmed", id]),
            failLanguageRead: (endpoint: string) => events.push(["read-failed", endpoint]),
        },
    });
    let value = { state: "pending", data: 9000 };
    pendingRequestRecovery.register({ endpoints: ["/set/data/osc_port", "/get/data/osc_port"], read: "/get/data/osc_port",
        restore: () => { const changed = value.state === "pending"; value = { ...value, state: "ok" }; return changed; } });
    return { store, events, notices, send: useStdoutToPython().asyncStdoutToPython, get value() { return value; } };
}

test("settings transport returns its canonical write response, never a matching GET", async () => {
    const subject = await setup(), endpoint = "/set/data/realtime_asr_settings", writes: object[] = [];
    subject.store.backend_subprocess = { write: async (line: string) => { writes.push(JSON.parse(line)); } };
    let completed = false;
    const saving = subject.send(endpoint, { vocabulary: { terms: ["a = b"] } }).then((response: unknown) => { completed = true; return response; });
    settingsWriteResponses.receive({ endpoint: "/get/data/realtime_asr_settings", status: 200, result: {} });
    await Promise.resolve();
    assert.equal(completed, false);
    const reply = { endpoint, status: 200, result: { vocabulary: { terms: ["a=b"] } } };
    settingsWriteResponses.receive(reply);
    assert.deepEqual(await saving, reply);
    assert.deepEqual(Object.keys(writes[0]), ["endpoint", "data"], "wire format is unchanged");
});

// SEC-02: a request relayed for the VR panel carries its origin, which the backend checks.
test("a relayed request is marked for the backend, and the main window's own requests are not", async () => {
    const subject = await setup(), writes: object[] = [];
    subject.store.backend_subprocess = { write: async (line: string) => { writes.push(JSON.parse(line)); } };
    await subject.send("/set/enable/translation", undefined, undefined, "vr_panel");
    await subject.send("/set/enable/translation");
    assert.deepEqual(writes, [{ endpoint: "/set/enable/translation", origin: "vr_panel" }, { endpoint: "/set/enable/translation" }]);
});

// A refused relay restores the value the main window showed as pending.
test("a refused relayed write restores its pending value", async () => {
    const subject = await setup();
    subject.store.backend_subprocess = { write: async () => true };
    // A settings write waits for its own response; the refusal is that response.
    const saving = subject.send("/set/data/osc_port", 9001, undefined, "vr_panel");
    await new Promise(resolve => setTimeout(resolve, 0));
    const refusal = { endpoint: "/set/data/osc_port", status: 403, result: { error_code: "vr_panel_request_refused" } };
    pendingRequestRecovery.receive(refusal, () => {});
    settingsWriteResponses.receive(refusal);
    assert.deepEqual(await saving, refusal);
    assert.equal(subject.value.state, "ok");
});

test("backend recovery releases pending settings response owners", async () => {
    const subject = await setup();
    subject.store.backend_subprocess = { write: async () => true };
    const saving = subject.send("/set/data/voice_settings", {});
    pendingRequestRecovery.stop();
    assert.equal(await saving, false);
});

test("an uncertain settings write blocks another send and restores its pending control", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const subject = await setup(), endpoint = "/set/data/hotkeys";
    let writes = 0, restores = 0;
    pendingRequestRecovery.register({ endpoints: [endpoint], restore: () => { restores++; return true; } });
    subject.store.backend_subprocess = { write: async () => { writes++; throw Error("unknown delivery"); } };
    assert.equal(await subject.send(endpoint, { toggle_translation: ["Ctrl", "T"] }), false);
    assert.equal(await subject.send(endpoint, { toggle_translation: ["Ctrl", "N"] }), false);
    assert.equal(writes, 1);
    assert.equal(restores, 2);
});

for (const mode of ["missing", "false", "throw", "reject"]) test(`actual transport restores on ${mode} without a success notification`, async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const subject = await setup();
    if (mode !== "missing") subject.store.backend_subprocess = { write: () => {
        if (mode === "throw") throw Error("synchronous");
        return mode === "reject" ? Promise.reject(Error("rejected")) : Promise.resolve(false);
    } };
    assert.equal(await subject.send("/set/data/osc_port", 9001), false);
    assert.deepEqual(subject.value, { state: "ok", data: 9000 });
    assert.deepEqual(subject.notices.map(([key]: unknown[]) => key), ["common_error.request_send_failed"]);
});

test("successful transport preserves the wire format and stays pending until response", async () => {
    const subject = await setup(), writes: string[] = [];
    subject.store.backend_subprocess = { write: async (line: string) => { writes.push(line); } };
    let settled = false;
    const saving = subject.send("/set/data/osc_port", 9001).then((response: unknown) => { settled = true; return response; });
    await Promise.resolve();
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0]), { endpoint: "/set/data/osc_port", data: Buffer.from("9001").toString("base64") });
    assert.ok(writes[0].endsWith("\n"));
    assert.equal(subject.value.state, "pending");
    assert.deepEqual(subject.notices, []);
    assert.equal(settled, false);
    const reply = { endpoint: "/set/data/osc_port", status: 200, result: 9001 };
    settingsWriteResponses.receive(reply);
    assert.deepEqual(await saving, reply);
});

test("encoding throws also restore before any write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const subject = await setup(), cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    subject.store.backend_subprocess = { write: () => assert.fail("encoding should fail before write") };
    assert.equal(await subject.send("/set/data/osc_port", cyclic), false);
    assert.equal(subject.value.state, "ok");
});

test("backend-stopped notice is not duplicated by subsequent failed sends", async () => {
    const subject = await setup();
    subject.store.backend_stopped = true;
    assert.equal(await subject.send("/set/data/osc_port", 9001), false);
    assert.equal(subject.value.state, "ok");
    assert.deepEqual(subject.notices, []);
});

test("rejected language admission does not fail or release the existing owner", async () => {
    const subject = await setup();
    subject.store.rejectLanguage = true;
    assert.equal(await subject.send("/set/data/selected_target_languages", {}), false);
    assert.deepEqual(subject.events.map(([type]: unknown[]) => type), ["begin"]);
});

test("language preserves uncertain-write versus before-send failure semantics", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const childExists of [false, true]) {
        const subject = await setup();
        if (childExists) subject.store.backend_subprocess = { write: async () => { throw Error("unknown delivery"); } };
        assert.equal(await subject.send("/set/data/selected_target_languages", {}), false);
        assert.deepEqual(subject.events.map(([type]: unknown[]) => type), ["begin", childExists ? "unconfirmed" : "before-send"]);
    }
});

test("failed shutdown does not suppress a subsequent unexpected exit notice", async () => {
    const subject = await setup();
    subject.store.backend_subprocess = { write: async () => false };
    assert.equal(await subject.send("/run/shutdown"), false);
    assert.equal(subject.store.backend_session.expectedExits.size, 0);
});

for (const endpoint of ["/run/update_software", "/run/update_cuda_software"]) {
    test(`${endpoint} arms this session before writing and disarms on transport failure`, async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        for (const outcome of [true, false, "throw"]) {
            const subject = await setup(), session = subject.store.backend_session;
            subject.store.backend_subprocess = { write: async () => {
                assert.equal(session.expectedExits.has(endpoint), true);
                if (outcome === "throw") throw Error("write failed");
                return outcome;
            } };
            assert.equal(await subject.send(endpoint), outcome === true);
            assert.equal(session.expectedExits.has(endpoint), outcome === true);
        }
    });

    test(`${endpoint} rejection before write completion cannot re-arm the exit latch`, async () => {
        const subject = await setup(), session = subject.store.backend_session;
        subject.store.backend_subprocess = { write: async () => {
            rejectExpectedExit(session, endpoint);
            return true;
        } };
        assert.equal(await subject.send(endpoint), true);
        assert.equal(session.expectedExits.size, 0);
    });
}

test("an old rejected write cannot change a replacement session or replay the request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const subject = await setup();
    // Called before the write has started, it stops with a TypeError, as calling undefined did.
    let reject: (reason: unknown) => void = () => { throw new TypeError("reject is not a function"); };
    subject.store.backend_subprocess = { write: () => new Promise((_, no) => { reject = no; }) };
    const send = subject.send("/run/update_software");
    const nextSession = { expectedExits: new Map() };
    subject.store.backend_session = nextSession;
    subject.store.backend_subprocess = { write: () => assert.fail("must never replay") };
    reject(Error("late failure"));
    assert.equal(await send, false);
    assert.equal(nextSession.expectedExits.size, 0);
    assert.deepEqual(subject.notices, []);
});

test("overlapping update writes that both fail leave no expected exit", async () => {
    const subject = await setup(), completions: ((value: unknown) => void)[] = [];
    subject.store.backend_subprocess = { write: () => new Promise(resolve => completions.push(resolve)) };
    const first = subject.send("/run/update_software"), second = subject.send("/run/update_software");
    completions[0](false);
    assert.equal(await first, false);
    assert.equal(subject.store.backend_session.expectedExits.has("/run/update_software"), true);
    completions[1](false);
    assert.equal(await second, false);
    assert.equal(subject.store.backend_session.expectedExits.size, 0);
});
