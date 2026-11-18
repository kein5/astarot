import assert from "node:assert/strict";
import { test } from "vitest";
import { watchOpenDialogs } from "./dialogs.ts";

const fake = () => {
    const state = { open: false, callback: null, options: null, disconnected: false };
    const root = { body: {}, querySelector: selector => (selector === "dialog[open]" && state.open ? {} : null) };
    class Observer {
        constructor(callback) { state.callback = callback; }
        observe(_target, options) { state.options = options; }
        disconnect() { state.disconnected = true; }
    }
    return { state, root, Observer };
};

test("a dialog opening in the hidden main window is reported once until it closes", () => {
    const { state, root, Observer } = fake(), opened = [];
    const stop = watchOpenDialogs(root, () => opened.push(1), Observer);
    assert.deepEqual(state.options.attributeFilter, ["open"]);
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
    const { state, root, Observer } = fake(), opened = [];
    state.open = true;
    watchOpenDialogs(root, () => opened.push(1), Observer);
    assert.equal(opened.length, 1);
});

test("without an observer (or a body) it watches nothing", () => {
    const { root } = fake();
    assert.doesNotThrow(() => watchOpenDialogs(root, () => {}, undefined)());
    assert.doesNotThrow(() => watchOpenDialogs({ body: null, querySelector: () => null }, () => {}, fake().Observer)());
});
