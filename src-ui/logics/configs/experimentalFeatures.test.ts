import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as features from "./experimentalFeatures.ts";

// Whether an experimental feature is on (experimentalFeatures.ts, useExperimentalFeature.ts): only
// a listed feature the backend confirmed as true.
test("a feature is on only where the backend's object says true for it", () => {
    const { isExperimentalFeatureEnabled: enabled } = features;
    assert.equal(enabled({ tray_companion: true }, "tray_companion"), true);
    for (const values of [null, undefined, { tray_companion: "true" }, { tray_companion: 1 }, "tray_companion", true,
        // A value of the wrong shape, given on purpose: a function that has the feature's field.
        Object.assign(() => {}, { tray_companion: true })]) {
        assert.equal(enabled(values, "tray_companion"), false, String(typeof values === "function" ? "a function" : JSON.stringify(values)));
    }
    assert.equal(enabled({ unknown: true }, "unknown"), false, "a feature that is not listed is never on");
});

test("the hook reads the experimental features setting and answers for the feature it is asked about", async () => {
    const read: string[] = [];
    let data: unknown = { tray_companion: true };
    const runtime = hooks();
    const { useExperimentalFeature } = await loadModule<typeof import("./useExperimentalFeature.ts")>(new URL("./useExperimentalFeature.ts", import.meta.url), runtime, {
        "./config_page_setter/ui_config_setter": { useSettingValue: (name: string) => { read.push(name); return { state: "ok", data }; } },
        "./experimentalFeatures.ts": features,
    });
    assert.equal(runtime.render(() => useExperimentalFeature("tray_companion")), true);
    assert.equal(runtime.render(() => useExperimentalFeature("other")), false);
    data = null;
    assert.equal(runtime.render(() => useExperimentalFeature("tray_companion")), false);
    assert.deepEqual(read, ["ExperimentalFeatures", "ExperimentalFeatures", "ExperimentalFeatures"]);
});
