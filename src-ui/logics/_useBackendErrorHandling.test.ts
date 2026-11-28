import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBridgeRoutes, noticeText, settingAtom } from "./test/bridgeHarness.ts";
import { branchAt, localeAt, readLocale } from "./test/locales.ts";
import type { AtomState } from "./store.ts";

test("credential reentry notices and field hints exist in every supported locale", () => {
    for (const language of ["en", "ja"]) {
        const locale = readLocale(language);
        assert.ok(localeAt(locale, "backend_errors.CREDENTIAL_REENTRY_REQUIRED"));
        assert.ok(localeAt(locale, "config_page.common.credential_reentry_required"));
    }
});

// A branch that shows `localized` falls back to the backend's English message when the code has
// no text, so a Japanese UI would show English (the GPU memory notices once did).
test("every code shown with its backend_errors text has one in every supported locale", () => {
    const source = readFileSync(new URL("./_useBackendErrorHandling.ts", import.meta.url), "utf8");
    const codes = new Set<string>();
    for (const [, labels, body] of source.matchAll(/((?:case "[A-Z0-9_]+":\s*)+)([\s\S]*?)(?=case "|default:)/g)) {
        if (/\blocalized\b/.test(body)) for (const [, code] of labels.matchAll(/case "([A-Z0-9_]+)"/g)) codes.add(code);
    }
    for (const code of ["TRANSLATION_VRAM_CHAT", "TRANSLATION_VRAM_MIC", "TRANSLATION_VRAM_SPEAKER"]) assert.ok(codes.has(code), code);
    for (const language of ["en", "ja"]) {
        const errors = branchAt(readLocale(language), "backend_errors");
        const missing = [...codes].filter(code => typeof errors[code] !== "string");
        assert.deepEqual(missing, [], `${language}: backend_errors has no text for these codes`);
    }
});

for (const [base, provider] of [["OpenAICompatible", "openai_compatible"], ["CustomWhisper", "custom_whisper"]] as const) {
    test(`${provider}: credential reentry settles only the URL and explains the rejection`, async () => {
        const s = await loadBridgeRoutes();
        const url = settingAtom(s.stores.dynamicStoreRegistry, `Atom_${base}URL`);
        const key = settingAtom(s.stores.dynamicStoreRegistry, `Atom_${base}AuthKey`);
        const savedURL = "https://previous.invalid/v1";
        const savedKey: AtomState<unknown> = { state: "pending", data: "synthetic-saved-key" };
        s.runtime.store.set(url, { state: "pending", data: savedURL });
        s.runtime.store.set(key, savedKey);
        s.receiveRoutes({ status: 400, endpoint: `/set/data/${provider}_url`, result: {
            error_code: "CREDENTIAL_REENTRY_REQUIRED", data: savedURL,
        } });
        assert.deepEqual(s.runtime.store.get(url), { state: "ok", data: savedURL });
        assert.strictEqual(s.runtime.store.get(key), savedKey);
        assert.equal(s.notices.length, 1);
        assert.equal(s.notices[0]?.options?.category_id, "CREDENTIAL_REENTRY_REQUIRED");
        assert.deepEqual(s.reads, []);
    });
}

test("compatible URL rejection restores the URL and settles only its pending request", async () => {
    const s = await loadBridgeRoutes();
    const url = settingAtom(s.stores.dynamicStoreRegistry, "Atom_OpenAICompatibleURL");
    const key = settingAtom(s.stores.dynamicStoreRegistry, "Atom_OpenAICompatibleAuthKey");
    const previousURL = "https://previous.invalid/v1";
    const previousKey: AtomState<unknown> = { state: "pending", data: "synthetic-saved-key" };
    s.runtime.store.set(url, { state: "pending", data: previousURL });
    s.runtime.store.set(key, previousKey);

    s.receiveRoutes({ status: 400, endpoint: "/set/data/openai_compatible_url", result: {
        error_code: "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID",
        message: "The candidate has no supported models", data: previousURL,
    } });

    assert.deepEqual(s.runtime.store.get(url), { state: "ok", data: previousURL });
    assert.strictEqual(s.runtime.store.get(key), previousKey);
    assert.equal(s.notices.length, 1);
    assert.equal(s.notices[0]?.options?.category_id, "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID");
    assert.deepEqual(s.reads, []);
});

test("compatible key rejection still settles the key without altering the URL", async () => {
    const s = await loadBridgeRoutes();
    const url = settingAtom(s.stores.dynamicStoreRegistry, "Atom_OpenAICompatibleURL");
    const key = settingAtom(s.stores.dynamicStoreRegistry, "Atom_OpenAICompatibleAuthKey");
    const previousURL: AtomState<unknown> = { state: "pending", data: "https://previous.invalid/v1" };
    s.runtime.store.set(url, previousURL);
    s.runtime.store.set(key, { state: "pending", data: "synthetic-saved-key" });

    s.receiveRoutes({ status: 400, endpoint: "/set/data/openai_compatible_auth_key", result: {
        error_code: "AUTH_OPENAI_COMPATIBLE_FAILED", data: "synthetic-saved-key",
    } });

    assert.deepEqual(s.runtime.store.get(key), { state: "ok", data: "synthetic-saved-key" });
    assert.strictEqual(s.runtime.store.get(url), previousURL);
});

for (const [field, code] of [
    ["lmstudio_url", "CONNECTION_LMSTUDIO_URL_INVALID"],
    ["openai_compatible_url", "CONNECTION_OPENAI_COMPATIBLE_URL_INVALID"],
    ["transcription_custom_url", "CONNECTION_TRANSCRIPTION_CUSTOM_URL_INVALID"],
    ["openai_compatible_url", "CREDENTIAL_REENTRY_REQUIRED"],
    ["custom_whisper_url", "CREDENTIAL_REENTRY_REQUIRED"],
]) test(`${field}: ${code} renders in the saved UI language`, async () => {
    const resources = Object.fromEntries(["en", "ja"].map(language => [language, {
        translation: readLocale(language),
    }]));
    const i18n = i18next.createInstance();
    await i18n.init({ lng: "en", resources });
    const s = await loadBridgeRoutes(undefined, i18n);
    s.receiveRoutes({ status: 400, endpoint: `/set/data/${field}`, result: {
        error_code: code, message: "The saved URL was invalid", data: "",
    } });
    const notice = s.notices.at(-1);
    assert.ok(notice);
    assert.equal(notice.type, "error");
    assert.equal(notice.options?.category_id, code);
    assert.equal(renderToStaticMarkup(notice.key), branchAt(resources.en.translation, "backend_errors")[code]);

    // Settings finish applying after the IPC notice was already queued.
    await i18n.changeLanguage("ja");
    assert.equal(s.notices.length, 1);
    assert.equal(renderToStaticMarkup(notice.key), branchAt(resources.ja.translation, "backend_errors")[code]);
});

// #1111: the refusal of a field's own save is said under the field, so no notice is shown as well;
// the kept value is still put back. The same refusal at start-up, which no field waits for, is a notice.
test("a field that waits for its own save says the refusal itself; otherwise the notice stays", async () => {
    const fieldErrors = await import("./configs/fieldErrors.ts");
    const s = await loadBridgeRoutes();
    const refused = () => s.receiveRoutes({ status: 400, endpoint: "/set/data/lmstudio_url", result: {
        error_code: "CONNECTION_LMSTUDIO_URL_INVALID", message: "The URL is invalid", data: "http://127.0.0.1:1234/v1",
    } });
    fieldErrors.awaitInlineAnswer("/set/data/lmstudio_url");
    const before = s.notices.length;
    refused();
    assert.equal(s.notices.length, before, "no notice for the field's own save");
    refused();
    assert.equal(s.notices.length, before + 1, "a refusal no field waits for keeps its notice");
});

// #1324: every answer that is not a success ends the wait of a field that says its own refusal,
// whatever its status and whether or not the error handling reads it, so a later refusal on the
// same endpoint that no field waits for still raises its notice. A success is the field's to end.
test("an answer of any status but success ends a field's wait, so a later refusal keeps its notice", async () => {
    const fieldErrors = await import("./configs/fieldErrors.ts");
    const s = await loadBridgeRoutes();
    const endpoint = "/set/data/lmstudio_url";
    const refused = () => s.receiveRoutes({ status: 400, endpoint, result: {
        error_code: "CONNECTION_LMSTUDIO_URL_INVALID", message: "The URL is invalid", data: "http://127.0.0.1:1234/v1",
    } });
    for (const status of [403, 404, 423, 500]) {
        fieldErrors.awaitInlineAnswer(endpoint);
        s.receiveRoutes({ status, endpoint, result: { message: "not done" } });
        const before = s.notices.length;
        refused();
        assert.equal(s.notices.length, before + 1, `a refusal after a ${status} keeps its notice`);
    }
    // A refused log folder is put back before the error handling, which never reads it.
    fieldErrors.awaitInlineAnswer("/set/data/path_logs");
    s.receiveRoutes({ status: 400, endpoint: "/set/data/path_logs", result: { path: "C:/logs", error_code: "PATH_LOGS_NOT_WRITABLE" } });
    assert.equal(fieldErrors.takeInlineRefusal("/set/data/path_logs"), false, "the early answer ended the wait too");
    const settle = fieldErrors.awaitInlineAnswer(endpoint);
    s.receiveRoutes({ status: 200, endpoint, result: "http://127.0.0.1:1234/v1" });
    assert.equal(fieldErrors.takeInlineRefusal(endpoint), true, "a success leaves the wait to the field");
    settle();
});

test("other backend notifications still resolve their message when received", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: "en", resources: {
        en: { translation: { backend_errors: { CONNECTION_LMSTUDIO_FAILED: "Connection failed" } } },
        ja: { translation: { backend_errors: { CONNECTION_LMSTUDIO_FAILED: "接続できませんでした" } } },
    } });
    const s = await loadBridgeRoutes(undefined, i18n);
    s.receiveRoutes({ status: 400, endpoint: "/run/check_lmstudio_connection", result: {
        error_code: "CONNECTION_LMSTUDIO_FAILED", message: "Connection failed",
    } });
    await i18n.changeLanguage("ja");
    assert.equal(s.notices.at(-1)?.key, "Connection failed");
});

test("output failures have separate warnings per sink and never expose raw errors", async () => {
    const s = await loadBridgeRoutes();
    for (const output of ["osc", "logger", "tts", "raw private exception"]) {
        s.receiveRoutes({ status: 400, endpoint: "/run/message_output_error", result: {
            error_code: "MESSAGE_OUTPUT_FAILED", message: "raw private exception", data: { output },
        } });
    }
    assert.deepEqual(s.notices.map(notice => notice.options?.category_id), [
        "MESSAGE_OUTPUT_FAILED.osc", "MESSAGE_OUTPUT_FAILED.logger", "MESSAGE_OUTPUT_FAILED.tts", "MESSAGE_OUTPUT_FAILED.unknown",
    ]);
    assert.ok(s.notices.every(notice => notice.type === "warning" && notice.key === "backend_errors.MESSAGE_OUTPUT_FAILED"));
    assert.deepEqual(s.reads, []);
});

for (const language of ["en", "ja"]) test(`${language}: partial output warning names the output and explains duplicate risk`, async () => {
    const translation = readLocale(language);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const s = await loadBridgeRoutes(undefined, i18n);
    for (const output of ["osc", "overlay_small", "overlay_large", "clipboard", "ui", "websocket", "logger", "history", "tts", "unknown"]) {
        assert.ok(i18n.exists(`message_outputs.${output}`));
        s.receiveRoutes({ status: 400, endpoint: "/run/message_output_error", result: {
            error_code: "MESSAGE_OUTPUT_FAILED", data: { output }, message: "raw error",
        } });
        const notice = s.notices.at(-1);
        assert.ok(notice);
        assert.ok(noticeText(notice).includes(i18n.t(`message_outputs.${output}`)));
        assert.match(noticeText(notice), language === "ja" ? /再送するとほかの出力先に同じメッセージが重ねて届く/ : /If you resend it, those outputs may receive it twice/);
        assert.equal(notice.type, "warning");
    }
});

for (const language of ["en", "ja"]) test(`${language}: overlay failure notifies and re-reads all output switches`, async () => {
    const translation = readLocale(language);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const s = await loadBridgeRoutes(undefined, i18n);
    s.receiveRoutes({ status: 400, endpoint: "/run/message_output_error", result: {
        error_code: "OVERLAY_RUNTIME_FAILED", data: { reason: "runtime" }, message: "private native exception",
    } });
    assert.deepEqual(s.notices, [{ type: "error", key: branchAt(translation, "backend_errors").OVERLAY_RUNTIME_FAILED,
        options: { category_id: "OVERLAY_RUNTIME_FAILED" } }]);
    assert.deepEqual(s.reads, ["/get/data/overlay_small_log", "/get/data/overlay_large_log", "/get/data/overlay_vr_panel"]);
});

for (const language of ["en", "ja"]) test(`${language}: a VR UI that this system cannot show says so and re-reads only its own switch`, async () => {
    const translation = readLocale(language);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const s = await loadBridgeRoutes(undefined, i18n);
    s.receiveRoutes({ status: 400, endpoint: "/set/enable/overlay_vr_panel", result: {
        error_code: "OVERLAY_VR_PANEL_UNSUPPORTED", data: false, message: "The VR UI is not available in this environment.",
    } });
    assert.deepEqual(s.notices, [{ type: "error", key: branchAt(translation, "backend_errors").OVERLAY_VR_PANEL_UNSUPPORTED,
        options: { category_id: "OVERLAY_VR_PANEL_UNSUPPORTED" } }]);
    assert.deepEqual(s.reads, ["/get/data/overlay_vr_panel"]);
});

// #1384: SteamVR keeps the auto-launch flag. A change it did not take reads SteamVR again, so the
// switch shows what SteamVR holds and why it cannot be pressed.
for (const language of ["en", "ja"]) test(`${language}: a SteamVR auto-launch change that did not reach SteamVR reads SteamVR again`, async () => {
    const translation = readLocale(language);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const s = await loadBridgeRoutes(undefined, i18n);
    const errors = branchAt(translation, "backend_errors");
    s.receiveRoutes({ status: 400, endpoint: "/set/enable/steamvr_auto_launch", result: {
        error_code: "STEAMVR_AUTO_LAUNCH_UNAVAILABLE", data: { available: false, reason: "steamvr_not_running", enabled: null },
        message: "Starting with SteamVR can be changed only while SteamVR is running, in the installed app.",
    } });
    s.receiveRoutes({ status: 400, endpoint: "/set/disable/steamvr_auto_launch", result: {
        error_code: "STEAMVR_AUTO_LAUNCH_FAILED", data: { available: false, reason: "steamvr_unreachable", enabled: null },
        message: "SteamVR did not accept the change to starting with SteamVR.",
    } });
    assert.deepEqual(s.notices, [
        { type: "warning", key: errors.STEAMVR_AUTO_LAUNCH_UNAVAILABLE, options: { category_id: "STEAMVR_AUTO_LAUNCH_UNAVAILABLE" } },
        { type: "error", key: errors.STEAMVR_AUTO_LAUNCH_FAILED, options: { category_id: "STEAMVR_AUTO_LAUNCH_FAILED" } },
    ]);
    assert.deepEqual(s.reads, ["/get/data/steamvr_auto_launch", "/get/data/steamvr_auto_launch"]);
});

// Decision 13 of #278: the VAD runs on the speech.cpp server, and details.reason names the next step.
for (const language of ["en", "ja"]) test(`${language}: a VAD that cannot use its server says why and re-reads only a refused switch`, async () => {
    const translation = readLocale(language);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const s = await loadBridgeRoutes(undefined, i18n);
    const vad = (endpoint: string, data: unknown, reason: string) => s.receiveRoutes({ status: 400, endpoint, result: {
        error_code: "VAD_UNAVAILABLE", data, details: { reason }, message: "Voice activity detection needs the speech.cpp server",
    } });
    // Turning a switch on is refused while the server is not set up.
    vad("/set/enable/speaker_vad_filter", false, "realtime_vad_model_missing");
    // A recording that cannot use the server cuts by volume; a reason with no text adds nothing.
    vad("/run/vad_unavailable", { source: "mic" }, "speech_server_not_ready");
    vad("/run/vad_unavailable", { source: "mic" }, "realtime_session_failed");
    const errors = branchAt(translation, "backend_errors"), next = branchAt(translation, "realtime_toggle");
    assert.deepEqual(s.notices.map(notice => [notice.type, notice.key]), [
        ["warning", `${errors.VAD_UNAVAILABLE} ${next.realtime_vad_model_missing}`],
        ["warning", `${errors.VAD_UNAVAILABLE_recording} ${next.speech_server_not_ready}`],
        ["warning", errors.VAD_UNAVAILABLE_recording],
    ]);
    assert.deepEqual(s.reads, ["/get/data/speaker_vad_filter"]);
});

for (const language of ["en", "ja"]) test(`${language}: a key store failure stays on screen and changes no setting`, async () => {
    const translation = readLocale(language);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const s = await loadBridgeRoutes(undefined, i18n);
    s.receiveRoutes({ status: 400, endpoint: "/run/secret_store_failed", result: {
        error_code: "SECRET_STORE_FAILED", data: { operation: "write", entries: ["AUTH_KEYS/DeepL_API"], reason: "write_failed", store: "file" },
        message: "The API keys could not be kept in their secure storage.",
    } });
    assert.deepEqual(s.notices, [{ type: "error", key: branchAt(translation, "backend_errors").SECRET_STORE_FAILED,
        options: { hide_duration: null, category_id: "SECRET_STORE_FAILED" } }]);
    assert.deepEqual(s.reads, []);
});

for (const language of ["en", "ja"]) test(`${language}: a key store failure says what the user can do about it`, async () => {
    const translation = readLocale(language);
    const i18n = i18next.createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation } } });
    const s = await loadBridgeRoutes(undefined, i18n);
    const failed = (data: Record<string, unknown>) => s.receiveRoutes({ status: 400, endpoint: "/run/secret_store_failed", result: {
        error_code: "SECRET_STORE_FAILED", data: { entries: ["AUTH_KEYS/DeepL_API"], store: "secret_service", ...data },
        message: "The API keys could not be kept in their secure storage.",
    } });
    // A key that did not move keeps working where it was, whatever the reason.
    failed({ operation: "migrate", reason: "locked" });
    // A store that is locked or not running: the keyring is the user's to open.
    failed({ operation: "read", reason: "locked" });
    failed({ operation: "write", reason: "unavailable" });
    const errors = branchAt(translation, "backend_errors");
    assert.deepEqual(s.notices.map(notice => notice.key),
        [errors.SECRET_STORE_FAILED_moving, errors.SECRET_STORE_FAILED_os_store, errors.SECRET_STORE_FAILED_os_store]);
    assert.ok(s.notices.every(notice => typeof notice.key === "string" && !Object.is(notice.key, errors.SECRET_STORE_FAILED)));
    assert.ok(s.notices.every(notice => !noticeText(notice).includes("AUTH_KEYS")), "no entry names or keys on screen");
});