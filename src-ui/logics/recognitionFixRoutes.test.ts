import assert from "node:assert/strict";
import { test } from "vitest";
import { loadBridgeRoutes } from "./test/bridgeHarness.ts";

// #1225: a Mic input or Listening switch refused for missing models, or for a language the model
// does not take, opens the fix where the switch is instead of a notice that names a settings page.
test("a refusal the main screen can fix opens the fix; the switch settles off and nothing is downloaded", async () => {
    const s = await loadBridgeRoutes();
    s.receiveRoutes({ endpoint: "/set/enable/transcription_receive", status: 400,
        result: { error_code: "TRANSCRIPTION_RECEIVE_NOT_READY", data: false,
            details: { reason: "realtime_language_auto_unsupported", languages: ["ja"] } } });
    assert.deepEqual(s.recognitionFix().request, { endpoint: "/set/enable/transcription_receive", source: "speaker", kind: "language",
        reason: "realtime_language_auto_unsupported", languages: ["ja"], auto: true });
    assert.deepEqual(s.notices, []);
    assert.equal(s.runtime.store.get(s.stores.Atom_TranscriptionReceiveStatus).data, false);
    // The routes read the speech state again, as for any refusal; nothing is downloaded.
    assert.deepEqual(s.reads.filter(endpoint => endpoint.includes("model_download")), []);

    s.receiveRoutes({ endpoint: "/set/enable/transcription_send", status: 400,
        result: { error_code: "TRANSCRIPTION_SEND_NOT_READY", data: false, details: { reason: "realtime_asr_model_missing" } } });
    assert.equal(s.recognitionFix().request?.kind, "models");
    assert.equal(s.recognitionFix().request?.source, "mic");
    assert.equal(s.runtime.store.get(s.stores.Atom_TranscriptionSendStatus).data, false);
    assert.deepEqual(s.notices, []);
});

test("a refusal it cannot fix stays a notice", async () => {
    const s = await loadBridgeRoutes();
    s.receiveRoutes({ endpoint: "/set/enable/transcription_receive", status: 400,
        result: { error_code: "TRANSCRIPTION_RECEIVE_NOT_READY", data: false, details: { reason: "speech_server_autostart_off" } } });
    assert.equal(s.recognitionFix().request, null);
    assert.equal(s.notices.length, 1);
});
