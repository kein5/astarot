import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBridgeRoutes } from "../test/bridgeHarness.js";

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
