import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { loadBridgeRoutes } from "../test/bridgeHarness.js";
import { legacyDownloadFailure } from "../configs/legacyModelConsent.js";

// Issue #305: a failed CTranslate2 download said only that it failed. It now says why and
// offers a retry that reopens the review (consent first), not a silent re-download.
const fail = (s, data) => s.receiveRoutes({ endpoint: "/run/error_ctranslate2_weight", status: 400,
    result: { error_code: "WEIGHT_CTRANSLATE2_DOWNLOAD", data: { weight_type: "small", job_id: "job", downloaded: false, ...data } } });

test("a failed download names its reason and keeps a retry until it is used", async () => {
    const s = await loadBridgeRoutes();
    fail(s, { reason: "insufficient_space" });
    assert.equal(s.notices.length, 1);
    const [notice] = s.notices;
    assert.equal(notice.type, "error");
    assert.equal(notice.options.category_id, "WEIGHT_CTRANSLATE2_DOWNLOAD:small");
    assert.equal(notice.options.hide_duration, null, "the retry does not vanish with the notice");
    assert.equal(notice.key.props.titleKey, "common_error.failed_download_weight_ctranslate2");
    assert.equal(notice.key.props.reasonKey, "model_downloads.errors.insufficient_space");
    assert.equal(s.translationSetup().request, null);
    notice.key.props.onRetry();
    assert.deepEqual(s.translationSetup().request, { resume: false, weightType: "small" }, "retry reopens the review for that model");
    assert.ok(!s.reads.some(path => String(path).startsWith("/run/download")), "retry itself downloads nothing");
});

test("a download refused because another is running offers no retry", async () => {
    const s = await loadBridgeRoutes();
    fail(s, { reason: "download_busy", active_job_id: "other" });
    assert.equal(s.notices[0].key.props.onRetry, null);
    assert.equal(s.notices[0].options.hide_duration, undefined);
});

test("a stopped download is not reported as a failure, but the row still settles", async () => {
    const s = await loadBridgeRoutes();
    const rows = s.stores.dynamicStoreRegistry.Atom_CTranslate2WeightTypeStatus;
    s.runtime.store.set(rows, { state: "ok", data: [{ id: "small", is_pending: true, is_downloaded: false, progress: 40, job_id: "job" }] });
    fail(s, { reason: "cancelled" });
    assert.deepEqual(s.notices, []);
    assert.deepEqual(s.runtime.store.get(rows).data[0], { id: "small", is_pending: false, is_downloaded: false, progress: null, job_id: "job" });
    assert.deepEqual(legacyDownloadFailure({ weight_type: "small", reason: "cancelled" }), { notify: false, reasonKey: null, retryable: false });
});

test("reasons map to fixed text; unknown ones fall back to the generic failure", () => {
    assert.deepEqual(legacyDownloadFailure({ weight_type: "small", reason: "hash_mismatch" }),
        { notify: true, reasonKey: "model_downloads.errors.hash_mismatch", retryable: true });
    assert.deepEqual(legacyDownloadFailure({ weight_type: "small", reason: "verification_failed" }),
        { notify: true, reasonKey: "legacy_model_downloads.errors.verification_failed", retryable: true });
    assert.deepEqual(legacyDownloadFailure({ weight_type: "small", reason: "C:\\Users\\name\\x: boom" }),
        { notify: true, reasonKey: "model_downloads.errors.download_failed", retryable: true }, "free text is never shown");
    assert.equal(legacyDownloadFailure({ reason: "download_failed" }).retryable, false, "no model, nothing to retry");
    assert.equal(legacyDownloadFailure({ weight_type: "small", reason: "downloads_closed" }).retryable, false);
});

for (const language of ["en", "ja"]) test(`${language}: every reason and the retry have text`, async () => {
    const messages = yaml.load(await readFile(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8"));
    for (const reason of ["download_busy", "download_failed", "downloads_closed", "hash_mismatch", "insufficient_space",
        "size_mismatch", "unsafe_destination", "download_deadline", "verification_failed"]) {
        const [namespace, , key] = legacyDownloadFailure({ reason }).reasonKey.split(".");
        assert.ok(messages[namespace].errors[key], reason);
    }
    assert.ok(messages.common_error.retry_download);
});
