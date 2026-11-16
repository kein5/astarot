import assert from "node:assert/strict";
import test from "node:test";

import { createCoreBackendCommand, createSelectedBackendCommand } from "./backendCommand.ts";
import { createSidecarSessionOwner } from "./sidecarSession.ts";

class FakeChannel {
    onmessage = () => {};
}

const fakeCore = () => {
    const calls = [];
    let channels = null;
    const invoke = async (command, args) => {
        calls.push([command, args]);
        if (command === "backend_kind") return "core";
        if (command === "backend_start") channels = args;
        return null;
    };
    return { calls, invoke, line: line => channels.lines.onmessage(line), exit: code => channels.exit.onmessage(code) };
};

test("the core command starts a session, writes lines without the newline and kills it", async () => {
    const core = fakeCore();
    const command = createCoreBackendCommand({ invoke: core.invoke, Channel: FakeChannel, newSessionId: () => "s1" });
    const lines = [];
    const closes = [];
    command.stdout.on("data", line => lines.push(line));
    command.on("close", event => closes.push(event));
    const child = await command.spawn();
    assert.deepEqual(core.calls[0][0], "backend_start");
    assert.equal(core.calls[0][1].session, "s1");
    core.line('{"status":200}');
    assert.deepEqual(lines, ['{"status":200}']);
    assert.equal(await child.write('{"endpoint":"/run/shutdown"}\n'), true);
    assert.deepEqual(core.calls[1], ["backend_write", { session: "s1", line: '{"endpoint":"/run/shutdown"}' }]);
    await child.kill();
    assert.deepEqual(core.calls[2], ["backend_kill", { session: "s1" }]);
    core.exit(0);
    assert.deepEqual(closes, [{ code: 0, signal: null }]);
});

test("the selected command starts the sidecar unless the app asks for the core", async () => {
    const started = [];
    const sidecar = () => {
        const command = {
            on: () => command,
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            spawn: async () => {
                started.push("sidecar");
                return { write: async () => true, kill: async () => {} };
            },
        };
        return command;
    };
    const invoke = async command => (command === "backend_kind" ? "sidecar" : null);
    await createSelectedBackendCommand({ invoke, Channel: FakeChannel, createSidecar: sidecar, newSessionId: () => "x" }).spawn();
    const failing = async () => { throw new Error("no command"); };
    await createSelectedBackendCommand({ invoke: failing, Channel: FakeChannel, createSidecar: sidecar, newSessionId: () => "x" }).spawn();
    assert.deepEqual(started, ["sidecar", "sidecar"]);
});

test("a session over the core reaches initialization and reports an unexpected end", async () => {
    const core = fakeCore();
    const store = {};
    const received = [];
    const states = [];
    const exits = [];
    const owner = createSidecarSessionOwner({
        store,
        createCommand: () => createSelectedBackendCommand({
            invoke: core.invoke, Channel: FakeChannel, createSidecar: () => { throw new Error("not used"); }, newSessionId: () => "s2",
        }),
        setInterval: () => 1,
        clearInterval: () => {},
    });
    const handlers = {
        receiveRoutes: message => received.push(message),
        backendStopped: () => {},
        feedWatchdog: () => {},
        beginStartup: () => {},
        setStartupState: phase => states.push(phase),
        started: () => {},
        unexpectedExit: event => exits.push(event),
        stderr: () => {},
    };
    owner.attach(() => handlers);
    await store.backend_session.completion;
    assert.equal(store.backend_session.phase, "running");
    core.line(JSON.stringify({ status: 200, endpoint: "/run/initialization_complete", result: {} }));
    assert.equal(received.at(-1).endpoint, "/run/initialization_complete");
    assert.equal(await store.backend_subprocess.write("line\n"), true);
    core.exit(0);
    assert.deepEqual(exits, [{ code: 0, signal: null }]);
    assert.equal(states.at(-1), "stopped");
});
