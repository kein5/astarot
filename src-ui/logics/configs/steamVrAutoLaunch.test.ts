import assert from "node:assert/strict";
import { test } from "vitest";
import { STEAMVR_NOTES, steamVrSwitchView } from "./steamVrAutoLaunch.ts";

// The VR page's "Start with SteamVR" row (#1384) shows the core's last answer of what SteamVR holds.

test("the switch is on when SteamVR's flag is, and can be pressed only while SteamVR answered", () => {
    assert.deepEqual(steamVrSwitchView(true, { state: "ok", data: { available: true, enabled: true } }),
        { shown: true, variable: { state: "ok", data: true }, available: true, note: null });
    assert.deepEqual(steamVrSwitchView(true, { state: "ok", data: { available: true, enabled: false } }),
        { shown: true, variable: { state: "ok", data: false }, available: true, note: null });
    // A change on its way keeps the last answer and waits.
    assert.deepEqual(steamVrSwitchView(true, { state: "pending", data: { available: true, enabled: false } }).variable,
        { state: "pending", data: false });
});

test("before the first answer the row waits, off and not pressable, with nothing said yet", () => {
    assert.deepEqual(steamVrSwitchView(true, { state: "pending", data: null }),
        { shown: true, variable: { state: "pending", data: false }, available: false, note: null });
});

test("without SteamVR the row says how to change it, with one of the lines it keeps room for", () => {
    for (const [reason, note] of [["steamvr_not_running", STEAMVR_NOTES[0]], ["steamvr_unreachable", STEAMVR_NOTES[1]]] as const) {
        assert.deepEqual(steamVrSwitchView(true, { state: "ok", data: { available: false, reason, enabled: null } }),
            { shown: true, variable: { state: "ok", data: false }, available: false, note });
    }
    assert.deepEqual([...STEAMVR_NOTES], ["config_page.vr.steamvr_auto_launch.steamvr_not_running", "config_page.vr.steamvr_auto_launch.steamvr_unreachable"]);
});

test("a build SteamVR cannot start shows no row, whatever the core answered", () => {
    for (const data of [null, { available: true, enabled: true } as const, { available: false, reason: "unsupported", enabled: null } as const]) {
        assert.deepEqual(steamVrSwitchView(false, { state: "ok", data }),
            { shown: false, variable: { state: "ok", data: data?.enabled === true }, available: false, note: null }, JSON.stringify(data));
    }
    // Told it is supported but answered otherwise: the row stays, and cannot be pressed.
    assert.deepEqual(steamVrSwitchView(true, { state: "ok", data: { available: false, reason: "unsupported", enabled: null } }),
        { shown: true, variable: { state: "ok", data: false }, available: false, note: null });
});
