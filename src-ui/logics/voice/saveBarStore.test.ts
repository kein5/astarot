import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { SaveBarEntry } from "./saveBar.ts";
import { unchecked } from "../test/hookHarness.ts";

// The store is read through useSyncExternalStore; take its two arguments to drive it without React.
vi.mock("react", () => ({ useSyncExternalStore: (subscribe: unknown, getSnapshot: unknown) => ({ subscribe, getSnapshot }) }));
const { setSaveBarEntry, useSaveBarEntries } = await import("./saveBar.ts");

// What the mocked useSyncExternalStore returns: the store's own subscribe and snapshot.
interface ExternalStore {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => readonly SaveBarEntry[];
}
// Not the entries the hook is declared to return: react is mocked above.
const storeOf = () => unchecked<ExternalStore>(useSaveBarEntries());

const entry = (name: string): SaveBarEntry => ({ dirty: true, saving: false, saveState: "unsaved", changes: [name], canSave: true, save() {}, discard() {} });

test("open forms are listed until they leave, and each change is announced", () => {
    const { subscribe, getSnapshot } = storeOf();
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
    const { getSnapshot } = storeOf();
    const before = getSnapshot();
    assert.equal(getSnapshot(), before);
    setSaveBarEntry("voice", entry("voice"));
    assert.notEqual(getSnapshot(), before);
    setSaveBarEntry("voice", null);
});
