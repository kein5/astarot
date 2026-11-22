import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";
import * as logic from "./overlayQuickToggle.ts";

// #939: the toggle switches the overlays the logic names, keeps which went off, and waits while
// either is being switched.
test("the quick toggle switches the overlays in place and brings back the ones it turned off", async () => {
    const runtime = hooks(), flipped: string[] = [];
    const vr = { small: { state: "ok", data: false }, large: { state: "ok", data: true } };
    const { useOverlayQuickToggle } = await loadModule<typeof import("./useOverlayQuickToggle.ts")>(new URL("./useOverlayQuickToggle.ts", import.meta.url), runtime, {
        "@logics_configs": { useVr: () => ({ currentIsEnabledOverlaySmallLog: vr.small, currentIsEnabledOverlayLargeLog: vr.large,
            toggleIsEnabledOverlaySmallLog: () => { flipped.push("small"); vr.small = { state: "ok", data: !vr.small.data }; },
            toggleIsEnabledOverlayLargeLog: () => { flipped.push("large"); vr.large = { state: "ok", data: !vr.large.data }; } }) },
        "./overlayQuickToggle.ts": logic,
    });
    const toggle = () => runtime.render(useOverlayQuickToggle);
    assert.equal(toggle().on, true);
    toggle().toggle();
    assert.deepEqual([flipped, toggle().on], [["large"], false]);
    toggle().toggle();
    assert.deepEqual([flipped, toggle().on], [["large", "large"], true], "the multi-line overlay it turned off comes back");
    // Switching: a press waits.
    vr.large = { state: "pending", data: true };
    assert.equal(toggle().pending, true);
    toggle().toggle();
    assert.equal(flipped.length, 2);
    runtime.unmount();
});
