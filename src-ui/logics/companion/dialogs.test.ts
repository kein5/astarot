import assert from "node:assert/strict";
import { test } from "vitest";
import { watchOpenDialogs } from "./dialogs.ts";
import { unchecked } from "../test/hookHarness.ts";

const fake = () => {
    const state: { open: boolean; callback: () => void; options: MutationObserverInit | null; disconnected: boolean } = { open: false,
        // Called before an observer exists, it stops with a TypeError, as calling null did.
        callback: () => { throw new TypeError("state.callback is not a function"); },
        options: null, disconnected: false };
    // Test data: a document with only what the watch reads.
    const root = unchecked<Parameters<typeof watchOpenDialogs>[0]>({ body: {},
        querySelector: (selector: string) => (selector === "dialog[open]" && state.open ? {} : null) });
    class Observer {
        constructor(callback: () => void) { state.callback = callback; }
        observe(_target: unknown, options: MutationObserverInit) { state.options = options; }
        disconnect() { state.disconnected = true; }
    }
    return { state, root, Observer };
};

test("a dialog opening in the hidden main window is reported once until it closes", () => {
    const { state, root, Observer } = fake(), opened: number[] = [];
    const stop = watchOpenDialogs(root, () => opened.push(1), Observer);
    assert.deepEqual(state.options?.attributeFilter, ["open"]);
    state.callback();
    assert.equal(opened.length, 0);
    state.open = true; state.callback(); state.callback();
    assert.equal(opened.length, 1);
    state.open = false; state.callback();
    state.open = true; state.callback();
    assert.equal(opened.length, 2);
    stop();
    assert.equal(state.disconnected, true);
});

test("a dialog already open when the watch starts is reported at once", () => {
    const { state, root, Observer } = fake(), opened: number[] = [];
    state.open = true;
    watchOpenDialogs(root, () => opened.push(1), Observer);
    assert.equal(opened.length, 1);
});

test("without an observer (or a body) it watches nothing", () => {
    const { root } = fake();
    assert.doesNotThrow(() => watchOpenDialogs(root, () => {}, undefined)());
    assert.doesNotThrow(() => watchOpenDialogs({ body: null, querySelector: () => null }, () => {}, fake().Observer)());
});
