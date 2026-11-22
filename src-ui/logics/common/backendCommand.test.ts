import assert from "node:assert/strict";
import { test } from "vitest";

import { createCoreBackendCommand } from "./backendCommand.ts";
import { createSidecarSessionOwner } from "./sidecarSession.ts";
import type { BackendExit } from "./backendCommand.ts";
import type { SidecarSessionHandlers, SidecarSessionStore, SidecarTimer } from "./sidecarSession.ts";
import { fieldOf, timerHandle, unchecked } from "../test/hookHarness.ts";

class FakeChannel<T> {
    onmessage: (message: T) => void = () => {};
}

// The channels the command gives backend_start.
interface StartChannels {
    lines: FakeChannel<string>;
    exit: FakeChannel<number | null>;
}

const fakeCore = () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    let startArgs: Record<string, unknown> | undefined | null = null;
    // Tauri's invoke: every command answers null, as the core's do.
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
        calls.push([command, args]);
        if (command === "backend_start") startArgs = args;
        // Test data: null, the answer of every command of the core.
        return unchecked<T>(null);
    };
    // The session the command started: a line or an exit before it stops with a TypeError, as reading null did.
    const started = (): StartChannels => {
        if (!startArgs) throw new TypeError("No backend session has started");
        const { lines, exit } = startArgs;
        assert.ok(lines instanceof FakeChannel && exit instanceof FakeChannel, "backend_start was not given its channels");
        return { lines, exit };
    };
    return { calls, invoke, line: (line: string) => started().lines.onmessage(line), exit: (code: number | null) => started().exit.onmessage(code) };
};

test("the core command starts a session, writes lines without the newline and kills it", async () => {
    const core = fakeCore();
    const command = createCoreBackendCommand({ invoke: core.invoke, Channel: FakeChannel, newSessionId: () => "s1" });
    const lines: string[] = [];
    const closes: BackendExit[] = [];
    command.stdout.on("data", line => lines.push(line));
    command.on("close", event => closes.push(event));
    const child = await command.spawn();
    assert.deepEqual(core.calls[0][0], "backend_start");
    assert.equal(core.calls[0][1]?.session, "s1");
    core.line('{"status":200}');
    assert.deepEqual(lines, ['{"status":200}']);
    assert.equal(await child.write('{"endpoint":"/run/shutdown"}\n'), true);
    assert.deepEqual(core.calls[1], ["backend_write", { session: "s1", line: '{"endpoint":"/run/shutdown"}' }]);
    await child.kill();
    assert.deepEqual(core.calls[2], ["backend_kill", { session: "s1" }]);
    core.exit(0);
    assert.deepEqual(closes, [{ code: 0, signal: null }]);
});

test("a session over the core reaches initialization and reports an unexpected end", async () => {
    const core = fakeCore();
    // Test data: an empty store, which the owner fills.
    const store = unchecked<SidecarSessionStore>({});
    const received: unknown[] = [];
    const states: string[] = [];
    const exits: Partial<BackendExit>[] = [];
    const owner = createSidecarSessionOwner({
        store,
        createCommand: () => createCoreBackendCommand({ invoke: core.invoke, Channel: FakeChannel, newSessionId: () => "s2" }),
        // A timer id the fake clock never uses.
        setInterval: () => timerHandle<SidecarTimer>(1),
        clearInterval: () => {},
    });
    const handlers: SidecarSessionHandlers = {
        // The parsed line this test wrote.
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
    assert.ok(store.backend_session);
    await store.backend_session.completion;
    assert.equal(store.backend_session.phase, "running");
    core.line(JSON.stringify({ status: 200, endpoint: "/run/initialization_complete", result: {} }));
    assert.equal(fieldOf(received.at(-1), "endpoint"), "/run/initialization_complete");
    assert.ok(store.backend_subprocess);
    assert.equal(await store.backend_subprocess.write("line\n"), true);
    core.exit(0);
    assert.deepEqual(exits, [{ code: 0, signal: null }]);
    assert.equal(states.at(-1), "stopped");
});
