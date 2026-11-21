import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";

async function setup(context: TestContext) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const sent: unknown[][] = [];
    const { useFirstRunSetup } = await loadModule<typeof import("./useFirstRunSetup.ts")>(new URL("./useFirstRunSetup.ts", import.meta.url), runtime, {
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (...args: unknown[]) => { sent.push(args); return true; } }) },
    });
    return { runtime, sent, render: () => runtime.render(useFirstRunSetup) };
}

// #563: changing the UI language draws the main page again (App.tsx keys it by the language), and a
// guide that kept "put away" in its own state opened again at once. The first-run setup keeps it in
// atoms of its module, which outlive the page.
test("the setup put away with Later stays put away when the main page is drawn again", async context => {
    const s = await setup(context);
    s.render().updateNotice(true);
    s.render().openSetup();
    const open = s.render();
    assert.deepEqual([open.notice, open.opened, open.settled], [true, true, false]);
    open.closeSetup();
    s.runtime.remount();
    const after = s.render();
    // Still pending for a later start, closed and settled for this run.
    assert.deepEqual([after.notice, after.opened, after.settled], [true, false, true]);
    assert.deepEqual(s.sent, [], "Later is not Don't show again");
});

test("Don't show again ends the notice and tells the backend; reset forgets this run", async context => {
    const s = await setup(context);
    s.render().updateNotice(true);
    await s.render().dismissNotice();
    assert.equal(s.render().notice, false);
    assert.deepEqual(s.sent, [["/set/disable/first_run_setup"]]);
    s.render().markSettled();
    s.render().reset();
    const reset = s.render();
    assert.deepEqual([reset.notice, reset.opened, reset.settled], [null, false, false]);
});
