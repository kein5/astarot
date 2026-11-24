import { test } from "vitest";
import assert from "node:assert/strict";
import { splitDescription } from "./descriptionSplit.ts";

test("the first sentence stays visible and a long rest folds", () => {
    assert.deepEqual(splitDescription("読み上げます。保存してから、メイン画面でTTSをオンにします。サーバーも起動します。"),
        ["読み上げます。", "保存してから、メイン画面でTTSをオンにします。サーバーも起動します。"]);
    assert.deepEqual(splitDescription("Reads messages aloud. Turn TTS on from the main screen after saving it."),
        ["Reads messages aloud.", "Turn TTS on from the main screen after saving it."]);
});

test("short or single-sentence text is shown whole", () => {
    assert.deepEqual(splitDescription("一文だけの説明です。"), ["一文だけの説明です。", ""]);
    assert.deepEqual(splitDescription("Short. Tail."), ["Short. Tail.", ""]);
    assert.deepEqual(splitDescription("Version 1.2 is out"), ["Version 1.2 is out", ""]);
    assert.deepEqual(splitDescription(undefined), ["", ""]);
});

test("a rest of 24 characters is shown whole, and one of 25 folds", () => {
    assert.deepEqual(splitDescription("First. 123456789012345678901234"), ["First. 123456789012345678901234", ""]);
    assert.deepEqual(splitDescription("First. 1234567890123456789012345"), ["First.", "1234567890123456789012345"]);
});
