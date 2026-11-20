import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { eventTarget, stubGlobals, unchecked } from "../../logics/test/hookHarness.ts";
import { trackVrPointerHover } from "./vrPanelHover.ts";
import type { VrPointerHover } from "./vrPanelHover.ts";

type Listener = (event: unknown) => unknown;
// What the tracker asks an observer to watch for: MutationObserver's options; ResizeObserver gets none.
type ObserveOptions = { subtree?: boolean; childList?: boolean; attributes?: boolean; attributeFilter?: string[] };
// A button under the pointer, as the tracker reads it.
interface FakeButton {
    inert?: boolean;
    closest(selector: string): FakeButton | null;
    setAttribute: (...args: unknown[]) => number;
    removeAttribute: (...args: unknown[]) => number;
}

function setup(context: TestContext) {
    let hover: VrPointerHover | undefined;
    context.onTestFinished(() => hover?.dispose());
    const frames = new Map<number, () => void>(), observers: Observer[] = [], hits: [number, number][] = [], writes: unknown[][] = [];
    let sequence = 0, hit: FakeButton | null = null;
    const target = eventTarget();
    const root = { ...target,
        // The tracker listens with a capture flag, which the fake event target leaves out.
        addEventListener: (type: string, fn: Listener, _capture?: boolean) => target.addEventListener(type, fn),
        contains: (node: { outside?: boolean }) => !node.outside, querySelectorAll: () => ["panel", "popup"] };
    const listen = vi.spyOn(root, "addEventListener");
    const window = eventTarget(), fonts = eventTarget();
    const document = { fonts, documentElement: {}, body: {}, elementFromPoint: (x: number, y: number) => { hits.push([x, y]); return hit; } };
    class Observer {
        callback: () => void;
        observed: [unknown, ObserveOptions?][] = [];
        disconnected?: boolean;
        constructor(callback: () => void) { this.callback = callback; observers.push(this); }
        observe(...args: [unknown, ObserveOptions?]) { this.observed.push(args); }
        disconnect() { this.disconnected = true; }
    }
    stubGlobals(context, { window, document, MutationObserver: Observer, ResizeObserver: Observer,
        requestAnimationFrame: (fn: () => void) => { frames.set(++sequence, fn); return sequence; },
        cancelAnimationFrame: (id: number) => frames.delete(id),
    });
    // Test data: the root holds only what the tracker uses of an element.
    hover = trackVrPointerHover(unchecked<HTMLElement>(root));
    const button = (name: string): FakeButton => ({
        closest(selector) { return selector === "[inert]" ? (this.inert ? this : null) : this; },
        setAttribute: (...args) => writes.push([name, "set", ...args]),
        removeAttribute: (...args) => writes.push([name, "remove", ...args]),
    });
    return { hover, root, listen, window, fonts, frames, observers, hits, writes, button,
        setHit: (value: FakeButton) => { hit = value; },
        frame: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    };
}

test("scroll under a stationary pointer re-hit-tests once per frame, with no unchanged-target writes", context => {
    const s = setup(context), first = s.button("first"), second = s.button("second");
    assert.equal(s.listen.mock.calls[0][2], true);
    s.setHit(first);
    for (let i = 0; i < 100; i++) s.hover.setPointer({ x: 10, y: 20 });
    assert.equal(s.frames.size, 1);
    s.frame();
    assert.deepEqual(s.hits, [[10, 20]]);
    assert.equal(s.writes.length, 1);
    for (let i = 0; i < 100; i++) s.root.dispatch("scroll");
    s.frame();
    assert.equal(s.hits.length, 2);
    assert.equal(s.writes.length, 1);
    s.setHit(second);
    for (let i = 0; i < 100; i++) s.root.dispatch("scroll");
    s.frame();
    assert.equal(s.hits.length, 3);
    assert.deepEqual(s.writes.slice(1), [["first", "remove", "data-vr-hover"], ["second", "set", "data-vr-hover", ""]]);
    assert.equal(s.frames.size, 0);
});

test("view, layout, font and window changes share the scroll frame and use the latest coordinates", context => {
    const s = setup(context);
    s.setHit(s.button("picker"));
    s.hover.setPointer({ x: 1, y: 2 });
    s.hover.setPointer({ x: 3, y: 4 });
    s.observers.forEach(observer => observer.callback());
    s.window.dispatch("resize");
    s.fonts.dispatch("loadingdone");
    s.root.dispatch("scroll");
    assert.equal(s.frames.size, 1);
    s.frame();
    assert.deepEqual(s.hits, [[3, 4]]);
    const mutations = s.observers[0].observed[0][1];
    assert.ok(mutations);
    assert.equal(mutations.subtree, true);
    assert.equal(mutations.childList, true);
    assert.equal(mutations.attributeFilter?.includes("data-vr-hover"), false);
    assert.equal(s.observers[0].observed.length, 3); // Atlas plus inherited html/body styles.
    assert.equal(s.observers[1].observed.length, 3);
});

test("null pointer and teardown cancel queued tests and clear hover; inert targets stay clear", context => {
    const s = setup(context), button = s.button("button");
    s.setHit(button);
    s.hover.setPointer({ x: 1, y: 2 });
    s.frame();
    s.root.dispatch("scroll");
    s.hover.setPointer(null);
    assert.equal(s.frames.size, 0);
    assert.equal(s.writes.at(-1)?.[1], "remove");
    s.root.dispatch("scroll");
    assert.equal(s.frames.size, 0);
    button.inert = true;
    s.hover.setPointer({ x: 1, y: 2 });
    s.frame();
    assert.equal(s.writes.length, 2);
    s.root.dispatch("scroll");
    s.hover.dispose();
    s.hover.setPointer({ x: 3, y: 4 }); // A late Tauri callback cannot revive it.
    s.root.dispatch("scroll");
    s.frame();
    assert.equal(s.hits.length, 2);
    assert.ok(s.observers.every(observer => observer.disconnected));
    assert.equal(s.root.removed.length, 1);
});
