import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { loadModule, hooks, stubGlobals } from "../test/hookHarness.ts";

type Effect = () => (() => void) | undefined;

// The hook with React's two kinds of effects held for the test to run, as React runs them: the
// layout effect at the commit, the passive one after it.
async function consentDialog(t: TestContext, fallback: { current: unknown } = { current: null }) {
    const refs: { current: unknown }[] = [];
    // Called before the hook has set it, it stops with a TypeError, as calling null did.
    const missing: Effect = () => { throw new TypeError("effect is not a function"); };
    let layoutEffect = missing, effect = missing, refIndex = 0;
    const react = {
        useRef: (initial: unknown) => {
            refs[refIndex] ??= { current: initial };
            return refs[refIndex++];
        },
        useLayoutEffect: (fn: Effect) => { layoutEffect = fn; },
        useEffect: (fn: Effect) => { effect = fn; },
    };
    const focused: string[] = [];
    // An element that takes focus, as the hook reads one.
    const element = (name: string) => ({ tagName: name.toUpperCase(), isConnected: true, disabled: false, tabIndex: 0, matches: () => false,
        getAttribute: () => null, closest: () => null, focus: () => { focused.push(name); } });
    const body = element("body"), opener = element("opener");
    const doc: { activeElement: object; body: object } = { activeElement: opener, body };
    stubGlobals(t, { document: doc });
    const shown: string[] = [];
    const modal = { open: false, contains: () => false,
        showModal() { this.open = true; shown.push("showModal"); doc.activeElement = { tagName: "A" }; },
        close() { this.open = false; doc.activeElement = body; } };
    const { useConsentDialog } = await loadModule<typeof import("./useConsentDialog.ts")>(new URL("./useConsentDialog.ts", import.meta.url), hooks(),
        { react });
    const render = (open: boolean) => {
        refIndex = 0;
        const result = useConsentDialog(open, fallback as { current: HTMLElement | null });
        // React types the ref as read-only; the dialog's element is set as React sets it.
        Reflect.set(result.dialog, "current", modal);
        return result;
    };
    return { render, modal, focused, shown, doc, element, layout: () => layoutEffect(), passive: () => effect() };
}

// StrictMode runs mount, cleanup and mount again with the same refs. The native
// dialog's close() can leave focus on the body before the replayed effect runs.
test("a StrictMode effect replay keeps the original opener for focus return", async t => {
    const { render, modal, focused, layout, passive } = await consentDialog(t);
    render(true);
    layout();
    const cleanupFirst = passive();
    cleanupFirst?.();
    layout();
    const cleanupReplay = passive();
    await Promise.resolve();
    assert.equal(modal.open, true, "the replayed effect reopened the dialog");
    assert.deepEqual(focused, [], "the replay does not move focus out of the open dialog");

    render(false);
    cleanupReplay?.();
    layout();
    passive();
    await Promise.resolve();
    assert.equal(modal.open, false);
    assert.deepEqual(focused, ["opener"]);
});

// The kit's Dialog, drawn inside the caller, shows the dialog in its own effect, which React runs
// before the caller's: the opener is read at the commit, before that, and the dialog is shown once.
test("a dialog the kit's Dialog has shown keeps the opener read before it took the focus", async t => {
    const { render, modal, focused, shown, layout, passive } = await consentDialog(t);
    render(true);
    layout();
    // The kit's Dialog's effect.
    modal.showModal();
    const cleanup = passive();
    assert.deepEqual(shown, ["showModal"], "shown once");
    render(false);
    cleanup?.();
    layout();
    passive();
    await Promise.resolve();
    assert.equal(modal.open, false);
    assert.deepEqual(focused, ["opener"]);
});

// Each opening reads its own opener; with the page itself focused there is none, and the focus goes
// to the caller's section instead of the body.
test("each opening returns focus to its own opener, and never to the body", async t => {
    const section = { isConnected: true, querySelectorAll: () => [], focus: () => { focused.push("section"); } };
    const { render, focused, doc, element, layout, passive } = await consentDialog(t, { current: section });
    const open = () => { render(true); layout(); return passive(); };
    const close = async (cleanup: (() => void) | undefined) => { render(false); cleanup?.(); layout(); passive(); await Promise.resolve(); };
    await close(open());
    assert.deepEqual(focused, ["opener"]);
    doc.activeElement = element("another");
    await close(open());
    assert.deepEqual(focused, ["opener", "another"], "the second opener, not the first");
    doc.activeElement = doc.body;
    await close(open());
    assert.deepEqual(focused, ["opener", "another", "section"]);
});
