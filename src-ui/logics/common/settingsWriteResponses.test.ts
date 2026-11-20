import assert from "node:assert/strict";
import { test } from "vitest";
import { createSettingsWriteResponses } from "./settingsWriteResponses.ts";
import type { SettingsWriteRequest } from "./settingsWriteResponses.ts";
import type { BackendResponse } from "./pendingRequestRecovery.ts";

// A write the test goes on to read: it reads the request's response, which only a request has.
const begun = (request: SettingsWriteRequest | false | null) => { assert.ok(request); return request; };
// A reply as the test reads it: false has no status or result.
const replyOf = (response: BackendResponse | false) => response || undefined;

for (const name of ["voice_settings", "direct_voice_settings", "speech_server_settings", "realtime_asr_settings", "hotkeys",
    "openai_compatible_auth_key_and_url", "custom_whisper_auth_key_and_url",
    "mic_word_filter", "send_message_format_parts", "received_message_format_parts", "overlay_small_log_settings", "overlay_large_log_settings",
    "osc_ip_address", "osc_port", "websocket_host", "websocket_port", "websocket_tls", "ocr_window_title", "obs_browser_source_port",
    "obs_browser_source_max_messages", "obs_browser_source_display_duration", "obs_browser_source_fadeout_duration",
    "obs_browser_source_font_size", "obs_browser_source_font_color", "obs_browser_source_font_outline_thickness", "obs_browser_source_font_outline_color",
    "rvc_block_ms", "deepl_auth_key", "plamo_auth_key", "gemini_auth_key", "openai_auth_key", "groq_auth_key", "openrouter_auth_key",
    "lmstudio_url", "openai_compatible_url", "openai_compatible_auth_key", "ollama_url", "groq_whisper_auth_key",
    "google_cloud_auth_key", "papago_client_id", "papago_auth_key",
    "openai_whisper_auth_key", "custom_whisper_url", "custom_whisper_auth_key", "deepgram_auth_key"]) {
    test(`${name} matches write responses in order and ignores polls`, async () => {
        const requests = createSettingsWriteResponses(), endpoint = `/set/data/${name}`;
        const first = begun(requests.begin(endpoint)), second = begun(requests.begin(endpoint));
        let settled = false;
        second.response.then(() => { settled = true; });
        requests.receive({ endpoint: `/get/data/${name}`, status: 200, result: {} });
        requests.receive({ endpoint, status: 400, result: { error_code: "rejected" } });
        assert.equal(replyOf(await first.response)?.status, 400);
        assert.equal(settled, false);
        const reply = { endpoint, status: 200, result: { canonical: true } };
        requests.receive(reply);
        assert.equal(await second.response, reply);
    });
}

test("a new connection key waits for the backend's reply", async () => {
    const requests = createSettingsWriteResponses(), endpoint = "/run/regenerate_websocket_auth_token";
    const request = requests.begin(endpoint);
    assert.ok(request, "the regeneration is matched with its reply");
    const reply = { endpoint, status: 200, result: "new-token" };
    requests.receive(reply);
    assert.equal(await request.response, reply);
});

test("pre-send failures release ownership while uncertain delivery blocks another write until its reply", async () => {
    const requests = createSettingsWriteResponses(), endpoint = "/set/data/voice_settings";
    const unsent = begun(requests.begin(endpoint));
    requests.fail(unsent, false);
    assert.equal(await unsent.response, false);
    const uncertain = begun(requests.begin(endpoint));
    requests.fail(uncertain, true);
    assert.equal(await uncertain.response, false);
    assert.equal(requests.begin(endpoint), false);
    requests.receive({ endpoint, status: 200, result: {} });
    const retry = begun(requests.begin(endpoint));
    requests.receive({ endpoint, status: 200, result: { retry: true } });
    assert.deepEqual(replyOf(await retry.response)?.result, { retry: true });
});

test("session stop releases all owners and a fresh session can write", async () => {
    const requests = createSettingsWriteResponses(), endpoint = "/set/data/realtime_asr_settings";
    const old = begun(requests.begin(endpoint));
    requests.stop();
    assert.equal(await old.response, false);
    const next = begun(requests.begin(endpoint));
    requests.receive({ endpoint, status: 200, result: {} });
    assert.equal(replyOf(await next.response)?.status, 200);
    assert.equal(requests.begin("/get/data/realtime_asr_settings"), null);
});

test("text deletion responses do not acknowledge a pending replacement", async () => {
    const requests = createSettingsWriteResponses();
    const set = begun(requests.begin("/set/data/deepl_auth_key"));
    const remove = begun(requests.begin("/delete/data/deepl_auth_key"));
    let setSettled = false;
    set.response.then(() => { setSettled = true; });
    requests.receive({ endpoint: "/delete/data/deepl_auth_key", status: 200, result: null });
    assert.equal(replyOf(await remove.response)?.result, null);
    assert.equal(setSettled, false);
    requests.receive({ endpoint: "/set/data/deepl_auth_key", status: 400 });
    assert.equal(replyOf(await set.response)?.status, 400);
});
