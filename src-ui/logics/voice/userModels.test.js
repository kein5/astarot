import { test } from "vitest";
import assert from "node:assert/strict";
import { USER_MODEL_FILES, cleanPath, registrationRequest, userModelStatus } from "./modelCatalog.ts";
import { isRelayAllowed } from "../common/vrPanelWire.ts";
import { featureResyncReads } from "../common/pendingRequestRecovery.ts";

const model = (status = "ok", paths = { model: "C:\\Models\\mine.gguf" }) =>
    ({ id: "user-1", target: "japanese", name: "Mine", paths, total_bytes: 4, registered_at: null, status });

test("a registered model is in use only while the saved path is its file", () => {
    assert.equal(userModelStatus(model(), { model: "C:\\Models\\mine.gguf" }), "in_use");
    assert.equal(userModelStatus(model(), { model: "C:\\Models\\other.gguf" }), "registered");
    assert.equal(userModelStatus(model(), undefined), "registered");
    // A file that is gone or changed is said first, even when the settings still name it.
    assert.equal(userModelStatus(model("missing"), { model: "C:\\Models\\mine.gguf" }), "missing");
    assert.equal(userModelStatus(model("changed"), { model: "C:\\Models\\mine.gguf" }), "changed");
});

test("a path copied with Windows' Copy as path loses its quotes", () => {
    assert.equal(cleanPath('  "C:\\My Models\\a.gguf"  '), "C:\\My Models\\a.gguf");
    assert.equal(cleanPath("/home/me/a.gguf"), "/home/me/a.gguf");
    assert.equal(cleanPath('"'), '"');
});

test("the registration request names the target, a trimmed name and the given files only", () => {
    assert.deepEqual(registrationRequest("japanese", "  Mine ", { model: '"C:\\m\\a.GGUF"' }),
        { request: { target: "japanese", name: "Mine", paths: { model: "C:\\m\\a.GGUF" } } });
    assert.deepEqual(registrationRequest("rvc", "Voice", { model: "/v/a.pth", index: " " }),
        { request: { target: "rvc", name: "Voice", paths: { model: "/v/a.pth" } } });
    assert.deepEqual(registrationRequest("rvc", "Voice", { model: "/v/a.pth", index: "/v/a.index" }).request.paths,
        { model: "/v/a.pth", index: "/v/a.index" });
});

test("a registration that cannot pass is not sent", () => {
    assert.deepEqual(registrationRequest("ocr", "x", { model: "/a.onnx" }), { problem: "target" });
    assert.deepEqual(registrationRequest("japanese", " ", { model: "/a.gguf" }), { problem: "name_missing" });
    assert.deepEqual(registrationRequest("japanese", "x".repeat(81), { model: "/a.gguf" }), { problem: "name_long" });
    assert.deepEqual(registrationRequest("japanese", "x", {}), { problem: "model_missing" });
    assert.deepEqual(registrationRequest("japanese", "x", { model: "/a.pth" }), { problem: "model_kind" });
    assert.deepEqual(registrationRequest("rvc", "x", { model: "/a.pth", index: "/a.gguf" }), { problem: "index_kind" });
});

test("translation and chat reading take no models of one's own yet", () => {
    assert.deepEqual(Object.keys(USER_MODEL_FILES).sort(), ["asr", "diarization", "japanese", "multilingual", "rvc", "vad"]);
});

test("the user model routes stay out of the overlay relay and resync after a failure", () => {
    for (const path of ["/get/data/user_models", "/run/register_user_model", "/run/remove_user_model", "/run/apply_user_model"])
        assert.equal(isRelayAllowed(path), false, path);
    for (const path of ["/run/register_user_model", "/run/remove_user_model", "/run/apply_user_model"])
        assert.equal(featureResyncReads[path], "/get/data/user_models");
});
