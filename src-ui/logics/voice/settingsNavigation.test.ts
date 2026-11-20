import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { stubGlobals } from "../test/hookHarness.ts";
import { requestSettingsNavigation } from "./settingsNavigation.ts";

// The document the request starts at: a plain event target that records what it was given.
const documentStub = (context: TestContext, listener?: (event: Event) => void) => {
    const seen: Event[] = [];
    const target = new EventTarget();
    target.addEventListener("vrct:settings-leave", event => { seen.push(event); listener?.(event); });
    stubGlobals(context, { document: target });
    return seen;
};
// The page change the event carries, as the listeners read it.
const proceedOf = (event: Event): unknown => "detail" in event && typeof event.detail === "object" && event.detail !== null
    && "proceed" in event.detail ? event.detail.proceed : undefined;

test("a page change starts at the document and bubbles, so the window's capture listener is asked before the forms", context => {
    const seen = documentStub(context);
    let proceeded = 0;
    const proceed = () => { proceeded++; };
    requestSettingsNavigation(proceed);
    assert.equal(seen.length, 1);
    // Bubbling from the document reaches the window's capture listeners first, then its other
    // listeners; an event dispatched on the window itself has no such order in Chromium.
    assert.equal(seen[0].bubbles, true);
    assert.equal(seen[0].cancelable, true);
    assert.equal(proceedOf(seen[0]), proceed);
    assert.equal(proceeded, 1, "nothing asked to wait, so the page changes at once");
});

test("a listener that prevents the request keeps the page and holds the change for later", context => {
    const seen = documentStub(context, event => event.preventDefault());
    let proceeded = 0;
    requestSettingsNavigation(() => { proceeded++; });
    assert.equal(proceeded, 0);
    const held = proceedOf(seen[0]);
    assert.ok(typeof held === "function");
    held();
    assert.equal(proceeded, 1);
});
