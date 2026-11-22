import assert from "node:assert/strict";
import { test } from "vitest";
import { localeAt, readLocale } from "../test/locales.ts";
import { failureRun, windowFailureKey } from "./windowFailures.ts";

test("the codes the user can act on get their own words, anything else the general ones", () => {
    assert.equal(windowFailureKey("caption_overlay", "open", "caption_overlay_no_monitor"), "common_error.window.caption_overlay_no_monitor");
    assert.equal(windowFailureKey("vr_panel", "open", "vr_panel_surface_unavailable"), "common_error.window.vr_panel_surface_unavailable");
    assert.equal(windowFailureKey("caption_overlay", "update", "caption_overlay_invalid"), "common_error.window.caption_overlay_update_failed");
    assert.equal(windowFailureKey("vr_panel", "open", new Error("os error")), "common_error.window.vr_panel_open_failed");
});

for (const language of ["en", "ja"]) test(`${language}: every key a failure can show is worded`, () => {
    const tree = readLocale(language);
    const codes = ["caption_overlay_no_monitor", "caption_overlay_unsupported", "vr_panel_surface_unavailable", "anything else"];
    for (const window of ["caption_overlay", "vr_panel"] as const) for (const step of ["open", "update"] as const) for (const code of codes) {
        const key = windowFailureKey(window, step, code);
        // The VR panel is only opened; its update goes through a channel that fails silently by design.
        if (key === "common_error.window.vr_panel_update_failed") continue;
        assert.equal(typeof localeAt(tree, key), "string", key);
    }
});

test("a run of failures is said once, and a success starts a new run", () => {
    const run = failureRun();
    let said = 0;
    run.failed(() => said++);
    run.failed(() => said++);
    assert.equal(said, 1);
    run.succeeded();
    run.failed(() => said++);
    assert.equal(said, 2);
});
