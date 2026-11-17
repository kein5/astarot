import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppUpdate, downloadPercent, INITIAL_APP_UPDATE } from "./appUpdate.ts";

const setup = (answers, mode = "install") => {
    let state = { ...INITIAL_APP_UPDATE };
    const calls = [];
    const channels = [];
    const invoke = async (command, args) => {
        calls.push(command);
        if (command === "app_update_info") return { mode, kind: "appimage", channel: "stable", current_version: "0.4.0" };
        const answer = answers[command];
        if (typeof answer === "function") return answer(args);
        if (answer instanceof Error || typeof answer === "string") throw answer;
        return answer;
    };
    const updater = createAppUpdate({
        invoke,
        createChannel: onmessage => { channels.push(onmessage); return { onmessage }; },
        get: () => state,
        set: next => { state = next; },
    });
    return { updater, calls, channels, state: () => state };
};

test("a found update is offered with its version and release page", async () => {
    const s = setup({ app_update_check: { available: true, version: "0.4.1", release_url: "https://github.com/kein5/VRCT-VOX/releases/tag/v0.4.1" } });
    await s.updater.check();
    assert.equal(s.state().status, "available");
    assert.equal(s.state().version, "0.4.1");
    assert.equal(s.state().info.mode, "install");
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
    for (const mode of ["package_manager", "disabled"]) {
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
    let release;
    const s = setup({ app_update_check: () => new Promise(resolve => { release = resolve; }) });
    const first = s.updater.check();
    await new Promise(resolve => setImmediate(resolve));
    await s.updater.check();
    release({ available: false });
    await first;
    assert.equal(s.calls.filter(command => command === "app_update_check").length, 1);
});

test("download percent waits for a known size", () => {
    assert.equal(downloadPercent(null), null);
    assert.equal(downloadPercent({ downloaded: 10, total: null }), null);
    assert.equal(downloadPercent({ downloaded: 300, total: 200 }), 100);
});
