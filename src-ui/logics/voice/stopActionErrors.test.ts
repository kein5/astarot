import assert from "node:assert/strict";
import { test } from "vitest";
import { loadBridgeRoutes } from "../test/bridgeHarness.ts";

// The top bar's stop and mute (and their hotkeys) are pressed away from the settings page that
// shows voice errors, so a failure is said with a notice where the user is.
for (const endpoint of ["/run/stop_voice", "/run/mute_voice", "/run/resume_voice"]) {
    test(`a failed ${endpoint} is told with a notice`, async () => {
        const s = await loadBridgeRoutes();
        s.receiveRoutes({ endpoint, status: 409, result: { error_code: "voice_route_closed" } });
        assert.equal(s.notices.length, 1);
        assert.equal(s.notices[0].type, "error");
        assert.match(String(s.notices[0].key), /voice_route_closed/);
    });
}

test("a failed voice settings read stays on the settings page", async () => {
    const s = await loadBridgeRoutes();
    s.receiveRoutes({ endpoint: "/get/data/voice_status", status: 500, result: { error_code: "voice_request_failed" } });
    assert.deepEqual(s.notices, []);
});

// #937: the stop's press is answered on the button. The core's answer says it has stopped; a
// refusal ends the press at once, and the notice above says why.
test("the stop's answer ends its press: stopped when the core has stopped, idle at once when refused", async () => {
    const s = await loadBridgeRoutes();
    await s.stopVoice().press();
    assert.equal(s.stopVoice().stop.phase, "stopping");
    s.receiveRoutes({ endpoint: "/run/stop_voice", status: 200, result: { active: false, queued: 0 } });
    assert.equal(s.stopVoice().stop.phase, "stopped");

    const refused = await loadBridgeRoutes();
    await refused.stopVoice().press();
    refused.receiveRoutes({ endpoint: "/run/stop_voice", status: 409, result: { error_code: "voice_route_closed" } });
    assert.equal(refused.stopVoice().stop.phase, "idle");
    assert.equal(refused.notices.length, 1);
});
