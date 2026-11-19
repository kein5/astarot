import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, eventTarget, stubGlobals } from "../../../../../../logics/test/hookHarness.js";
import { nextLogView, rowsBetween } from "../../../../../../logics/common/messageLogView.ts";
import { speakerContinuations } from "../../../../../../logics/common/speakerNames.ts";

async function setup(context, savedView, initialRows) {
    const runtime = hooks(), store = {}, observers = [];
    let rows = initialRows, subscriptions = 0, offset = 0;
    const element = { ...eventTarget(), clientHeight: 200, scrollHeight: 1000,
        contains: () => true, closest: () => null,
        get scrollTop() { return offset; },
        set scrollTop(value) { offset = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
    };
    const window = eventTarget();
    const document = { ...eventTarget(), body: {}, getSelection: () => null };
    class ResizeObserver {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    }
    stubGlobals(context, { window, document, ResizeObserver,
        getComputedStyle: () => ({ paddingTop: "16px" }),
    });
    const Virtualizer = () => null;
    const { LogBox } = await loadModule(new URL("./LogBox.tsx", import.meta.url), runtime, {
        jotai: { useAtomValue: () => { subscriptions++; return { data: rows }; } },
        virtua: { Virtualizer }, "@store": { store, Atom_MessageLogs: {} },
        "./message_container/MessageContainer": {}, "./EmptyState": { EmptyState: () => null },
        "@logics_common": { useMessageActions: () => null, nextLogView, rowsBetween, speakerContinuations,
            useSpeakerNaming: () => ({ speakerNames: {}, nameSpeakers() {} }) },
        "@logics_configs": { useSettingValue: () => ({ data: false }) },
    });
    const cache = { measured: true };
    const render = () => {
        let virtual;
        runtime.render(LogBox.type, { savedView }, tree => {
            tree.ref.current = element;
            virtual = find(tree, node => node.type === Virtualizer);
            virtual.ref.current = { cache };
        });
        return virtual;
    };
    return { render, runtime, element, store, window, cache, observers,
        get subscriptions() { return subscriptions; }, setRows: value => { rows = value; } };
}

test("VR reopening restores a paused scroll and cache before reconciling messages received while closed", async context => {
    const savedView = { current: null }, rows = [{ id: "a" }, { id: "b" }];
    const before = await setup(context, savedView, rows);
    before.render();
    assert.equal(before.element.scrollTop, 800);
    before.element.dispatch("wheel");
    before.element.scrollTop = 123;
    before.element.dispatch("scroll");
    before.runtime.unmount();
    assert.equal(savedView.current.follow, false);
    assert.equal(savedView.current.scrollTop, 123);
    assert.equal(savedView.current.cache, before.cache);
    assert.ok(before.observers.every(observer => observer.disconnected));
    const newest = [...rows, { id: "c" }];
    const after = await setup(context, savedView, newest);
    const first = after.render();
    assert.equal(first.props.cache, before.cache);
    assert.equal(first.props.data, rows); // Cache and row count match on mount.
    assert.equal(after.element.scrollTop, 123);
    const current = after.render();
    assert.equal(current.props.data, newest);
    after.element.scrollHeight = 1500;
    current.props.onResize();
    assert.equal(after.element.scrollTop, 123);
    after.runtime.unmount();
});

test("VR reopening keeps following the latest bottom; End restores follow after a manual scroll", async context => {
    const savedView = { current: null };
    const before = await setup(context, savedView, [{ id: "a" }]);
    before.render();
    before.runtime.unmount();
    assert.equal(savedView.current.follow, true);
    const after = await setup(context, savedView, [{ id: "a" }, { id: "b" }]);
    after.render();
    const current = after.render();
    after.element.scrollHeight = 1500;
    current.props.onResize();
    assert.equal(after.element.scrollTop, 1300);
    after.element.dispatch("wheel");
    after.element.scrollTop = 100;
    after.element.dispatch("scroll");
    current.props.onResize();
    assert.equal(after.element.scrollTop, 100);
    after.window.dispatch("keydown", { key: "End", target: after.element });
    assert.equal(after.element.scrollTop, 1300);
    after.runtime.unmount();
    assert.equal(savedView.current.follow, true);
});

test("retention during closure uses the existing two-step shift after restoring the saved view", async context => {
    const oldRows = [{ id: "a" }, { id: "b" }, { id: "c" }], newest = [{ id: "b" }, { id: "c" }, { id: "d" }];
    const savedView = { current: { view: { rows: oldRows, source: oldRows, shift: false }, follow: false, scrollTop: 100 } };
    const subject = await setup(context, savedView, newest);
    assert.equal(subject.render().props.data, oldRows);
    const shift = subject.render();
    assert.equal(shift.props.shift, true);
    assert.deepEqual(shift.props.data.map(row => row.id), ["b", "c"]);
    assert.equal(subject.render().props.data, newest);
    subject.runtime.unmount();
});

test("an empty log stays at its top while the empty state grows, and follows again from the first row", async context => {
    // At startup the list under the greeting grows past the log's height; following the end
    // scrolled the greeting up (262 to 245 px in the default window with a tall input box).
    const subject = await setup(context, undefined, []);
    let virtual = subject.render();
    assert.equal(subject.element.scrollTop, 0);
    subject.observers[0].callback();
    virtual.props.onResize();
    subject.element.scrollTop = 0;
    subject.element.dispatch("scroll");
    assert.equal(subject.element.scrollTop, 0, "layout changes do not scroll the empty state");
    subject.setRows([{ id: "a" }]);
    virtual = subject.render();
    assert.equal(subject.element.scrollTop, 800, "the first message is followed as before");
    subject.runtime.unmount();
});

test("desktop without a saved view still follows layout changes and pauses only for user scroll", async context => {
    const subject = await setup(context, undefined, [{ id: "a" }]);
    const virtual = subject.render();
    assert.equal(virtual.props.cache, undefined);
    subject.element.scrollTop = 10;
    subject.element.dispatch("scroll");
    assert.equal(subject.element.scrollTop, 800);
    subject.element.dispatch("wheel");
    subject.element.scrollTop = 10;
    subject.element.dispatch("scroll");
    virtual.props.onResize();
    assert.equal(subject.element.scrollTop, 10);
    subject.runtime.unmount();
});
