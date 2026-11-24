import assert from "node:assert/strict";
import { test } from "vitest";
import { SPEAKER_COLORS, speakerColorIndex, speakerLabels } from "./speakerLabels.ts";

test("only up to four labels of capital letters are speakers", () => {
    assert.deepEqual(speakerLabels(["A", "B"]), ["A", "B"]);
    for (const value of [["a"], ["A", 1], ["A", "B", "C", "D", "E"], "A", null, ["ABCD"]]) assert.deepEqual(speakerLabels(value), [], JSON.stringify(value));
});

// #1036: the conversation log and the desktop caption overlay give a voice the same color, in the
// order the voices speak: A purple, B amber, C green, D rose, and the fifth voice starts over.
test("a voice's color follows its label: A to D in order, then over again", () => {
    assert.equal(SPEAKER_COLORS, 4);
    assert.deepEqual(["A", "B", "C", "D", "E", "Z", "AA", "AB"].map(speakerColorIndex), [0, 1, 2, 3, 0, 1, 2, 3]);
});
