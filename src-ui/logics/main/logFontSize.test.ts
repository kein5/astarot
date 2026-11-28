import assert from "node:assert/strict";
import { test } from "vitest";
import { atLogFontLimit, LOG_FONT_SIZE, nextLogFontSize } from "./logFontSize.ts";

// #1314 (M-8): A− and A＋ beside the composer step the log's font size along the slider's marks.

test("a press moves the size one mark of the slider's scale", () => {
    assert.equal(nextLogFontSize(100, 1), 110);
    assert.equal(nextLogFontSize(100, -1), 90);
    // A size saved between two marks goes to the mark on the pressed side.
    assert.equal(nextLogFontSize(105, 1), 110);
    assert.equal(nextLogFontSize(105, -1), 100);
});

test("the size stays in the slider's range", () => {
    assert.equal(nextLogFontSize(LOG_FONT_SIZE.max, 1), LOG_FONT_SIZE.max);
    assert.equal(nextLogFontSize(LOG_FONT_SIZE.min, -1), LOG_FONT_SIZE.min);
    assert.equal(nextLogFontSize(400, -1), LOG_FONT_SIZE.max);
    assert.equal(nextLogFontSize(10, 1), LOG_FONT_SIZE.min);
    assert.equal(atLogFontLimit(200, 1), true);
    assert.equal(atLogFontLimit(200, -1), false);
    assert.equal(atLogFontLimit(40, -1), true);
    assert.equal(atLogFontLimit(40, 1), false);
});
