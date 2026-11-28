import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { test, vi } from "vitest";
import { featureResyncReads } from "./common/pendingRequestRecovery.ts";
import * as fieldErrors from "./configs/fieldErrors.ts";
import { expectBackendExit } from "./common/sidecarExitExpectation.ts";
import type { ExitExpectingSession } from "./common/sidecarExitExpectation.ts";
import { requests } from "./test/ipcReference.ts";
import { localeAt, readLocale } from "./test/locales.ts";
import { ACTIVE_SETUP_PHASES, loadRecordedRoutes, translate } from "./test/routeRecorder.ts";
import type { Call, HookValues, RecordedRoutes } from "./test/routeRecorder.ts";

// What useReceiveRoutes does with an answer besides handing it to its route (routeTable.test.ts):
// the requests it sends after one, the errors it gives a feature, the notices it shows, and the
// polls it keeps while a feature is busy. The hooks are recorders (test/routeRecorder.ts).

const call = (name: string, ...args: unknown[]): Call => ({ name, args });
// A field of a value a hook was given.
const fieldOf = (value: unknown, name: string): unknown => typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
// The calls besides the language mutations, which every answer passes on.
const callsOf = (r: RecordedRoutes) => r.calls.filter(({ name }) => !name.startsWith("languageMutations."));
// The requests the routes sent to the core, through any feature's send or asyncStdoutToPython.
const sent = (r: RecordedRoutes) => r.calls.filter(({ name }) => name.endsWith(".send") || name === "useStdoutToPython.asyncStdoutToPython")
    .map(({ args }) => args[0]);

test("a log without an endpoint is read with the endpoint \"\", and a message without a status stops", async () => {
    const r = await loadRecordedRoutes();
    r.receiveRoutes({ status: 348, log: "started" });
    assert.deepEqual(r.calls.map(({ name, args }) => [name, args[0]]),
        [["languageMutations.receiveLanguageMutation", { status: 348, log: "started", endpoint: "" }]]);
    for (const message of [null, "text", { endpoint: "/get/data/version" }, { endpoint: 1, status: 200 },
        { endpoint: null, status: 348 }, { status: "348" }]) {
        assert.throws(() => r.receiveRoutes(message), { name: "TypeError", message: /has a status/ }, JSON.stringify(message));
    }
});

test("the end of initialization starts each feature afresh, asks for its state and says the backend is ready", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/initialization_complete", 200, {});
    assert.deepEqual(r.calls, [
        call("useModelDownloads.reset"),
        call("useModelDownloads.send", "/get/data/model_download_catalog"),
        call("useModelDownloads.send", "/get/data/model_download_state"),
        call("useModelDownloads.send", "/get/data/user_models"),
        call("useTranslationCatalog.reset"),
        call("useTranslationCatalog.send", "/get/data/translation_catalog"),
        call("useTranscriptionCatalog.reset"),
        call("useTranscriptionCatalog.send", "/get/data/transcription_catalog"),
        call("useVcRuntimes.reset"),
        call("useVoice.reset"),
        call("useVoice.send", "/get/data/voice_settings"),
        call("useVoice.send", "/get/data/direct_voice_sources"),
        call("useSpeechServers.reset"),
        call("useSpeechServers.send", "/get/data/speech_server_settings"),
        call("useSpeechServers.send", "/get/data/speech_server_state"),
        call("useRealtimeASR.reset"),
        call("useVirtualMic.reset"),
        call("useVoiceAudition.reset"),
        call("useStopVoice.reset"),
        call("useGpuCheck.reset"),
        call("useFirstRunSetup.reset"),
        call("useTalkAiSession.reset"),
        call("useRealtimeASR.send", "/get/data/realtime_asr_settings"),
        call("useRealtimeASR.send", "/get/data/realtime_asr_state"),
        call("useRealtimeASR.send", "/get/data/realtime_asr_models"),
        call("useRealtimeASR.send", "/get/data/realtime_asr_endpoints", { source: "mic" }),
        call("useRealtimeASR.send", "/get/data/realtime_asr_endpoints", { source: "speaker" }),
        call("useIsBackendReady.updateIsBackendReady", true),
        call("languageMutations.resetLanguageMutations"),
    ]);
});

test("a degraded start warns in the UI language the same answer brings", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadRecordedRoutes();
    r.receive("/run/initialization_complete", 200, { "/get/data/ui_language": "ja", "/get/data/selected_tab_no": null });
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Warning"),
        [["ja:common_warning.startup_degraded", { hide_duration: null, category_id: "startup_degraded" }]]);
    const other = await loadRecordedRoutes();
    other.receive("/run/initialization_complete", 200, { "/get/data/ui_language": 1, "/get/data/selected_tab_no": null });
    assert.deepEqual(other.argsOf("useNotificationStatus.showNotification_Warning"),
        [["common_warning.startup_degraded", { hide_duration: null, category_id: "startup_degraded" }]]);
});

test("everything the routes ask the core for is a request the core answers", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/initialization_complete", 200, {});
    for (const endpoint of ["/run/register_translation_catalog_entry", "/set/enable/obs_browser_source", "/set/data/selected_mic_device",
        "/run/apply_model_download", "/set/data/voice_settings", "/run/enable_tts", "/set/enable/transcription_send"]) r.receive(endpoint, 200, {});
    for (const endpoint of ["/run/enable_tts", "/run/start_speech_server", "/run/start_direct_voice"]) r.receive(endpoint, 500, {});
    for (const endpoint of Object.keys(featureResyncReads)) r.receive(endpoint, 500, {});
    const unknown = sent(r).filter(endpoint => typeof endpoint !== "string" || !requests.has(endpoint));
    assert.ok(sent(r).length > 40, String(sent(r).length));
    assert.deepEqual(unknown, []);
});

test("a write that failed with 500 reads its feature's state again, and other failures do not", async () => {
    for (const [endpoint, read] of Object.entries(featureResyncReads)) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 400, { error_code: "invalid" });
        assert.ok(!r.argsOf("useStdoutToPython.asyncStdoutToPython").some(([value]) => value === read), `${endpoint} 400`);
        r.receive(endpoint, 500, "Internal error");
        assert.deepEqual(r.argsOf("useStdoutToPython.asyncStdoutToPython").filter(([value]) => value === read), [[read]], endpoint);
    }
});

test("an answer a newer write has overtaken is dropped, not handed to its route", async () => {
    const r = await loadRecordedRoutes();
    r.recovery.register({ endpoints: ["/set/data/voice_settings"], read: "/get/data/voice_settings", restore: () => true });
    r.receive("/set/data/voice_settings", 500, "Internal error");
    r.recovery.beginSend("/set/data/voice_settings");
    r.clear();
    r.receive("/get/data/voice_settings", 200, { mode: "original" });
    assert.deepEqual(r.calls, []);
    r.receive("/get/data/voice_settings", 200, { mode: "original" });
    assert.deepEqual(r.argsOf("useVoice.updateSettings"), [[{ mode: "original" }]]);
});

for (const status of [400, 404, 423, 500]) test(`a message the backend could not send (${status}) settles its row`, async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/send_message_box", status, { error_code: "send_failed", data: { id: "row-1" } });
    r.receive("/run/send_message_box", status, "Internal error");
    assert.deepEqual(r.argsOf("useMessage.failSentMessageLog"), [[{ id: "row-1" }], ["Internal error"]]);
});

test("a sent message that is answered, or refused for another reason, keeps its row", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/send_message_box", 200, { id: "row-1" });
    r.receive("/run/send_message_box", 409, { error_code: "busy", data: { id: "row-1" } });
    assert.deepEqual(r.argsOf("useMessage.failSentMessageLog"), []);
    assert.deepEqual(r.argsOf("useMessage.updateSentMessageLogById"), [[{ id: "row-1" }]]);
});

// A request that fails without a code is reported with a code the UI makes; the page shows it from
// the sections it looks in (src-ui/logics/voice/uiErrorCodes.test.ts lists them).
const FEATURE_FAILURES = [
    { endpoint: "/run/start_vc_runtime_setup", report: "useVcRuntimes.updateError", sections: ["vc_runtime.errors"], extra: [] },
    { endpoint: "/get/data/vc_runtime_state", report: "useVcRuntimes.updateError", sections: ["vc_runtime.errors"], extra: [] },
    { endpoint: "/run/start_model_download", report: "useModelDownloads.updateError", sections: ["model_downloads.errors"], extra: ["/run/start_model_download"] },
    { endpoint: "/run/register_user_model", report: "useModelDownloads.updateError", sections: ["model_downloads.errors"], extra: ["/run/register_user_model"] },
    { endpoint: "/run/enable_tts", report: "useVoice.updateTtsError", sections: ["voice_ui.errors", "voice.input_errors"], extra: ["/run/enable_tts", 500] },
    { endpoint: "/run/disable_tts", report: "useVoice.updateTtsError", sections: ["voice_ui.errors", "voice.input_errors"], extra: ["/run/disable_tts", 500] },
    { endpoint: "/run/start_speech_server", report: "useSpeechServers.updateError", sections: ["speech_servers.errors", "voice_ui.errors"], extra: [] },
    { endpoint: "/run/start_realtime_asr", report: "useRealtimeASR.updateError", sections: ["realtime_toggle", "voice_ui.errors"], extra: [] },
    { endpoint: "/run/start_direct_voice", report: "useVoice.updateDirectError", sections: ["voice_setup_errors", "voice_ui.errors"], extra: ["/run/start_direct_voice", 500] },
    { endpoint: "/get/data/voice_status", report: "useVoice.updateError", sections: ["voice_ui.errors", "voice.input_errors"], extra: [] },
];
const LOCALES = ["en", "ja"].map(language => ({ language, locale: readLocale(language) }));

for (const { endpoint, report, sections, extra } of FEATURE_FAILURES) {
    test(`a failed ${endpoint} gives its page the code, or one the page has a text for`, async () => {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 500, { error_code: "feature_code" });
        r.receive(endpoint, 500, "Internal error");
        const [given, made] = r.argsOf(report);
        assert.deepEqual(given, ["feature_code", ...extra]);
        assert.deepEqual(made.slice(1), extra);
        const code = String(made[0]);
        for (const { language, locale } of LOCALES) {
            assert.ok(sections.some(section => typeof localeAt(locale, `${section}.${code}`) === "string"), `${language}: ${code}`);
        }
        // The feature's page says it; no notice says it again.
        assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Error"), []);
    });
}

test("a failed translation catalog change goes to the catalog, without a notice", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/register_translation_catalog_entry", 400, { error_code: "catalog_entry_invalid" });
    r.receive("/get/data/translation_catalog", 500, "Internal error");
    assert.deepEqual(r.argsOf("useTranslationCatalog.fail"), [["catalog_entry_invalid"], [undefined]]);
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Error"), []);
    assert.deepEqual(r.argsOf("_useBackendErrorHandling.errorHandling_Backend"), []);
});

test("a catalog entry that came, went or was used asks again for the models and engine it may change", async () => {
    const reads = ["/get/data/selectable_ctranslate2_weight_type_dict", "/get/data/selected_ctranslate2_weight_type",
        "/get/data/openai_compatible_url", "/get/data/openai_compatible_auth_key",
        "/get/data/selectable_openai_compatible_model_list", "/get/data/selected_openai_compatible_model"];
    for (const endpoint of ["/run/register_translation_catalog_entry", "/run/remove_translation_catalog_entry", "/run/use_translation_catalog_entry"]) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 200, {});
        assert.deepEqual(r.argsOf("useStdoutToPython.asyncStdoutToPython"), reads.map(read => [read]), endpoint);
    }
    const r = await loadRecordedRoutes();
    r.receive("/get/data/translation_catalog", 200, {});
    assert.deepEqual(r.argsOf("useStdoutToPython.asyncStdoutToPython"), []);
});

// The translation catalog's cards of the built-in models say which one is in use and which can be
// used (#1228). They are read again once the model in use was set, and once a downloaded model was
// counted as on the PC (the core applied a download of the model catalog): before, a model downloaded
// from its card stayed "Not downloaded" there, and pressing the card opened its review again.
test("the translation catalog is read again once the model in use or the models on the PC changed", async () => {
    for (const [endpoint, result] of [["/set/data/selected_ctranslate2_weight_type", "m2m100_418M-ct2-int8"],
        ["/run/downloaded_ctranslate2_weight", { weight_type: "m2m100_418M-ct2-int8", downloaded: true }]] as const) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 200, result);
        assert.deepEqual(r.argsOf("useTranslationCatalog.send"), [["/get/data/translation_catalog"]], endpoint);
        // A refusal changed nothing: nothing is read again.
        const refused = await loadRecordedRoutes();
        refused.receive(endpoint, 400, { error_code: "weight_invalid" });
        assert.deepEqual(refused.argsOf("useTranslationCatalog.send"), [], `${endpoint} refused`);
    }
    // Progress of a download is not a model on the PC yet.
    const progress = await loadRecordedRoutes();
    progress.receive("/run/download_progress_ctranslate2_weight", 200, { weight_type: "m2m100_418M-ct2-int8", progress: 0.5 });
    assert.deepEqual(progress.argsOf("useTranslationCatalog.send"), []);
});

test("a refused speaker name says so with a notice and goes no further", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/set/data/speaker_names", 500, "Internal error");
    assert.deepEqual(callsOf(r), [call("useNotificationStatus.showNotification_Error",
        "main_page.message_log.speaker_names_failed", { category_id: "speaker_names" })]);
});

test("enabling the OBS source asks for the WebSocket server it starts", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/set/enable/obs_browser_source", 400, { error_code: "invalid" });
    r.receive("/set/disable/obs_browser_source", 200, false);
    assert.deepEqual(r.argsOf("useStdoutToPython.asyncStdoutToPython"), []);
    r.receive("/set/enable/obs_browser_source", 200, true);
    assert.deepEqual(r.argsOf("useStdoutToPython.asyncStdoutToPython"), [["/get/data/websocket_server"]]);
});

test("a microphone chosen on the device page asks for the voice input sources again", async () => {
    for (const endpoint of ["/set/data/selected_mic_host", "/set/data/selected_mic_device", "/run/selected_mic_host", "/run/selected_mic_device"]) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 400, { error_code: "invalid" });
        assert.deepEqual(r.argsOf("useVoice.send"), [], endpoint);
        r.receive(endpoint, 200, "Mic");
        assert.deepEqual(r.argsOf("useVoice.send"), [["/get/data/direct_voice_sources"]], endpoint);
    }
    const r = await loadRecordedRoutes();
    r.receive("/set/data/selected_speaker_device", 200, "Speaker");
    assert.deepEqual(r.argsOf("useVoice.send"), []);
});

test("an applied model asks for the speech server settings and the voice input state", async () => {
    for (const endpoint of ["/run/apply_model_download", "/run/apply_user_model"]) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 200, {});
        assert.deepEqual(r.argsOf("useSpeechServers.send"), [["/get/data/speech_server_settings"]], endpoint);
        assert.deepEqual(r.argsOf("useVoice.send"), [["/get/data/direct_voice_state"]], endpoint);
    }
    const r = await loadRecordedRoutes();
    r.receive("/run/start_model_download", 200, {});
    assert.deepEqual([...r.argsOf("useSpeechServers.send"), ...r.argsOf("useVoice.send")], []);
});

test("the TTS switch keeps the speech servers in step, and a refusal reads the voice status again", async () => {
    for (const endpoint of ["/run/enable_tts", "/run/disable_tts"]) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 200, { enabled: true });
        assert.deepEqual(callsOf(r), [call("useSpeechServers.send", "/get/data/speech_server_state"),
            call("useVoice.updateStatus", { enabled: true })], endpoint);
        r.clear();
        r.receive(endpoint, 409, { error_code: "tts_engine_missing" });
        assert.deepEqual(callsOf(r), [call("useSpeechServers.send", "/get/data/speech_server_state"),
            call("useVoice.updateTtsError", "tts_engine_missing", endpoint, 409),
            call("useVoice.send", "/get/data/voice_status")], endpoint);
    }
});

test("a failed speech server request reads the servers' state again, unless it was that read", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/start_speech_server", 409, { error_code: "speech_server_busy" });
    assert.deepEqual(callsOf(r), [call("useSpeechServers.updateError", "speech_server_busy"),
        call("useSpeechServers.send", "/get/data/speech_server_state")]);
    r.clear();
    r.receive("/get/data/speech_server_state", 500, "Internal error");
    assert.deepEqual(callsOf(r), [call("useSpeechServers.updateError", "speech_server_request_failed")]);
});

test("the transcription switches keep the speech servers and realtime recognition in step", async () => {
    for (const endpoint of ["/set/enable/transcription_send", "/set/disable/transcription_send",
        "/set/enable/transcription_receive", "/set/disable/transcription_receive"]) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 200, true);
        assert.deepEqual(r.argsOf("useSpeechServers.send"), [["/get/data/speech_server_state"]], endpoint);
        assert.deepEqual(r.argsOf("useRealtimeASR.send"), [["/get/data/realtime_asr_state"]], endpoint);
    }
    const r = await loadRecordedRoutes();
    r.receive("/set/enable/translation", 200, true);
    assert.deepEqual([...r.argsOf("useSpeechServers.send"), ...r.argsOf("useRealtimeASR.send")], []);
});

test("a failed virtual microphone check goes to the check, without a notice", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/virtual_mic_test", 500, { error_code: "virtual_mic_missing" });
    assert.deepEqual(callsOf(r), [call("useVirtualMic.failCheck", "virtual_mic_missing")]);
});

test("a refused GPU check or audition says why on its card; a failed stop or poll leaves it as it is", async () => {
    for (const [feature, start, others] of [
        ["useGpuCheck", "/run/start_gpu_check", ["/run/stop_gpu_check", "/get/data/gpu_check_state"]],
        ["useVoiceAudition", "/run/start_voice_audition", ["/run/stop_voice_audition", "/get/data/voice_audition_state"]],
    ] as const) {
        const r = await loadRecordedRoutes();
        r.receive(start, 500, { error_code: "busy" });
        assert.deepEqual(callsOf(r), [call(`${feature}.fail`, "busy")], start);
        r.clear();
        for (const endpoint of others) r.receive(endpoint, 500, { error_code: "busy" });
        assert.deepEqual(callsOf(r), [], feature);
    }
});

test("a refused Talk AI request says why on its page; a refused setting of it does not go there", async () => {
    const r = await loadRecordedRoutes();
    for (const endpoint of ["/set/enable/talk_ai", "/set/enable/talk_ai_audio", "/set/enable/talk_ai_screen", "/set/data/talk_ai_auth_key"]) {
        r.receive(endpoint, 409, { error_code: "talk_not_ready" });
        assert.deepEqual(callsOf(r), [call("useTalkAiSession.fail", "talk_not_ready", endpoint)], endpoint);
        r.clear();
    }
    // A refusal without a code gets the UI's own.
    r.receive("/set/disable/talk_ai_screen", 500, null);
    assert.deepEqual(callsOf(r), [call("useTalkAiSession.fail", "talk_request_failed", "/set/disable/talk_ai_screen")]);
    r.clear();
    // The settings go the way of every setting: under their field, or as a notice.
    r.receive("/set/data/talk_ai_local_url", 400, { error_code: "talk_settings_invalid" });
    assert.equal(callsOf(r).some(({ name }) => name === "useTalkAiSession.fail"), false);
});

test("a new address of the local Talk AI server reads the catalog that shows it", async () => {
    for (const endpoint of ["/set/data/talk_ai_local_url", "/set/data/talk_ai_provider"]) {
        const r = await loadRecordedRoutes();
        r.receive(endpoint, 200, "ws://127.0.0.1:8001/v1/realtime");
        assert.ok(sent(r).includes("/get/data/talk_ai_catalog"), endpoint);
    }
});

test("microphone recognition refused while Talk AI has the microphone says why where it was pressed", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/set/enable/transcription_send", 409, { error_code: "talk_microphone_in_use" });
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Warning"),
        [["talk_ai.errors.talk_microphone_in_use", { category_id: "talk_microphone_in_use" }]]);
    for (const language of ["en", "ja"]) assert.equal(typeof localeAt(readLocale(language), "talk_ai.errors.talk_microphone_in_use"), "string");
});

test("a failed realtime recognition request goes to its page", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/start_realtime_asr", 409, { error_code: "realtime_model_missing" });
    assert.deepEqual(callsOf(r), [call("useRealtimeASR.updateError", "realtime_model_missing")]);
});

test("a failed voice input request reads its state again when the core may have changed it", async () => {
    for (const status of [404, 423, 500]) {
        const r = await loadRecordedRoutes();
        r.receive("/run/start_direct_voice", status, { error_code: "source_missing" });
        assert.deepEqual(callsOf(r), [call("useVoice.updateDirectError", "source_missing", "/run/start_direct_voice", status),
            call("useVoice.send", "/get/data/direct_voice_state")], String(status));
        r.clear();
        r.receive("/get/data/direct_voice_state", status, { error_code: "source_missing" });
        assert.deepEqual(callsOf(r), [call("useVoice.updateDirectError", "source_missing", "/get/data/direct_voice_state", status)]);
    }
    const r = await loadRecordedRoutes();
    r.receive("/run/stop_direct_voice", 409, { error_code: "source_missing" });
    assert.deepEqual(callsOf(r), [call("useVoice.updateDirectError", "source_missing", "/run/stop_direct_voice", 409)]);
});

test("a failed stop or mute is said with a notice where the user is, naming its page", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/stop_voice", 409, { error_code: "voice_route_closed" });
    assert.deepEqual(callsOf(r), [call("useVoice.updateError", "voice_route_closed"), call("useStopVoice.failed"),
        call("useNotificationStatus.showNotification_Error", `voice_route_closed · ${translate("voice_ui.check_settings", { page: "main_page.tts" })}`,
            { category_id: "voice_action:/run/stop_voice" })]);
    for (const endpoint of ["/run/mute_voice", "/run/resume_voice"]) {
        const mute = await loadRecordedRoutes({ exists: key => key === "voice_ui.errors.voice_route_closed" });
        mute.receive(endpoint, 409, { error_code: "voice_route_closed" });
        assert.deepEqual(callsOf(mute), [call("useVoice.updateError", "voice_route_closed"),
            call("useNotificationStatus.showNotification_Error", "voice_ui.errors.voice_route_closed",
                { category_id: `voice_action:${endpoint}` })], endpoint);
        const page = await loadRecordedRoutes();
        page.receive(endpoint, 409, {});
        assert.deepEqual(page.argsOf("useNotificationStatus.showNotification_Error")[0][0],
            `voice_request_failed · ${translate("voice_ui.check_settings", { page: "voice_ui.mute_row" })}`);
    }
});

test("a stop the stopped engine could not take is not told again, but one the engine refused is", async () => {
    const stopped = await loadRecordedRoutes();
    stopped.receive("/run/stop_voice", 500, { error_code: "backend_unavailable" });
    assert.deepEqual(stopped.argsOf("useNotificationStatus.showNotification_Error"), []);
    assert.deepEqual(stopped.argsOf("useVoice.updateError"), [["backend_unavailable"]]);
    const running = await loadRecordedRoutes();
    running.store.backend_subprocess = { pid: 1 };
    running.receive("/run/stop_voice", 500, { error_code: "backend_unavailable" });
    assert.equal(running.argsOf("useNotificationStatus.showNotification_Error").length, 1);
});

test("a failed voice settings request stays on the voice page", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/set/data/voice_settings", 400, { error_code: "VOICE_SETTINGS_INVALID" });
    assert.deepEqual(callsOf(r), [call("useVoice.updateError", "VOICE_SETTINGS_INVALID")]);
});

test("an audio device that went away says which one took its place", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/audio_device_switched", 200, { source: "mic", old_device: { name: "USB Mic", id: "a" }, new_device: { name: "Headset", id: "b" } });
    r.receive("/run/audio_device_switched", 200, { source: "speaker", old_device: { name: "Speakers", id: "1" }, new_device: { name: "Speakers", id: "2" } });
    r.receive("/run/audio_device_switched", 200, { source: "speaker", old_device: { name: "Speakers" }, new_device: { name: "Speakers", id: "2" } });
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Warning"), [
        [translate("common_warning.audio_device_switched.mic", { old: "USB Mic", new: "Headset" }), { category_id: "audio_device_switched.mic" }],
        [translate("common_warning.audio_device_switched.speaker", { old: "Speakers (1)", new: "Speakers (2)" }), { category_id: "audio_device_switched.speaker" }],
        [translate("common_warning.audio_device_switched.speaker", { old: "Speakers", new: "Speakers (2)" }), { category_id: "audio_device_switched.speaker" }],
    ]);
});

test("a device switch the UI cannot read shows nothing", async () => {
    const r = await loadRecordedRoutes();
    for (const result of [null, { source: "camera", old_device: { name: "A" }, new_device: { name: "B" } },
        { source: "mic", old_device: { name: 1 }, new_device: { name: "B" } }, { source: "mic", old_device: { name: "A" }, new_device: {} },
        { source: "speaker", old_device: "A", new_device: { name: "B" } }, { source: "mic", new_device: { name: "B" } }]) {
        r.receive("/run/audio_device_switched", 200, result);
    }
    assert.deepEqual(callsOf(r), []);
});

test("translation moved to the CPU says which device could not start it", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/translation_compute_device_fallback", 200, { requested: "cuda:0" });
    r.receive("/run/translation_compute_device_fallback", 200, {});
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Warning"), [
        [translate("common_warning.translation_device_fallback", { device: "cuda:0" }), { category_id: "translation_device_fallback" }],
        [translate("common_warning.translation_device_fallback", { device: "" }), { category_id: "translation_device_fallback" }],
    ]);
});

test("a config file that could not be saved says why, and a reason the UI does not know reads as a failed write", async () => {
    const r = await loadRecordedRoutes();
    for (const reason of ["disk_full", "permission_denied", "read_only", "load_failed", "quota", 5]) {
        r.receive("/run/config_save_failed", 200, { reason, path: "/settings/config.json" });
    }
    r.receive("/run/config_save_failed", 200, {});
    const options = { hide_duration: null, category_id: "config_save_failed" };
    const file = { file: "/settings/config.json" };
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Error"), [
        [translate("common_error.config_save_failed.disk_full", file), options],
        [translate("common_error.config_save_failed.permission_denied", file), options],
        [translate("common_error.config_save_failed.read_only", file), options],
        [translate("common_error.config_save_failed.load_failed", file), options],
        [translate("common_error.config_save_failed.write_failed", file), options],
        [translate("common_error.config_save_failed.write_failed", file), options],
        [translate("common_error.config_save_failed.write_failed", { file: "" }), options],
    ]);
});

test("a config file saved again takes the failure notice away", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/config_save_recovered", 200, null);
    assert.deepEqual(callsOf(r), [call("useNotificationStatus.dismissNotification", "config_save_failed"),
        call("useNotificationStatus.showNotification_Success", "common_error.config_save_failed.recovered", { category_id: "config_save_recovered" })]);
});

test("an unreadable config file says where the old one was kept", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/config_file_unreadable", 200, { backup: "/settings/config.json.bak" });
    r.receive("/run/config_file_unreadable", 200, null);
    const options = { hide_duration: null, category_id: "config_file_unreadable" };
    assert.deepEqual(callsOf(r), [
        call("useNotificationStatus.showNotification_Warning", translate("common_warning.config_file_unreadable", { file: "/settings/config.json.bak" }), options),
        call("useNotificationStatus.showNotification_Warning", translate("common_warning.config_file_unreadable", { file: "" }), options),
    ]);
});

test("the language mutations see a failure before it is handled and an answer after its route", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/set/data/selected_tab_no", 200, "2");
    assert.deepEqual(r.names(), ["useLanguageSettings.updateSelectedPresetTabNumber", "languageMutations.receiveLanguageMutation"]);
    r.clear();
    r.receive("/set/data/selected_tab_no", 404, {});
    assert.deepEqual(r.names(), ["languageMutations.receiveLanguageMutation", "useNotificationStatus.showNotification_Error"]);
    assert.deepEqual(r.calls[0].args[0], { endpoint: "/set/data/selected_tab_no", status: 404, result: {} });
});

test("the stop's answer is told to the stop button after the voice status it carries", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/stop_voice", 200, { active: false });
    assert.deepEqual(callsOf(r), [call("useVoice.updateStatus", { active: false }), call("useStopVoice.answered")]);
    r.clear();
    r.receive("/run/mute_voice", 200, { muted: true });
    assert.deepEqual(callsOf(r), [call("useVoice.updateRoute", { muted: true })]);
});

test("a 400 goes to the error handling with what its result says, and whether a field says it", async () => {
    const r = await loadRecordedRoutes();
    const result = { error_code: "DEEPL_AUTH_KEY_INVALID", message: "Invalid key", data: "old-key" };
    // The key field waits for the answer to its own save (#1324): the first refusal is its.
    fieldErrors.awaitInlineAnswer("/set/data/deepl_auth_key");
    r.receive("/set/data/deepl_auth_key", 400, result);
    r.receive("/set/data/deepl_auth_key", 400, { error_code: 1, message: false });
    assert.deepEqual(r.argsOf("_useBackendErrorHandling.errorHandling_Backend"), [
        [{ error_code: "DEEPL_AUTH_KEY_INVALID", message: "Invalid key", data: "old-key", endpoint: "/set/data/deepl_auth_key", result, saidInline: true }],
        [{ error_code: undefined, message: undefined, data: undefined, endpoint: "/set/data/deepl_auth_key", result: { error_code: 1, message: false },
            saidInline: false }],
    ]);
    assert.throws(() => r.receive("/set/data/deepl_auth_key", 400, null), { name: "TypeError", message: /carries its error/ });
    assert.throws(() => r.receive("/set/data/deepl_auth_key", 400), { name: "TypeError", message: /carries its error/ });
});

test("a request the core could not take (404, 423) is told, unless a language change tells it itself", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [404, 423]) {
        const r = await loadRecordedRoutes();
        r.receive("/set/enable/translation", status, {});
        assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Error"),
            [[`common_error.request_${status}`, { category_id: `request_${status}` }]]);
        const language = await loadRecordedRoutes({ isLanguageMutation: endpoint => endpoint === "/set/data/selected_tab_no" });
        language.receive("/set/data/selected_tab_no", status, {});
        assert.deepEqual(language.argsOf("useNotificationStatus.showNotification_Error"), []);
    }
});

test("an unexpected error (500) is told with the endpoint, until the user closes it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadRecordedRoutes();
    r.receive("/set/enable/translation", 500, "Internal error");
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Error"),
        [[translate("common_error.unexpected_error", { code: "/set/enable/translation" }), { hide_duration: null }]]);
});

test("a log, a refused VR panel request and an unknown status show nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await loadRecordedRoutes();
    for (const status of [348, 403, 409, 202]) r.receive("/set/enable/translation", status, {});
    assert.deepEqual(callsOf(r), []);
});

test("a stopped backend settles every request still waiting", async () => {
    const r = await loadRecordedRoutes();
    let restored = 0;
    r.recovery.register({ endpoints: ["/set/data/voice_settings"], restore: () => { restored++; return true; } });
    r.backendStopped();
    assert.equal(restored, 1);
    assert.deepEqual(r.calls, [call("useMessage.failSentMessageLog", undefined), call("languageMutations.resetLanguageMutations"),
        call("useVoice.backendStopped"), call("useSpeechServers.backendStopped"), call("useModelDownloads.backendStopped"),
        call("useVcRuntimes.backendStopped"), call("useRealtimeASR.backendStopped"), call("useVirtualMic.backendStopped"),
        call("useVoiceAudition.backendStopped"), call("useStopVoice.reset"), call("useGpuCheck.backendStopped"),
        call("useTalkAiSession.backendStopped")]);
});

// The polls the routes keep while a feature is busy: what each asks for, how often, and the states
// that count as busy. None asks while the backend is stopped, and each stops when its feature is
// idle again or the routes are gone.
const POLLS: { poll: string; call: Call; every: number; busy: HookValues[]; idle: HookValues[] }[] = [
    { poll: "the voice status", call: call("useVoice.send", "/get/data/voice_status"), every: 1000,
        busy: [{ useVoice: { settings: {}, status: {} } }], idle: [{ useVoice: { settings: null, status: {} } }] },
    { poll: "the speech servers", call: call("useSpeechServers.send", "/get/data/speech_server_state"), every: 500,
        busy: [
            ...["preparing", "ready", "stopping"].map(state => ({ useSpeechServers: { state: { tts: { state: "stopped" }, asr: { state } }, pending: {} } })),
            { useSpeechServers: { state: {}, pending: { asr: "start" } } },
            { useVoice: { settings: null, status: { tts_server_starting: true } } },
        ],
        idle: [
            { useSpeechServers: { state: { asr: { state: "stopped" } }, pending: {} } },
            { useVoice: { settings: null, status: { tts_server_starting: "true" } } },
        ] },
    { poll: "the model download hardware", call: call("useModelDownloads.send", "/get/data/model_download_hardware"), every: 500,
        busy: [{ useModelDownloads: { state: { jobs: {} }, hardware: { phase: "probing" }, pending: null } }],
        idle: [{ useModelDownloads: { state: { jobs: {} }, hardware: { phase: "ready" }, pending: null } }] },
    { poll: "the model downloads", call: call("useModelDownloads.send", "/get/data/model_download_state"), every: 750,
        busy: [
            ...["queued", "downloading", "verifying", "cancelling"].map(phase => ({ useModelDownloads: { state: { jobs: { a: { phase: "done" }, b: { phase } } }, hardware: {}, pending: null } })),
            { useModelDownloads: { state: { jobs: {} }, hardware: {}, pending: "/run/start_model_download" } },
        ],
        idle: [{ useModelDownloads: { state: { jobs: { a: { phase: "done" }, b: { phase: "failed" } } }, hardware: {}, pending: "" } }] },
    { poll: "the runtime setups", call: call("useVcRuntimes.send", "/get/data/vc_runtime_state"), every: 750,
        busy: [
            ...ACTIVE_SETUP_PHASES.map(phase => ({ useVcRuntimes: { state: { jobs: { a: { phase: "done" }, b: { phase } } }, pending: false } })),
            { useVcRuntimes: { state: { jobs: {} }, pending: true } },
        ],
        idle: [{ useVcRuntimes: { state: { jobs: { a: { phase: "done" } } }, pending: false } }] },
    { poll: "the playing audition", call: call("useVoiceAudition.poll"), every: 300,
        busy: [{ useVoiceAudition: { audition: { phase: "playing" } } }],
        idle: [{ useVoiceAudition: { audition: { phase: "ended" } } }] },
    { poll: "the running GPU check", call: call("useGpuCheck.poll"), every: 1000,
        busy: [{ useGpuCheck: { check: { phase: "running" } } }],
        idle: [{ useGpuCheck: { check: { phase: "idle" } } }] },
    { poll: "realtime recognition", call: call("useRealtimeASR.send", "/get/data/realtime_asr_state"), every: 500,
        // A stopping source is polled until it has stopped (#1302).
        busy: [{ useRealtimeASR: { state: { speaker: { requested: false }, mic: { requested: true } } } },
            { useRealtimeASR: { state: { speaker: { requested: false, state: "stopping" } } } }],
        idle: [{ useRealtimeASR: { state: { speaker: { requested: false } } } },
            { useRealtimeASR: { state: { speaker: { requested: false, state: "closed" }, mic: { requested: false, state: "failed" } } } }] },
];
const fakeTimers = () => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });

for (const { poll, call: asked, every, busy, idle } of POLLS) {
    // The number of times the poll asked.
    const count = (r: RecordedRoutes) => r.calls.filter(({ name, args }) => name === asked.name && isDeepStrictEqual(args, asked.args)).length;

    test(`${poll} is asked every ${every} ms while busy, not while the backend is stopped, and not once the routes are gone`, async () => {
        for (const values of busy) {
            fakeTimers();
            const r = await loadRecordedRoutes({ values });
            // The voice status is asked at once as well.
            const first = count(r);
            vi.advanceTimersByTime(every - 1);
            assert.equal(count(r), first, JSON.stringify(values));
            vi.advanceTimersByTime(1);
            assert.equal(count(r), first + 1, JSON.stringify(values));
            r.store.backend_stopped = true;
            vi.advanceTimersByTime(every);
            assert.equal(count(r), first + 1, JSON.stringify(values));
            r.store.backend_stopped = false;
            r.runtime.unmount();
            vi.advanceTimersByTime(every * 3);
            assert.equal(count(r), first + 1, JSON.stringify(values));
            vi.useRealTimers();
        }
    });

    test(`${poll} is not asked while idle, and stops when its feature is idle again`, async () => {
        for (const values of idle) {
            fakeTimers();
            const r = await loadRecordedRoutes({ values });
            vi.advanceTimersByTime(20000);
            assert.equal(count(r), 0, JSON.stringify(values));
            vi.useRealTimers();
        }
        fakeTimers();
        const r = await loadRecordedRoutes({ values: busy[0] });
        vi.advanceTimersByTime(every);
        const asked = count(r);
        Object.assign(r.values, idle[0]);
        r.render();
        vi.advanceTimersByTime(every * 3);
        assert.equal(count(r), asked);
    });
}

test("the voice status is asked once the voice settings came, before the first second", async () => {
    fakeTimers();
    const r = await loadRecordedRoutes({ values: { useVoice: { settings: {}, status: {} } } });
    assert.deepEqual(r.argsOf("useVoice.send"), [["/get/data/voice_status"], ["/get/data/voice_route"], ["/get/data/direct_voice_state"]]);
    r.store.backend_stopped = true;
    r.runtime.remount();
    r.render();
    assert.equal(r.argsOf("useVoice.send").length, 3);
});

test("a model download request unanswered for ten seconds is given up", async () => {
    fakeTimers();
    const r = await loadRecordedRoutes({ values: { useModelDownloads: { state: { jobs: {} }, hardware: {}, pending: "/run/start_model_download" } } });
    vi.advanceTimersByTime(9999);
    assert.deepEqual(r.argsOf("useModelDownloads.expireUnconfirmed"), []);
    vi.advanceTimersByTime(1);
    assert.deepEqual(r.argsOf("useModelDownloads.expireUnconfirmed"), [[]]);
    // An answer that came in time takes the wait away.
    const answered = await loadRecordedRoutes({ values: { useModelDownloads: { state: { jobs: {} }, hardware: {}, pending: "/run/start_model_download" } } });
    vi.advanceTimersByTime(5000);
    Object.assign(answered.values, { useModelDownloads: { state: { jobs: {} }, hardware: {}, pending: null } });
    answered.render();
    vi.advanceTimersByTime(10000);
    assert.deepEqual(answered.argsOf("useModelDownloads.expireUnconfirmed"), []);
});

test("only the voice status's own answer moves the count of skipped speech, and only to a whole number", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/get/data/voice_status", 200, { expired: 2 });
    r.receive("/get/data/voice_route", 200, { expired: 5 });
    r.receive("/get/data/voice_status", 500, { expired: 9 });
    r.receive("/get/data/voice_status", 200, { expired: "3" });
    r.receive("/get/data/voice_status", 200, { expired: 2.5 });
    assert.equal(r.store.expired_speech, 2);
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Warning"), []);
});

test("a refused shutdown or update no longer expects the backend to end, and a failed update is not updating", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadRecordedRoutes();
    const session: ExitExpectingSession = { expectedExits: new Map() };
    r.store.backend_session = session;
    expectBackendExit(session, "/run/shutdown");
    expectBackendExit(session, "/run/update_software");
    r.receive("/run/shutdown", 200, null);
    r.receive("/run/update_software", 200, null);
    r.receive("/set/enable/translation", 500, "Internal error");
    assert.deepEqual([...session.expectedExits.keys()], ["/run/shutdown", "/run/update_software"]);
    r.receive("/run/shutdown", 500, "Internal error");
    assert.deepEqual([...session.expectedExits.keys()], ["/run/update_software"]);
    assert.deepEqual(r.argsOf("useIsSoftwareUpdating.updateIsSoftwareUpdating"), []);
    r.receive("/run/update_software", 400, { error_code: "UPDATE_SOFTWARE_DOWNLOAD" });
    assert.deepEqual([...session.expectedExits.keys()], []);
    assert.deepEqual(r.argsOf("useIsSoftwareUpdating.updateIsSoftwareUpdating"), [[false]]);
});

test("an answer goes to the settings button that waits for it", async () => {
    const r = await loadRecordedRoutes();
    const request = r.writes.begin("/run/export_vocabulary");
    assert.ok(request);
    r.receive("/run/export_vocabulary", 200, { file: "vocabulary.txt" });
    assert.deepEqual(await request.response, { endpoint: "/run/export_vocabulary", status: 200, result: { file: "vocabulary.txt" } });
});

test("a device switch or a device fallback that failed goes to the error handling, not to a warning", async () => {
    const r = await loadRecordedRoutes();
    r.receive("/run/audio_device_switched", 400, { source: "mic", old_device: { name: "A" }, new_device: { name: "B" } });
    r.receive("/run/translation_compute_device_fallback", 400, { requested: "cuda:0" });
    assert.deepEqual(r.argsOf("useNotificationStatus.showNotification_Warning"), []);
    assert.deepEqual(r.argsOf("_useBackendErrorHandling.errorHandling_Backend").map(([error]) => fieldOf(error, "endpoint")),
        ["/run/audio_device_switched", "/run/translation_compute_device_fallback"]);
});

test("a route whose hook lacks the function it names stops with a TypeError that names it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = { url: "http://127.0.0.1:1234/v1", auth_key: "sk-test" };
    const noUrl = await loadRecordedRoutes({ hooks: async () => ({ useTranslation: () => ({}) }) });
    assert.throws(() => noUrl.receive("/set/data/openai_compatible_auth_key_and_url", 200, answer),
        { name: "TypeError", message: "useTranslation.updateOpenAICompatibleURL is not a function" });
    const noKey = await loadRecordedRoutes({ hooks: async () => ({ useTranslation: () => ({ updateOpenAICompatibleURL: () => {} }) }) });
    assert.throws(() => noKey.receive("/set/data/openai_compatible_auth_key_and_url", 200, answer),
        { name: "TypeError", message: "useTranslation.setSuccessOpenAICompatibleAuthKey is not a function" });
    const noLog = await loadRecordedRoutes({ hooks: async () => ({ useMessage: () => ({}) }) });
    assert.throws(() => noLog.backendStopped(), { name: "TypeError", message: "useMessage.failSentMessageLog is not a function" });
});
