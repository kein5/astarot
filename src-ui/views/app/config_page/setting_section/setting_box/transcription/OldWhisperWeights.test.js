import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";
import * as migration from "../../../../../../logics/transcription/localAsrMigration.js";

async function setup(context, values) {
    const runtime = hooks(), deletes = [];
    const state = { weights: null, outcome: null, deleting: false, error: null,
        deleteWeights: () => { deletes.push(true); state.deleting = true; }, ...values };
    const { OldWhisperWeights } = await loadModule(new URL("./OldWhisperWeights.jsx", import.meta.url), runtime, {
        "../../../../../../logics/transcription/useLocalAsrMigration": { useLocalAsrMigration: () => state },
        "../../../../../../logics/transcription/localAsrMigration.js": migration,
    });
    context.after(() => runtime.unmount());
    const render = (props = {}) => runtime.render(OldWhisperWeights, props);
    const all = (tree, type) => {
        const found = [];
        find(tree, node => { if (node.type === type) found.push(node); return false; });
        return found;
    };
    const click = label => all(render(), "button").find(button => button.props.children === label).props.onClick();
    return { render, all, click, state, deletes };
}

const remaining = { total_bytes: 147882941, folders: ["base"] };

test("nothing is shown while no old Whisper model is on this PC", async context => {
    assert.equal((await setup(context)).render(), null);
    assert.equal((await setup(context, { weights: { total_bytes: 0, folders: [] } })).render(), null);
});

test("the size is shown with a delete button that asks first, in place", async context => {
    const s = await setup(context, { weights: remaining });
    const tree = s.render();
    assert.equal(tree.props["data-setting-id"], "old_whisper_weights");
    assert.equal(find(tree, node => node.type === "h3").props.children, "old_whisper_weights.label");
    assert.ok(find(tree, node => node.props?.children === "old_whisper_weights.desc"));
    assert.deepEqual(s.all(tree, "button").map(button => button.props.children), ["old_whisper_weights.delete"]);

    s.click("old_whisper_weights.delete");
    let confirm = find(s.render(), node => node.props?.role === "group");
    assert.ok(confirm, "the question replaces the button");
    assert.deepEqual(s.all(confirm, "button").map(button => button.props.children),
        ["old_whisper_weights.cancel", "old_whisper_weights.confirm_delete"]);
    // The safe answer has the focus, and pressing Delete once has deleted nothing.
    assert.equal(s.all(confirm, "button")[0].props.autoFocus, true);
    assert.deepEqual(s.deletes, []);

    s.click("old_whisper_weights.cancel");
    assert.equal(find(s.render(), node => node.props?.role === "group"), null);
    assert.deepEqual(s.deletes, []);

    s.click("old_whisper_weights.delete");
    s.click("old_whisper_weights.confirm_delete");
    assert.deepEqual(s.deletes, [true]);
    // While deleting, the button says so and ignores presses (it stays focusable: aria-disabled).
    const busy = s.all(s.render(), "button")[0];
    assert.equal(busy.props.children, "old_whisper_weights.deleting");
    assert.equal(busy.props["aria-disabled"], true);
    assert.equal(busy.props.disabled, undefined);
    busy.props.onClick();
    assert.equal(find(s.render(), node => node.props?.role === "group"), null);
    assert.deepEqual(s.deletes, [true]);
});

test("the result says what was freed, or what could not be deleted", async context => {
    const done = await setup(context, { weights: { total_bytes: 0, folders: [] }, outcome: { freed_bytes: 1529008357, failed: [] } });
    const tree = done.render();
    assert.equal(find(tree, node => node.props?.role === "status").props.children, "old_whisper_weights.deleted");
    assert.deepEqual(done.all(tree, "button"), []);

    const partly = await setup(context, { weights: remaining, outcome: { freed_bytes: 10, failed: ["base"] } });
    assert.equal(find(partly.render(), node => node.props?.role === "alert").props.children, "old_whisper_weights.failed");
    assert.deepEqual(partly.all(partly.render(), "button").map(button => button.props.children), ["old_whisper_weights.delete"]);

    const failed = await setup(context, { error: "old_whisper_weights_unreadable" });
    assert.equal(find(failed.render(), node => node.props?.role === "alert").props.children, "old_whisper_weights.unavailable");
});

test("inside the notice dialog it is a part of the dialog, not a settings section", async context => {
    const s = await setup(context, { weights: remaining });
    const tree = s.render({ inDialog: true });
    assert.equal(tree.props["data-setting-id"], undefined);
    assert.ok(find(tree, node => node.type === "h4"));
});
