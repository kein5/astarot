import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { arrayToIdLabel, arrayToObject, chunkArray, clampMinMax, deviceOptionsToObject, genNumObjArray, randomIntMinMax,
    transformToIndexedArray, updateLabelsById } from "./utils.ts";

test("devices with the same name are told apart by their id", () => {
    assert.deepEqual(deviceOptionsToObject([
        { id: "a", label: "USB Mic" }, { id: "b", label: "USB Mic" }, { id: 3, label: "Headset" },
    ]), { a: "USB Mic (a)", b: "USB Mic (b)", 3: "Headset" });
});

test("lists become the shapes the selectors read", () => {
    assert.deepEqual(arrayToObject(["en", "ja"]), { en: "en", ja: "ja" });
    assert.deepEqual(arrayToIdLabel(["cpu", "cuda"]), [{ id: "cpu", label: "cpu" }, { id: "cuda", label: "cuda" }]);
    assert.deepEqual(transformToIndexedArray(["cpu", "cuda"]), { 0: "cpu", 1: "cuda" });
    assert.deepEqual(genNumObjArray(3), { 0: 0, 1: 1, 2: 2 });
    assert.deepEqual(genNumObjArray(2, 5), { 5: 5, 6: 6 });
});

test("a list is cut into rows of the given size, the last one shorter", () => {
    assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunkArray([1, 2], 2), [[1, 2]]);
    assert.deepEqual(chunkArray([], 3), []);
});

test("a value is kept inside its range", () => {
    assert.deepEqual([clampMinMax(5, 1, 10), clampMinMax(-3, 0, 10), clampMinMax(15, 1, 10), clampMinMax(7.5, 1, 10)],
        [5, 0, 10, 7.5]);
});

test("a random whole number covers both ends of the range", () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValue(0);
    assert.deepEqual([randomIntMinMax(3, 6), randomIntMinMax(4)], [3, 0]);
    random.mockReturnValue(0.9999);
    assert.deepEqual([randomIntMinMax(3, 6), randomIntMinMax(4)], [6, 4]);
    assert.equal(randomIntMinMax(2, 2), 2);
});

test("labels are replaced by id, and the rest stay as they were", () => {
    const kept = { id: 2, label: "two", extra: true };
    const updated = updateLabelsById([{ id: 1, label: "one", extra: true }, kept], [{ id: 1, label: "uno" }, { id: 9, label: "nine" }]);
    assert.deepEqual(updated, [{ id: 1, label: "uno", extra: true }, kept]);
    assert.equal(updated[1], kept);
});
