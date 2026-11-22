import { beforeEach, vi } from "vitest";
import type { TestContext } from "vitest";

type FinishedCallback = (context: TestContext) => unknown;

// The tests came from node:test and keep two of its rules for clean-up:
// - context.onTestFinished callbacks run in the order they were registered. Vitest runs them in
//   reverse; the tests unmount first and then put back the globals the unmount still uses.
// - Fake timers end with the test, after those callbacks, so a test that forgets
//   vi.useRealTimers() does not leave the next one on fake time.
beforeEach(context => {
    const callbacks: FinishedCallback[] = [];
    context.onTestFinished(async () => {
        let failure: unknown;
        for (const callback of callbacks) {
            try { await callback(context); } catch (error) { failure ??= error; }
        }
        // Only when faked: vi.useRealTimers() reads setTimeout, which a test may have stubbed.
        if (vi.isFakeTimers()) vi.useRealTimers();
        if (failure) throw failure;
    });
    // Vitest's types make onTestFinished read-only; it is a plain property that the tests' own
    // registration replaces, as the assignment did in JavaScript.
    Reflect.set(context, "onTestFinished", (callback: FinishedCallback) => { callbacks.push(callback); });
});
