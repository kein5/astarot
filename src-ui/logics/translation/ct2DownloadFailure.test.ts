import assert from "node:assert/strict";
import { test } from "vitest";
import { loadBridgeRoutes, settingAtom } from "../test/bridgeHarness.ts";
import type { Notice } from "../test/bridgeHarness.ts";
import { treeNode } from "../test/hookHarness.ts";
import { localeAt, readLocale } from "../test/locales.ts";
import { legacyDownloadFailure } from "../configs/legacyModelConsent.ts";

type Routes = Awaited<ReturnType<typeof loadBridgeRoutes>>;
interface WeightRow {
    id: string;
    is_pending: boolean;
    is_downloaded: boolean;
    progress: number | null;
    job_id: string;
}

// A notice's text, the element the routes made (TranslatedNotice); a text of another kind fails
// here, as reading its props would.
const textOf = (notice: Notice) => {
    const node = treeNode(notice.key);
    assert.ok(node, "the notice's text is an element");
    return node;
};

// Issue #305: a failed CTranslate2 download said only that it failed. It now says why and
// offers a retry that reopens the review (consent first), not a silent re-download.
const fail = (s: Routes, data: Record<string, unknown>) => s.receiveRoutes({ endpoint: "/run/error_ctranslate2_weight", status: 400,
    result: { error_code: "WEIGHT_CTRANSLATE2_DOWNLOAD", data: { weight_type: "small", job_id: "job", downloaded: false, ...data } } });

test("a failed download names its reason and keeps a retry until it is used", async () => {
    const s = await loadBridgeRoutes();
    fail(s, { reason: "insufficient_space" });
    assert.equal(s.notices.length, 1);
    const [notice] = s.notices;
    assert.equal(notice.type, "error");
    assert.ok(notice.options);
    assert.equal(notice.options.category_id, "WEIGHT_CTRANSLATE2_DOWNLOAD:small");
    assert.equal(notice.options.hide_duration, null, "the retry does not vanish with the notice");
    assert.equal(textOf(notice).props.titleKey, "common_error.failed_download_weight_ctranslate2");
    assert.equal(textOf(notice).props.reasonKey, "model_downloads.errors.insufficient_space");
    assert.equal(s.translationSetup().request, null);
    textOf(notice).props.onRetry();
    assert.deepEqual(s.translationSetup().request, { resume: false, weightType: "small" }, "retry reopens the review for that model");
    assert.ok(!s.reads.some(path => String(path).startsWith("/run/download")), "retry itself downloads nothing");
});

test("a download refused because another is running offers no retry", async () => {
    const s = await loadBridgeRoutes();
    fail(s, { reason: "download_busy", active_job_id: "other" });
    const [notice] = s.notices;
    assert.equal(textOf(notice).props.onRetry, null);
    assert.ok(notice.options);
    assert.equal(notice.options.hide_duration, undefined);
});

test("a stopped download is not reported as a failure, but the row still settles", async () => {
    const s = await loadBridgeRoutes();
    // The weight list's setting atom, which the settings list made under this name.
    const rows = settingAtom<WeightRow[]>(s.stores.dynamicStoreRegistry, "Atom_CTranslate2WeightTypeStatus");
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
    const messages = readLocale(language);
    for (const reason of ["download_busy", "download_failed", "downloads_closed", "hash_mismatch", "insufficient_space",
        "size_mismatch", "unsafe_destination", "download_deadline", "verification_failed"]) {
        const { reasonKey } = legacyDownloadFailure({ reason });
        assert.ok(reasonKey !== null, reason);
        const [namespace, , key] = reasonKey.split(".");
        assert.ok(localeAt(messages, `${namespace}.errors.${key}`), reason);
    }
    assert.ok(localeAt(messages, "common_error.retry_download"));
});
