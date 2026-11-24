import { test } from "vitest";
import assert from "node:assert/strict";
import { captureStatusSummary, detectorStatus, FULL_REGION, isFullRegion, normalizeRegion, readinessSummary, regionPercent, runtimeSummary, withRegionValue } from "./ocrReadiness.ts";
import type { CaptureStatusSummary, OcrReadiness, OcrRegionInput } from "./ocrReadiness.ts";
import { unchecked } from "../test/hookHarness.ts";
import { localeAt, readLocale, textAt } from "../test/locales.ts";

// What a summary says of its source and its text's values; a kind of summary without them reads
// as undefined.
const sourceKeyOf = (summary: CaptureStatusSummary) => "sourceKey" in summary ? summary.sourceKey : undefined;
const paramsOf = (summary: CaptureStatusSummary) => "params" in summary ? summary.params : undefined;

test("region stays inside the window whichever slider moves", () => {
    assert.deepEqual(normalizeRegion(null), FULL_REGION);
    assert.deepEqual(withRegionValue(FULL_REGION, "x", 50), { x: 0.5, y: 0, width: 0.5, height: 1 });
    assert.deepEqual(withRegionValue({ x: 0.5, y: 0, width: 0.5, height: 1 }, "width", 80), { x: 0.5, y: 0, width: 0.5, height: 1 });
    assert.deepEqual(withRegionValue(FULL_REGION, "height", 0), { x: 0, y: 0, width: 1, height: 0.02 });
    assert.deepEqual(withRegionValue(FULL_REGION, "y", 100), { x: 0, y: 0.98, width: 1, height: 0.02 });
    assert.equal(regionPercent({ x: 0.1234, y: 0, width: 0.5, height: 0.5 }, "x"), 12.3);
    assert.ok(isFullRegion(FULL_REGION));
    assert.ok(!isFullRegion({ x: 0, y: 0.1, width: 1, height: 0.9 }));
    assert.throws(() => withRegionValue(FULL_REGION, "z", 1));
});

test("garbage from the backend never produces an invalid region", () => {
    for (const value of [undefined, "x", { x: "a" }, { x: -1, y: 2, width: NaN, height: Infinity }]) {
        // On purpose: values of the wrong shape.
        const region = normalizeRegion(unchecked<OcrRegionInput>(value));
        assert.ok(region.x >= 0 && region.y >= 0);
        assert.ok(region.x + region.width <= 1 + 1e-9 && region.y + region.height <= 1 + 1e-9);
        assert.ok(region.width >= 0.02 && region.height >= 0.02);
    }
});

test("readiness reports the first blocking reason", () => {
    const ready = { engine: true, language_supported: true, missing_models: [], capture: "ok", window_title: "VRChat" };
    assert.equal(readinessSummary(null).key, "config_page.ocr.readiness.checking");
    assert.deepEqual(readinessSummary(ready), { key: "config_page.ocr.readiness.ready", params: {}, ok: true });
    assert.equal(readinessSummary({ ...ready, engine: false }).key, "config_page.ocr.readiness.engine_unavailable");
    assert.equal(readinessSummary({ ...ready, missing_models: ["ppocrv6-small"], capture: "window_not_found" }).key,
        "config_page.ocr.readiness.models_missing");
    assert.deepEqual(readinessSummary({ ...ready, capture: "window_not_found", window_title: "VRChat2" }).params, { title: "VRChat2" });
    assert.equal(readinessSummary({ ...ready, capture: "capture_unavailable" }).key, "config_page.ocr.readiness.capture_unavailable");
});

test("detector installation and preference never claim a worker is using it", () => {
    const base = { engine: true, language_supported: true, missing_models: [], capture: "ok",
        detector_model: "vrct-vox-chatbox-detector", detector_installed: false, detector_enabled: true };
    assert.equal(detectorStatus(null), null);
    assert.equal(detectorStatus({ engine: true }), null);  // an older backend without the detector
    assert.deepEqual(detectorStatus(base, true), { model: "vrct-vox-chatbox-detector", installed: false, on: false, preferred: true,
        key: "config_page.ocr.detector.status_missing" });
    assert.equal(readinessSummary(base).ok, true);  // not downloaded never blocks reading
    const installed = { ...base, detector_installed: true };
    assert.equal(detectorStatus(installed, true)?.key, "config_page.ocr.detector.status_ready");
    assert.equal(detectorStatus(installed, false)?.key, "config_page.ocr.detector.status_off");
    // The page's switch wins over an older readiness reply; without it, readiness decides.
    assert.equal(detectorStatus({ ...installed, detector_enabled: false }, true)?.preferred, true);
    assert.equal(detectorStatus({ ...installed, detector_enabled: false })?.preferred, false);
    assert.equal(detectorStatus(installed)?.on, false);
    const region = { state: "reading", detector: "region" };
    assert.equal(detectorStatus(installed, true, region)?.key, "config_page.ocr.detector.status_restart");
    const adopted = { state: "reading", detector: "vrct-vox-chatbox" };
    assert.equal(detectorStatus(installed, true, adopted)?.key, "config_page.ocr.detector.status_on");
    // A pending OFF request changes preference, but the worker still uses its old detector.
    assert.equal(detectorStatus(installed, false, adopted)?.on, true);
    assert.equal(detectorStatus(installed, false, adopted)?.preferred, false);
    assert.equal(detectorStatus(installed, true, { ...adopted, state: "retrying" })?.key,
        "config_page.ocr.detector.status_paused");
    assert.equal(detectorStatus(installed, true, { state: "stopped", detector: null })?.key,
        "config_page.ocr.detector.status_ready");
});

test("runtime shows waiting, stage failures and recovery without changing the enable switch", () => {
    assert.equal(runtimeSummary(null), null);
    assert.equal(runtimeSummary({ state: "stopped" }), null);
    assert.equal(runtimeSummary({ state: "waiting" })?.key, "config_page.ocr.runtime.waiting");
    for (const stage of ["capture", "detector", "recognition", "tick"]) {
        assert.deepEqual(runtimeSummary({ state: "retrying", stage }), {
            key: `config_page.ocr.runtime.failed_${stage}`, params: {}, ok: false, tone: "failed",
        });
    }
    assert.deepEqual(runtimeSummary({ state: "reading" }), {
        key: "config_page.ocr.runtime.reading", params: {}, ok: true, tone: "active",
    });
});

test("capture status combines the actual source with runtime and uses readiness only when stopped", () => {
    const staleReadiness = { capture: "window_not_found", window_title: "VRChat" };
    const prefix = "config_page.ocr.";
    assert.equal(captureStatusSummary(null, staleReadiness).key, `${prefix}capture_source.checking`);
    for (const source of ["window", "vr", null]) {
        for (const stage of ["capture", "detector", "recognition", "tick"]) {
            const summary = captureStatusSummary({ active: true, source, state: "retrying", stage }, staleReadiness);
            assert.equal(summary.key, `${prefix}runtime.failed_${stage}`);
            assert.equal(sourceKeyOf(summary), source ? `${prefix}capture_source.${source}` : null);
            assert.equal(summary.tone, "failed");
        }
    }
    const stopped = captureStatusSummary({ active: false, state: "stopped" }, staleReadiness);
    assert.equal(sourceKeyOf(stopped), `${prefix}capture_source.stopped`);
    assert.equal(stopped.key, `${prefix}readiness.window_not_found`);
    assert.deepEqual(paramsOf(stopped), { title: "VRChat" });
});

test("a shared window is named as the source, and losing it says what to do", () => {
    const prefix = "config_page.ocr.";
    const reading = captureStatusSummary({ active: true, source: "window", shared_window: "active", state: "reading" }, null);
    assert.equal(sourceKeyOf(reading), `${prefix}capture_source.shared`);
    assert.equal(reading.key, `${prefix}runtime.reading`);
    // Before the first frame there is no source yet, only the wait.
    const waiting = captureStatusSummary({ active: true, source: null, shared_window: "active", state: "waiting", stage: "capture" }, null);
    assert.equal(sourceKeyOf(waiting), null);
    assert.equal(waiting.key, `${prefix}runtime.waiting`);
    const lost = captureStatusSummary(
        { active: true, source: null, shared_window: "ended", state: "retrying", stage: "capture" }, null);
    assert.equal(lost.key, `${prefix}runtime.shared_window_ended`);
    assert.equal(lost.tone, "failed");
    // Another stage failing is that stage's failure, and a window found by name is not "shared".
    assert.equal(runtimeSummary({ state: "retrying", stage: "detector", shared_window: "ended" })?.key, `${prefix}runtime.failed_detector`);
    assert.equal(sourceKeyOf(captureStatusSummary({ active: true, source: "window", shared_window: null, state: "reading" }, null)),
        `${prefix}capture_source.window`);
    assert.equal(sourceKeyOf(captureStatusSummary({ active: true, source: "vr", shared_window: "active", state: "reading" }, null)),
        `${prefix}capture_source.vr`);
});

test("source and stopped messages interpolate the runtime or readiness in both locales", () => {
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const key of ["window", "vr", "stopped"]) {
            assert.ok(textAt(strings, `config_page.ocr.capture_source.${key}`).includes("{{status}}"), `${language}: ${key}`);
        }
    }
});

test("every readiness and OCR start-error string exists in English and Japanese", () => {
    const keys = ["checking", "ready", "engine_unavailable", "language_unsupported", "models_missing",
        "window_not_found", "capture_unavailable"].map(name => `config_page.ocr.readiness.${name}`);
    keys.push(...["engine_unavailable", "model_load_failed", "unsupported_language", "model_missing", "window_not_found",
        "capture_unavailable", "unknown"].map(name => `common_error.ocr_${name}`));
    keys.push("model_downloads.notice_ppocr", "config_page.ocr.region.label", "config_page.ocr.chatbox_filter.label",
        "config_page.ocr.models.title", "model_downloads.notice_chatbox",
        ...["label", "desc", "models_title", "optional", "status_on", "status_off", "status_missing",
            "status_ready", "status_restart", "status_paused"]
            .map(name => `config_page.ocr.detector.${name}`));
    keys.push(...["waiting", "reading", "failed_capture", "failed_detector", "failed_recognition", "failed_tick"]
        .map(name => `config_page.ocr.runtime.${name}`));
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const key of keys) {
            const value = localeAt(strings, key);
            assert.equal(typeof value, "string", `${language}: ${key}`);
            // A text, as the assertion above made sure.
            if (typeof value === "string") assert.ok(value.trim().length > 0, `${language}: ${key}`);
        }
    }
});

test("a region's edge at the far side keeps the smallest area inside the window", () => {
    assert.deepEqual(normalizeRegion({ x: 1, y: 1 }), { x: 0.98, y: 0.98, width: 0.02, height: 0.02 });
    assert.deepEqual(normalizeRegion({ x: 0.99, y: 0.985, width: 0.5, height: 0.5 }), { x: 0.98, y: 0.98, width: 0.02, height: 0.02 });
});

test("moving an edge shrinks the size to what is left, and a size is kept where it fits", () => {
    const half = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    assert.deepEqual(withRegionValue(half, "x", 90), { x: 0.9, y: 0.2, width: 0.1, height: 0.6 });
    assert.deepEqual(withRegionValue(half, "x", 30), { x: 0.3, y: 0.2, width: 0.5, height: 0.6 });
    assert.deepEqual(withRegionValue(half, "x", 100), { x: 0.98, y: 0.2, width: 0.02, height: 0.6 });
    assert.deepEqual(withRegionValue(half, "y", 70), { x: 0.1, y: 0.7, width: 0.5, height: 0.3 });
    assert.deepEqual(withRegionValue(half, "y", 10), { x: 0.1, y: 0.1, width: 0.5, height: 0.6 });
    assert.deepEqual(withRegionValue(half, "y", 100), { x: 0.1, y: 0.98, width: 0.5, height: 0.02 });
    assert.deepEqual(withRegionValue(half, "width", 30), { x: 0.1, y: 0.2, width: 0.3, height: 0.6 });
    assert.deepEqual(withRegionValue(half, "height", 90), { x: 0.1, y: 0.2, width: 0.5, height: 0.8 });
    assert.deepEqual(withRegionValue(half, "x", "a"), { x: 0, y: 0.2, width: 0.5, height: 0.6 });
    assert.throws(() => withRegionValue(half, "", 1), { message: "unknown region key: " });
    assert.throws(() => withRegionValue(half, "left", 1), { message: "unknown region key: left" });
});

test("only the whole window is the full region", () => {
    for (const region of [{ x: 0.1 }, { y: 0.1 }, { width: 0.9 }, { height: 0.9 }]) {
        assert.equal(isFullRegion({ ...FULL_REGION, ...region }), false, JSON.stringify(region));
    }
    assert.equal(isFullRegion({ x: 0, y: 0, width: 1, height: 1 }), true);
    assert.equal(isFullRegion(undefined), true, "a region not yet known reads as the whole window");
});

test("every reason that blocks chat reading is not ready, and a missing window is named", () => {
    const ready = { engine: true, language_supported: true, missing_models: [], capture: "ok", window_title: "VRChat" };
    const blocking: [OcrReadiness, string][] = [
        [{ engine: false }, "engine_unavailable"], [{ language_supported: false }, "language_unsupported"],
        [{ missing_models: ["ppocrv6-small"] }, "models_missing"], [{ capture: "capture_unavailable" }, "capture_unavailable"],
    ];
    for (const [change, key] of blocking) {
        assert.deepEqual(readinessSummary({ ...ready, ...change }), { key: `config_page.ocr.readiness.${key}`, params: {}, ok: false }, key);
    }
    assert.deepEqual(readinessSummary({ ...ready, capture: "window_not_found", window_title: "My VRChat" }),
        { key: "config_page.ocr.readiness.window_not_found", params: { title: "My VRChat" }, ok: false });
    assert.deepEqual(readinessSummary({ ...ready, capture: "window_not_found", window_title: null }).params, { title: "VRChat" });
    assert.deepEqual(readinessSummary({ ...ready, missing_models: null }).ok, true, "no list of missing models is none missing");
});

test("the worker's state reads as failed only while it retries, and an unknown stage as a failed tick", () => {
    assert.deepEqual(runtimeSummary({ state: "reading" }), { key: "config_page.ocr.runtime.reading", params: {}, ok: true, tone: "active" });
    assert.deepEqual(runtimeSummary({ state: "waiting" }), { key: "config_page.ocr.runtime.waiting", params: {}, ok: false, tone: "warning" });
    assert.deepEqual(runtimeSummary({ state: "starting" }), { key: "config_page.ocr.runtime.waiting", params: {}, ok: false, tone: "warning" });
    for (const stage of ["capture", "detector", "recognition"]) {
        assert.deepEqual(runtimeSummary({ state: "retrying", stage }), { key: `config_page.ocr.runtime.failed_${stage}`, params: {}, ok: false, tone: "failed" });
    }
    for (const stage of ["translation", null, undefined]) {
        assert.equal(runtimeSummary({ state: "retrying", stage })?.key, "config_page.ocr.runtime.failed_tick", String(stage));
    }
});

test("a worker that is stopped, or not active, reads as the readiness says, neutral only when ready", () => {
    const ready = { engine: true, language_supported: true, missing_models: [], capture: "ok" };
    for (const status of [{ active: true, state: "stopped" }, { active: false, state: "reading" }]) {
        assert.deepEqual(captureStatusSummary(status, ready),
            { key: "config_page.ocr.readiness.ready", params: {}, ok: true, sourceKey: "config_page.ocr.capture_source.stopped", tone: "neutral" }, JSON.stringify(status));
        assert.deepEqual(captureStatusSummary(status, { ...ready, engine: false }),
            { key: "config_page.ocr.readiness.engine_unavailable", params: {}, ok: false, sourceKey: "config_page.ocr.capture_source.stopped", tone: "warning" });
    }
    assert.equal(captureStatusSummary({ active: true, state: "reading", source: "vr" }, ready).key, "config_page.ocr.runtime.reading");
});

test("nothing is ready while the readiness is not known, and a shared window is lost only while the worker retries", () => {
    for (const readiness of [null, undefined]) assert.deepEqual(readinessSummary(readiness), { key: "config_page.ocr.readiness.checking", params: {}, ok: false });
    assert.equal(runtimeSummary({ state: "reading", stage: "capture", shared_window: "ended" })?.key, "config_page.ocr.runtime.reading");
    assert.equal(runtimeSummary({ state: "retrying", stage: "capture", shared_window: "ended" })?.key, "config_page.ocr.runtime.shared_window_ended");
});
