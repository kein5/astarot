import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { stubGlobals, unchecked } from "../../logics/test/hookHarness.ts";
import { trackVrPointerHover } from "./vrPanelHover.ts";

// What the VR hover tracker watches so that a laser that stays still still marks what is under it
// when the page moves, and what it lets go of when it stops. vrPanelHover.test.ts covers the hit
// tests themselves.

type Call = [string, ...unknown[]];

function setup(context: TestContext, { body = true, fonts = true } = {}) {
    // Stopped before the globals go back: it lets go of them.
    let hover: ReturnType<typeof trackVrPointerHover> | undefined;
    context.onTestFinished(() => hover?.dispose());
    const calls: Call[] = [], frames = new Map<number, () => void>();
    let frameId = 0;
    const listening = (name: string) => ({
        addEventListener: (...args: unknown[]) => { calls.push([`${name}.add`, ...args]); },
        removeEventListener: (...args: unknown[]) => { calls.push([`${name}.remove`, ...args]); },
    });
    const root = { ...listening("root"), contains: () => true,
        querySelectorAll: (selector: string) => selector === "[data-vr-region]" ? ["launcher region", "popup region"] : [] };
    const button = { name: "button", closest: (selector: string) => selector === "[inert]" ? null : button,
        setAttribute: (...args: unknown[]) => { calls.push(["button.set", ...args]); },
        removeAttribute: (...args: unknown[]) => { calls.push(["button.remove", ...args]); } };
    const document = { documentElement: "html", body: body ? "body" : null, fonts: fonts ? listening("fonts") : undefined, elementFromPoint: () => button };
    const observer = (kind: string) => class {
        callback: () => void;
        constructor(callback: () => void) { this.callback = callback; }
        observe(...args: unknown[]) { calls.push([`${kind}.observe`, ...args]); }
        disconnect() { calls.push([`${kind}.disconnect`]); }
    };
    stubGlobals(context, { document, window: listening("window"), MutationObserver: observer("mutations"), ResizeObserver: observer("resize"),
        requestAnimationFrame: (callback: () => void) => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: (id: number) => { calls.push(["cancelFrame", id]); frames.delete(id); },
    });
    // Test data: the root holds only what the tracker uses of an element.
    const tracker = trackVrPointerHover(unchecked<HTMLElement>(root));
    hover = tracker;
    return { hover: tracker, root, calls, frames, frame: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => { fn(); }); } };
}
const of = (calls: Call[], name: string) => calls.filter(([kind]) => kind === name).map(([, ...args]) => args);

test("the tracker watches the atlas, its regions and the page's inherited styles for what can move under the laser", context => {
    const { calls, root } = setup(context);
    assert.deepEqual(of(calls, "mutations.observe"), [
        // Our own data-vr-hover is left out: marking a button must not start another hit test.
        [root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "inert", "disabled"] }],
        ["html", { attributes: true, attributeFilter: ["class", "style", "lang", "dir"] }],
        ["body", { attributes: true, attributeFilter: ["class", "style", "lang", "dir"] }],
    ]);
    assert.deepEqual(of(calls, "resize.observe"), [[root], ["launcher region"], ["popup region"]]);
    const [scroll] = of(calls, "root.add");
    assert.deepEqual([scroll[0], scroll[2]], ["scroll", true], "a scroll anywhere in the atlas, in the capture phase");
    assert.deepEqual(of(calls, "window.add").map(([type]) => type), ["resize"]);
    assert.deepEqual(of(calls, "fonts.add").map(([type]) => type), ["loadingdone"]);
});

test("a page without a body yet, or without font events, is watched as far as it goes", context => {
    const { calls } = setup(context, { body: false, fonts: false });
    assert.deepEqual(of(calls, "mutations.observe").slice(1).map(([target]) => target), ["html"]);
    assert.deepEqual(of(calls, "fonts.add"), []);
});

test("stopping lets go of everything it listened to, cancels a test still queued and unmarks the button", context => {
    const s = setup(context);
    s.hover.setPointer({ x: 1, y: 2 });
    s.frame();
    assert.deepEqual(of(s.calls, "button.set"), [["data-vr-hover", ""]]);
    s.hover.setPointer({ x: 3, y: 4 });
    const [queued] = s.frames.keys();
    s.hover.dispose();
    assert.deepEqual(of(s.calls, "cancelFrame"), [[queued]]);
    assert.deepEqual(of(s.calls, "button.remove"), [["data-vr-hover"]]);
    assert.deepEqual(of(s.calls, "mutations.disconnect").length + of(s.calls, "resize.disconnect").length, 2);
    // Each listener is removed as it was added, with its phase.
    for (const target of ["root", "window", "fonts"]) assert.deepEqual(of(s.calls, `${target}.remove`), of(s.calls, `${target}.add`), target);
});
