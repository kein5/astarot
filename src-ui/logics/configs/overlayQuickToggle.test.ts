import assert from "node:assert/strict";
import { test } from "vitest";
import { overlayToggle } from "./overlayQuickToggle.ts";

// #939: the quick settings' subtitle overlay switches the overlays in VR in place.
test("pressed while an overlay is on, the ones on go off and are kept for the next press", () => {
    assert.deepEqual(overlayToggle({ small: true, large: false }, null), { flip: ["small"], keep: { small: true, large: false } });
    assert.deepEqual(overlayToggle({ small: true, large: true }, null), { flip: ["small", "large"], keep: { small: true, large: true } });
    assert.deepEqual(overlayToggle({ small: false, large: true }, { small: true, large: false }), { flip: ["large"], keep: { small: false, large: true } });
});

test("pressed while both are off, the ones kept come back, or the one-line overlay when none is kept", () => {
    assert.deepEqual(overlayToggle({ small: false, large: false }, { small: false, large: true }).flip, ["large"]);
    assert.deepEqual(overlayToggle({ small: false, large: false }, { small: true, large: true }).flip, ["small", "large"]);
    assert.deepEqual(overlayToggle({ small: false, large: false }, null).flip, ["small"]);
    assert.deepEqual(overlayToggle({ small: false, large: false }, { small: false, large: false }).flip, ["small"]);
});
