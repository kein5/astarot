import assert from "node:assert/strict";
import { test } from "vitest";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, placementOf, steppedFontSize } from "./adjust.ts";
import { unchecked } from "../test/hookHarness.ts";

test("a size step moves by the slider's step and stops at its ends", () => {
    assert.equal(steppedFontSize(28, 1), 30);
    assert.equal(steppedFontSize(28, -1), 26);
    assert.equal(steppedFontSize(FONT_SIZE_MAX, 1), FONT_SIZE_MAX);
    assert.equal(steppedFontSize(FONT_SIZE_MIN, -1), FONT_SIZE_MIN);
    // An odd size from an older setting lands back inside the range.
    assert.equal(steppedFontSize(71, 1), FONT_SIZE_MAX);
    for (const change of [0, 2, -2, "1", null, undefined, 0.5]) assert.equal(steppedFontSize(28, change), 28);
});

test("a place is two whole numbers; anything else is the band", () => {
    assert.deepEqual(placementOf({ x: -1700, y: 0 }), { x: -1700, y: 0 });
    const withExtra = { x: 1, y: 2, extra: 3 };
    assert.deepEqual(placementOf(withExtra), { x: 1, y: 2 });
    for (const value of [null, undefined, {}, { x: null, y: null }, { x: 1 }, { x: 1.5, y: 2 }, { x: "1", y: 2 }, [1, 2]]) {
        // Wrong shapes on purpose: the place must be two whole numbers.
        assert.equal(placementOf(unchecked(value)), null);
    }
});
