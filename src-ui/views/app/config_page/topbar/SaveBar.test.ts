import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, eventTarget, stubGlobals } from "../../../../logics/test/hookHarness.ts";
import { readLocale, localeAt, textAt } from "../../../../logics/test/locales.ts";

const t = (key: string, options?: { changes?: string }) => options?.changes ? `${key}[${options.changes}]` : key;
async function render(context: TestContext, entries: unknown, tab = "tts") {
    const runtime = hooks();
    // The leave guard listens on the window while there are edits.
    stubGlobals(context, { window: eventTarget() });
    const { SaveBar } = await loadModule<typeof import("./Topbar.tsx")>(new URL("./Topbar.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "@logics_common": {},
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: tab } }) },
        "../../../../logics/voice/saveBar": { useSaveBarEntries: () => entries }, "../../others/stop_actions/StopActions": {},
    });
    const tree = runtime.render(SaveBar);
    runtime.unmount();
    return tree;
}
async function bar(context: TestContext, entries: unknown) {
    const tree = await render(context, entries);
    const status = find(tree, node => node.props?.role === "status");
    assert.ok(status);
    const count = find(tree, node => node.props?.className === "count");
    const save = find(tree, node => node.type === "button" && node.props.className === "save");
    assert.ok(save);
    return { status: status.props.children, count, save: save.props };
}
const entry = (values: Record<string, unknown>) => ({ dirty: true, edited: true, saving: false, saveState: "unsaved", changes: [], canSave: true, save() {}, discard() {}, ...values });

test("a change the page proposes is named as what Save will apply, not as an unsaved edit", async context => {
    // The RVC page selecting RVC: nothing was edited, one thing is pending.
    const proposed = await bar(context, [entry({ edited: false, changes: ["Use RVC for direct voice"] })]);
    assert.equal(proposed.status, "voice_ui.applies_on_save[Use RVC for direct voice]");
    assert.equal(proposed.count, null, "no count of changes the user did not make");
    assert.equal(proposed.save.disabled, false, "Save still applies it");
});

test("an edit is still an unsaved change, alone or beside a proposal", async context => {
    const edited = await bar(context, [entry({ changes: ["Pitch"] })]);
    assert.match(edited.status, /^voice_ui\.unsaved/);
    assert.ok(edited.count);
    const both = await bar(context, [entry({ edited: false, changes: ["Use RVC for direct voice"] }), entry({ changes: ["Pitch"] })]);
    assert.match(both.status, /^voice_ui\.unsaved/);
    // Forms that do not tell edits from proposals count as edited, as before.
    const legacy = await bar(context, [entry({ edited: undefined, changes: ["Port"] })]);
    assert.match(legacy.status, /^voice_ui\.unsaved/);
});

test("saving and a failed save keep their own words; nothing dirty is saved", async context => {
    assert.match((await bar(context, [entry({ edited: false, saving: true, changes: ["x"] })])).status, /^voice_ui\.saving/);
    assert.match((await bar(context, [entry({ edited: false, saveState: "save_failed", changes: ["x"] })])).status, /^voice_ui\.save_failed/);
    assert.match((await bar(context, [entry({ dirty: false, edited: false })])).status, /^voice_ui\.saved/);
});

test("#436: a page without a form says in the save bar's place that its changes apply at once", async context => {
    for (const tab of ["appearance", "vr", "hotkeys"]) {
        const tree = await render(context, [], tab);
        const note = find(tree, node => node.props?.className === "applies_now");
        assert.equal(note?.props.children, "voice_ui.applies_now", tab);
        assert.equal(find(tree, node => node.type === "button"), null, `${tab}: nothing to save or discard`);
    }
    // The about page holds no settings, so it says nothing.
    assert.equal(find(await render(context, [], "about_vrct"), node => node.props?.className === "applies_now"), null);
    // A page with a form shows the bar instead.
    assert.equal(find(await render(context, [entry({ dirty: false, edited: false })]), node => node.props?.className === "applies_now"), null);
});

test("the wording exists in English and Japanese and names the change", () => {
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        assert.match(textAt(strings, "voice_ui.applies_on_save"), /\{\{changes\}\}/);
        assert.equal(typeof localeAt(strings, "voice_ui.changes_separator"), "string");
        assert.equal(typeof localeAt(strings, "voice_ui.applies_now"), "string");
    }
});

// #912: the save bar is as high as search, stop and back beside it (4rem), so the row under the
// header does not move when a page with a form opens after one without.
test("the save bar with its buttons is 4rem high, as the other parts of the header row", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("./Topbar.module.scss", import.meta.url), "utf8");
    const rule = (selector: string) => new RegExp(`^${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
    const rem = (text: string, property: string) => Number(new RegExp(`${property}: ([\\d.]+)rem`).exec(text)?.[1]);
    const bar = rule(".save_bar"), buttons = rule(".discard, .save");
    const padding = /padding: ([\d.]+)rem ([\d.]+)rem ([\d.]+)rem/.exec(bar);
    assert.ok(padding, "the save bar's padding");
    const [top, , bottom] = padding.slice(1).map(Number);
    const border = Number(/border: ([\d.]+)rem solid/.exec(bar)?.[1]);
    assert.equal(+(rem(buttons, "min-height") + top + bottom + 2 * border).toFixed(2), 4);
    assert.equal(rem(bar, "min-height"), 4);
    // The parts beside it: back and stop are 4rem high.
    assert.equal(rem(rule(".back"), "min-height"), 4);
    assert.equal(rem(rule(".stop"), "min-height"), 4);
});
