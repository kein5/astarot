import assert from "node:assert/strict";
import { test } from "vitest";
import { steamVrSwitchView } from "./steamVrAutoLaunch.ts";

// The VR page's "Start with SteamVR" row (#1384) shows the core's last answer of what SteamVR holds.

test("the switch is on when SteamVR's flag is, and can be pressed only while SteamVR answered", () => {
    assert.deepEqual(steamVrSwitchView({ state: "ok", data: { available: true, enabled: true } }),
        { shown: true, variable: { state: "ok", data: true }, available: true, note: null });
    assert.deepEqual(steamVrSwitchView({ state: "ok", data: { available: true, enabled: false } }),
        { shown: true, variable: { state: "ok", data: false }, available: true, note: null });
    // A change on its way keeps the last answer and waits.
    assert.deepEqual(steamVrSwitchView({ state: "pending", data: { available: true, enabled: false } }).variable,
        { state: "pending", data: false });
});

test("before the first answer the row waits, off and not pressable, with nothing said yet", () => {
    assert.deepEqual(steamVrSwitchView({ state: "pending", data: null }),
        { shown: true, variable: { state: "pending", data: false }, available: false, note: null });
});

test("without SteamVR the row says how to change it; a build SteamVR cannot start shows no row", () => {
    for (const reason of ["steamvr_not_running", "steamvr_unreachable"] as const) {
        assert.deepEqual(steamVrSwitchView({ state: "ok", data: { available: false, reason, enabled: null } }),
            { shown: true, variable: { state: "ok", data: false }, available: false, note: `config_page.vr.steamvr_auto_launch.${reason}` });
    }
    assert.equal(steamVrSwitchView({ state: "ok", data: { available: false, reason: "unsupported", enabled: null } }).shown, false);
});
