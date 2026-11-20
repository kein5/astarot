import assert from "node:assert/strict";
import { test } from "vitest";
import { loadModule, hooks, stubGlobals } from "../test/hookHarness.ts";

type Effect = () => () => void;

// StrictMode runs mount, cleanup and mount again with the same refs. The native
// dialog's close() can leave focus on the body before the replayed effect runs.
test("a StrictMode effect replay keeps the original opener for focus return", async t => {
    const refs: { current: unknown }[] = [];
    // Called before the hook has set it, it stops with a TypeError, as calling null did.
    let effect: Effect = () => { throw new TypeError("effect is not a function"); }, refIndex = 0;
    const react = {
        useRef: (initial: unknown) => (refs[refIndex] ??= { current: initial }, refs[refIndex++]),
        useEffect: (fn: Effect) => { effect = fn; },
    };
    const body = { tagName: "BODY" };
    const focused: string[] = [];
    const opener = { isConnected: true, disabled: false, tabIndex: 0, matches: () => false,
        getAttribute: () => null, closest: () => null, focus: () => { focused.push("opener"); } };
    const doc: { activeElement: object; body: object } = { activeElement: opener, body };
    stubGlobals(t, { document: doc });
    const modal = { open: false, contains: () => false,
        showModal() { this.open = true; doc.activeElement = { tagName: "A" }; },
        close() { this.open = false; doc.activeElement = body; } };
    const { useConsentDialog } = await loadModule<typeof import("./useConsentDialog.ts")>(new URL("./useConsentDialog.ts", import.meta.url), hooks(),
        { react });
    const render = (open: boolean) => {
        refIndex = 0;
        const result = useConsentDialog(open, { current: null });
        // React types the ref as read-only; the dialog's element is set as React sets it.
        Reflect.set(result.dialog, "current", modal);
        return result;
    };

    render(true);
    const cleanupFirst = effect();
    cleanupFirst();
    const cleanupReplay = effect();
    await Promise.resolve();
    assert.equal(modal.open, true, "the replayed effect reopened the dialog");
    assert.deepEqual(focused, [], "the replay does not move focus out of the open dialog");

    render(false);
    cleanupReplay();
    effect();
    await Promise.resolve();
    assert.equal(modal.open, false);
    assert.deepEqual(focused, ["opener"]);
});
