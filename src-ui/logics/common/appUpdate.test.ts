import assert from "node:assert/strict";
import { test } from "vitest";
import { createAppUpdate, downloadPercent, INITIAL_APP_UPDATE } from "./appUpdate.ts";
import type { AppUpdateInstallProgress, AppUpdateMode, AppUpdateState } from "./appUpdate.ts";
import { unchecked } from "../test/hookHarness.ts";

const setup = (answers: Record<string, unknown>, mode: AppUpdateMode = "install") => {
    let state: AppUpdateState = { ...INITIAL_APP_UPDATE };
    const calls: string[] = [];
    const channels: ((message: AppUpdateInstallProgress) => void)[] = [];
    // The test's answer to a command (or its failure).
    const answerTo = (command: string, args?: Record<string, unknown>): unknown => {
        if (command === "app_update_info") return { mode, kind: "appimage", channel: "stable", current_version: "0.4.0" };
        const answer = answers[command];
        if (typeof answer === "function") return answer(args);
        if (answer instanceof Error || typeof answer === "string") throw answer;
        return answer;
    };
    // Tauri's invoke, answering each command with the test's data (or failing with it).
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
        calls.push(command);
        // Test data: the test's answer, in the shape the command returns.
        return unchecked<T>(answerTo(command, args));
    };
    const updater = createAppUpdate({
        invoke,
        createChannel: (onmessage: (message: AppUpdateInstallProgress) => void) => { channels.push(onmessage); return { onmessage }; },
        get: () => state,
        set: (next: AppUpdateState) => { state = next; },
    });
    return { updater, calls, channels, state: () => state };
};

test("a found update is offered with its version and release page", async () => {
    const s = setup({ app_update_check: { available: true, version: "0.4.1", release_url: "https://github.com/kein5/astarot/releases/tag/v0.4.1" } });
    await s.updater.check();
    assert.equal(s.state().status, "available");
    assert.equal(s.state().version, "0.4.1");
    assert.equal(s.state().info?.mode, "install");
});

test("no update means up to date", async () => {
    const s = setup({ app_update_check: { available: false } });
    await s.updater.check();
    assert.equal(s.state().status, "up_to_date");
});

test("a failed check at start shows nothing; asked for, it says why", async () => {
    const s = setup({ app_update_check: "update_metadata_missing" });
    await s.updater.check({ silent: true });
    assert.equal(s.state().status, "idle");
    assert.equal(s.state().error, null);
    await s.updater.check();
    assert.equal(s.state().status, "error");
    assert.equal(s.state().error, "update_metadata_missing");
});

test("an unknown rejection becomes a generic code, not the raw message", async () => {
    const s = setup({ app_update_check: new Error("https://example.invalid failed") });
    await s.updater.check();
    assert.equal(s.state().error, "update_check_failed");
});

test("deb, rpm and development builds never ask for updates", async () => {
    for (const mode of ["package_manager", "disabled"] as const) {
        const s = setup({ app_update_check: { available: true, version: "9.9.9" } }, mode);
        await s.updater.check();
        assert.deepEqual(s.calls, ["app_update_info"]);
        assert.equal(s.state().status, "idle");
    }
});

test("a manual copy is told about an update but cannot install it", async () => {
    const s = setup({ app_update_check: { available: true, version: "0.4.1" }, app_update_install: undefined }, "manual");
    await s.updater.check();
    assert.equal(s.state().status, "available");
    assert.equal(await s.updater.install(), null);
    assert.ok(!s.calls.includes("app_update_install"));
});

test("install reports download progress, then installing", async () => {
    const s = setup({
        app_update_check: { available: true, version: "0.4.1" },
        app_update_install: () => {
            s.channels[0]({ phase: "download", downloaded: 50, total: 200 });
            assert.equal(s.state().status, "downloading");
            assert.equal(downloadPercent(s.state().progress), 25);
            s.channels[0]({ phase: "install" });
            assert.equal(s.state().status, "installing");
            return null;
        },
    });
    await s.updater.check();
    assert.equal(await s.updater.install(), null);
});

test("a failed install goes back to the offer and says why; the app keeps running", async () => {
    const s = setup({ app_update_check: { available: true, version: "0.4.1" }, app_update_install: "update_signature_invalid" });
    await s.updater.check();
    assert.equal(await s.updater.install(), "update_signature_invalid");
    assert.equal(s.state().status, "available");
    assert.equal(s.state().error, "update_signature_invalid");
    assert.equal(s.state().progress, null);
});

test("a second check while one runs is ignored", async () => {
    let release: ((value: unknown) => void) | undefined;
    const s = setup({ app_update_check: () => new Promise(resolve => { release = resolve; }) });
    const first = s.updater.check();
    await new Promise(resolve => setImmediate(resolve));
    await s.updater.check();
    assert.ok(release);
    release({ available: false });
    await first;
    assert.equal(s.calls.filter(command => command === "app_update_check").length, 1);
});

test("download percent waits for a known size", () => {
    assert.equal(downloadPercent(null), null);
    assert.equal(downloadPercent({ downloaded: 10, total: null }), null);
    assert.equal(downloadPercent({ downloaded: 300, total: 200 }), 100);
});

// #466: the check asks for the channel of the settings; without one, the build's (the command's own).
test("the check asks for the update channel it is given, and for none without one", async () => {
    const asked: unknown[] = [];
    const s = setup({ app_update_check: (args: Record<string, unknown> | undefined) => { asked.push(args?.channel); return { available: false }; } });
    await s.updater.check({ channel: "beta" });
    await s.updater.check();
    assert.deepEqual(asked, ["beta", null]);
});

// #466: setting the channel again forgets what the other channel found and checks the new one.
test("a channel set again forgets the other channel's update and checks the new one", async () => {
    const asked: unknown[] = [];
    const s = setup({ app_update_check: (args: Record<string, unknown> | undefined) => {
        asked.push(args?.channel);
        return args?.channel === "beta" ? { available: true, version: "0.6.1-beta.1" } : { available: false };
    } });
    await s.updater.switchChannel("beta");
    assert.equal(s.state().status, "available");
    assert.equal(s.state().version, "0.6.1-beta.1");
    // Back to Stable: the beta found before is not offered.
    await s.updater.switchChannel("stable");
    assert.deepEqual(asked, ["beta", "stable"]);
    assert.equal(s.state().status, "up_to_date");
    assert.equal(s.state().version, null);
});

test("a failed check after a channel change offers nothing of the other channel", async () => {
    let calls = 0;
    const s = setup({ app_update_check: () => {
        calls += 1;
        if (calls === 1) return { available: true, version: "0.6.1-beta.1" };
        throw "update_check_failed";
    } });
    await s.updater.check({ channel: "beta" });
    assert.equal(s.state().status, "available");
    await s.updater.switchChannel("stable");
    assert.equal(s.state().status, "idle", "a silent failure keeps no offer of the other channel");
    assert.equal(s.state().version, null);
});

// A check the test answers when it chooses, and the Tauri side's rule: one check at a time
// (a second one while one runs is refused, update_busy).
const slowChecks = (answers: Record<string, { available: boolean; version?: string }>) => {
    const asked: unknown[] = [];
    const waiting: (() => void)[] = [];
    let running = false;
    const answer = (args: Record<string, unknown> | undefined) => {
        if (running) throw "update_busy";
        running = true;
        asked.push(args?.channel);
        return new Promise(resolve => waiting.push(() => { running = false; resolve(answers[String(args?.channel)]); }));
    };
    const release = async () => {
        while (!waiting.length) await new Promise(next => setTimeout(next, 0));
        waiting.shift()?.();
        await new Promise(next => setTimeout(next, 0));
    };
    return { answer, asked, release };
};

// The channel set again while a check runs: that check's answer is the other channel's. It is
// not shown, and the new channel is checked after it, so what is shown is what the last check
// found, which is what the Tauri side installs.
test("a check of the channel set before never overwrites the channel set now", async () => {
    const checks = slowChecks({ stable: { available: true, version: "0.6.1" }, beta: { available: true, version: "0.7.0-beta.1" } });
    const s = setup({ app_update_check: checks.answer });
    const first = s.updater.check({ channel: "stable" });
    await new Promise(next => setTimeout(next, 0));
    const switched = s.updater.switchChannel("beta");
    assert.equal(s.state().status, "checking", "nothing of the stable channel is offered meanwhile");
    assert.equal(s.state().version, null);
    await checks.release();
    await first;
    assert.notEqual(s.state().version, "0.6.1", "the stable answer is dropped");
    assert.equal(s.state().status, "checking");
    await checks.release();
    await switched;
    assert.deepEqual(checks.asked, ["stable", "beta"], "the beta check waited for the stable one, never refused");
    assert.deepEqual([s.state().status, s.state().version], ["available", "0.7.0-beta.1"]);
});

test("set again and again while a check runs, only the last channel is checked", async () => {
    const checks = slowChecks({ stable: { available: false }, beta: { available: true, version: "0.7.0-beta.1" } });
    const s = setup({ app_update_check: checks.answer });
    const first = s.updater.check({ channel: "stable" });
    await new Promise(next => setTimeout(next, 0));
    const toBeta = s.updater.switchChannel("beta");
    const toStable = s.updater.switchChannel("stable");
    await checks.release();
    await first;
    await toBeta;
    await checks.release();
    await toStable;
    assert.deepEqual(checks.asked, ["stable", "stable"], "the beta switch was passed over");
    assert.deepEqual([s.state().status, s.state().version], ["up_to_date", null]);
});

test("a channel set again during a download leaves the download and its offer as they are", async () => {
    const asked: unknown[] = [];
    const s = setup({ app_update_check: (args: Record<string, unknown> | undefined) => { asked.push(args?.channel); return { available: true, version: "0.6.1" }; },
        app_update_install: () => new Promise(() => {}) });
    await s.updater.check({ channel: "stable" });
    void s.updater.install();
    assert.equal(s.state().status, "downloading");
    await s.updater.switchChannel("beta");
    assert.deepEqual([s.state().status, s.state().version], ["downloading", "0.6.1"]);
    assert.deepEqual(asked, ["stable"]);
});
