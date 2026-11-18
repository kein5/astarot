import assert from "node:assert/strict";
import { test, vi } from "vitest";

// The store is read through useSyncExternalStore; take its two arguments to drive it without React.
vi.mock("react", () => ({ useSyncExternalStore: (subscribe, getSnapshot) => ({ subscribe, getSnapshot }) }));
const { setSaveBarEntry, useSaveBarEntries } = await import("./saveBar.ts");

const entry = name => ({ dirty: true, saving: false, saveState: "unsaved", changes: [name], canSave: true, save() {}, discard() {} });

test("open forms are listed until they leave, and each change is announced", () => {
    const { subscribe, getSnapshot } = useSaveBarEntries();
    let calls = 0;
    const unsubscribe = subscribe(() => calls++);
    const first = entry("voice"), second = entry("asr");
    setSaveBarEntry("voice", first);
    setSaveBarEntry("asr", second);
    assert.deepEqual(getSnapshot(), [first, second]);
    const replaced = entry("voice model");
    setSaveBarEntry("voice", replaced);
    assert.deepEqual(getSnapshot(), [replaced, second], "a form keeps its place when it updates");
    setSaveBarEntry("voice", null);
    assert.deepEqual(getSnapshot(), [second]);
    assert.equal(calls, 4);
    unsubscribe();
    setSaveBarEntry("asr", null);
    assert.equal(calls, 4, "an unsubscribed listener hears nothing more");
    assert.deepEqual(getSnapshot(), []);
});

test("the snapshot stays the same object until something changes", () => {
    const { getSnapshot } = useSaveBarEntries();
    const before = getSnapshot();
    assert.equal(getSnapshot(), before);
    setSaveBarEntry("voice", entry("voice"));
    assert.notEqual(getSnapshot(), before);
    setSaveBarEntry("voice", null);
});
