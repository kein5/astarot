import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, vi } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, stubGlobals, unchecked } from "../../logics/test/hookHarness.ts";
import type { HookRuntime } from "../../logics/test/hookHarness.ts";

// The kit's motion (#1378): how its surfaces come and go, on Motion's animate(), which a stand-in
// replaces here, and the dimming of a dialog on the element's own animate() (the Web Animations
// API). Each stand-in animation records what it was asked, and settles when the test says.
type MotionModule = typeof import("./motion.ts");
type Asked = { element: unknown; keyframes: Record<string, unknown>; options: Record<string, unknown> };

function fakeAnimate(log: string[] = []) {
    const asked: Asked[] = [], completed: number[] = [], stopped: number[] = [], settle: (() => void)[] = [];
    const record = (element: unknown, keyframes: Record<string, unknown>, options: Record<string, unknown>) => {
        const index = asked.push({ element, keyframes, options }) - 1;
        log.push(`animate ${String(options.pseudoElement ?? "element")}`);
        return { index, finished: new Promise<void>(resolve => { settle.push(resolve); }) };
    };
    // Motion's animate(): durations in seconds, an easing of four numbers.
    const animate = (element: unknown, keyframes: Record<string, unknown>, options: Record<string, unknown>) => {
        const { index, finished } = record(element, keyframes, options);
        return { finished, complete: () => { completed.push(index); }, stop: () => { stopped.push(index); } };
    };
    // A surface, whose own animate() moves its pseudo-elements: milliseconds and a CSS easing.
    const surface = (name: string) => unchecked<HTMLElement>({
        name,
        animate(keyframes: Record<string, unknown>, options: Record<string, unknown>) {
            const { index, finished } = record(this, keyframes, options);
            return { finished, finish: () => { completed.push(index); }, cancel: () => { stopped.push(index); } };
        },
    });
    return { animate, surface, asked, completed, stopped, settle };
}

// The user's or the system's wish for less motion, and an engine that can animate ::backdrop or not.
const world = (context: TestContext, { reduced = false, backdrop = true } = {}) => stubGlobals(context, {
    matchMedia: (query: string) => ({ matches: reduced && query === "(prefers-reduced-motion: reduce)" }),
    KeyframeEffect: backdrop ? class { get pseudoElement() { return null; } } : class {},
});

async function motion(runtime: HookRuntime = hooks(), log: string[] = []) {
    const fake = fakeAnimate(log);
    const module = await loadModule<MotionModule>(new URL("./motion.ts", import.meta.url), runtime, { "motion/mini": { animate: fake.animate } });
    return { module, ...fake, runtime, element: fake.surface("surface") };
}

const EASE = [0.2, 0, 0, 1];
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

test("the kit moves things with variables.css's motion tokens", async () => {
    const { module } = await motion();
    const css = readFileSync(new URL("../app/_index_css/variables.css", import.meta.url), "utf8");
    assert.match(css, /--vox_motion_fast: 120ms;/);
    assert.match(css, /--vox_motion: 220ms;/);
    assert.match(css, /--vox_ease: cubic-bezier\(\.2, 0, 0, 1\);/);
    assert.deepEqual([module.MOTION_FAST, module.MOTION, [...module.EASE]], [0.12, 0.22, EASE]);
});

test("a dialog fades in and rises into its place, its dimming fading in with it", async context => {
    world(context);
    const { module, asked, element } = await motion();
    module.appear(element, "dialog");
    assert.deepEqual(asked, [
        { element, keyframes: { opacity: [0, 1], translate: ["0 .8rem", "none"] },
            options: { duration: 0.12, ease: EASE, translate: { duration: 0.22, ease: EASE } } },
        // Held at its first value until it starts; the dialog's own dimming once it has.
        { element, keyframes: { opacity: [0, 1] }, options: { duration: 120, easing: EASING, pseudoElement: "::backdrop", fill: "backwards" } },
    ]);
    asked.length = 0;
    module.disappear(element, "dialog");
    assert.deepEqual(asked.map(({ keyframes, options }) => [keyframes, options.duration, options.pseudoElement, options.fill]), [
        [{ opacity: [1, 0], translate: ["none", "0 .8rem"] }, 0.12, undefined, undefined],
        [{ opacity: [1, 0] }, 120, "::backdrop", "forwards"],
    ], "it goes the way it came, quicker, and stays gone until the dialog closes");
});

test("an engine that cannot animate ::backdrop shows the dimming at once, as before", async context => {
    world(context, { backdrop: false });
    const { module, asked, element } = await motion();
    module.appear(element, "dialog");
    assert.deepEqual(asked.map(({ options }) => options.pseudoElement), [undefined]);
    // One without the Web Animations API's KeyframeEffect at all.
    stubGlobals(context, { KeyframeEffect: undefined });
    asked.length = 0;
    module.appear(element, "dialog");
    module.disappear(element, "dialog");
    assert.deepEqual(asked.map(({ options }) => options.pseudoElement), [undefined, undefined]);
});

test("a popover comes from its button and goes back toward it, on the side Radix placed it", async context => {
    world(context);
    const { module, asked, element } = await motion();
    const sides = { top: "0 .4rem", right: "-.4rem 0", bottom: "0 -.4rem", left: ".4rem 0" } as const;
    for (const [side, from] of Object.entries(sides)) {
        asked.length = 0;
        module.appear(element, "popover", unchecked<keyof typeof sides>(side));
        assert.deepEqual(asked, [{ element, keyframes: { opacity: [0, 1], translate: [from, "none"] },
            options: { duration: 0.12, ease: EASE, translate: { duration: 0.12, ease: EASE } } }], side);
        asked.length = 0;
        module.disappear(element, "popover", unchecked<keyof typeof sides>(side));
        assert.deepEqual(asked, [{ element, keyframes: { opacity: [1, 0], translate: ["none", from] }, options: { duration: 0.12, ease: EASE } }], side);
    }
    asked.length = 0;
    module.appear(element, "popover");
    assert.deepEqual(asked[0].keyframes.translate, ["0 -.4rem", "none"], "below its button unless told otherwise");
});

test("a window's page only fades in, over the longer time: the window is what appears", async context => {
    world(context);
    const { module, asked, element } = await motion();
    module.appear(element, "window");
    assert.deepEqual(asked, [{ element, keyframes: { opacity: [0, 1] }, options: { duration: 0.22, ease: EASE, translate: { duration: 0.12, ease: EASE } } }]);
});

test("with reduced motion nothing moves: the surfaces only fade", async context => {
    world(context, { reduced: true });
    const { module, asked, element } = await motion();
    assert.equal(module.prefersReducedMotion(), true);
    module.appear(element, "dialog");
    module.appear(element, "popover", "left");
    module.disappear(element, "popover", "left");
    module.disappear(element, "dialog");
    assert.deepEqual(asked.map(({ keyframes, options }) => [keyframes, options.pseudoElement]), [
        [{ opacity: [0, 1] }, undefined], [{ opacity: [0, 1] }, "::backdrop"],
        [{ opacity: [0, 1] }, undefined],
        [{ opacity: [1, 0] }, undefined],
        [{ opacity: [1, 0] }, undefined], [{ opacity: [1, 0] }, "::backdrop"],
    ]);
});

test("the wish for less motion is read each time, and an engine without matchMedia moves", async context => {
    let reduced = false;
    stubGlobals(context, { matchMedia: () => ({ matches: reduced }) });
    const { module } = await motion();
    assert.equal(module.prefersReducedMotion(), false);
    reduced = true;
    assert.equal(module.prefersReducedMotion(), true);
    stubGlobals(context, { matchMedia: undefined });
    assert.equal(module.prefersReducedMotion(), false);
});

test("a playback finishes, stops and settles everything it moves; an exit also settles at its time limit", async context => {
    world(context);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    context.onTestFinished(() => { vi.useRealTimers(); });
    const { module, completed, stopped, settle, element } = await motion();
    const entrance = module.appear(element, "dialog");
    entrance.finish();
    assert.deepEqual(completed, [0, 1]);
    entrance.stop();
    assert.deepEqual(stopped, [0, 1]);
    let settled = false;
    void entrance.finished.then(() => { settled = true; });
    settle[0]();
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(settled, false, "the dimming still fades, and an entrance has no time limit");
    settle[1]();
    await entrance.finished;
    assert.equal(settled, true);
    // An exit that the engine does not run (a window hidden in the tray draws no frames) settles
    // anyway, after its own time and a margin.
    const exit = module.disappear(element, "popover");
    let left = false;
    void exit.finished.then(() => { left = true; });
    await vi.advanceTimersByTimeAsync(319);
    assert.equal(left, false);
    await vi.advanceTimersByTimeAsync(1);
    await exit.finished;
    assert.equal(left, true);
    // One that ends in time leaves no timer behind.
    const quick = module.disappear(element, "popover");
    settle[settle.length - 1]();
    await quick.finished;
    assert.equal(vi.getTimerCount(), 0);
});

// A screen's surface: a <dialog> its own hook shows with showModal() in an effect, or a page drawn
// at once.
async function screen(context: TestContext, surface: "dialog" | "window") {
    world(context);
    const runtime = hooks(), log: string[] = [];
    const { module, asked, completed, surface: made } = await motion(runtime, log);
    // A <dialog> closed until its hook shows it, or a page (which has no open).
    const node = { open: false, animate: made("node").animate };
    // One drawing of the screen, as the harness runs it.
    const drawing = ({ shown }: { shown: boolean }) => {
        const ref = runtime.api.useRef(unchecked<HTMLElement>(node));
        // As useConsentDialog shows its dialog, in an effect called before the entrance.
        runtime.api.useEffect(() => {
            log.push("passive effect");
            if (shown) node.open = true;
        }, [shown]);
        module.useAppear(ref, shown, surface);
        return null;
    };
    context.onTestFinished(() => runtime.unmount());
    return { render: (shown: boolean) => runtime.render(drawing, { shown }), log, asked, completed, node };
}

test("a dialog a screen shows comes in once it is open, after the effect that showed it", async context => {
    const s = await screen(context, "dialog");
    s.render(false);
    assert.equal(s.asked.length, 0, "hidden: nothing plays");
    s.render(true);
    assert.deepEqual(s.log, ["passive effect", "passive effect", "animate element", "animate ::backdrop"]);
    assert.deepEqual(s.asked[0].keyframes, { opacity: [0, 1], translate: ["0 .8rem", "none"] });
    s.render(true);
    assert.equal(s.asked.length, 2, "drawn again, it does not come in again");
    s.render(false);
    assert.deepEqual(s.completed, [0, 1], "closed while it plays, it jumps to its end");
});

test("a dialog already open when it is to be shown comes in once", async context => {
    const s = await screen(context, "dialog");
    s.node.open = true;
    s.render(true);
    assert.deepEqual(s.log, ["passive effect", "animate element", "animate ::backdrop"], "after the effects, not also before them");
});

test("a dialog that did not open, or a surface not drawn, plays nothing", async context => {
    world(context);
    const runtime = hooks();
    const { module, asked } = await motion(runtime);
    const closed = { current: unchecked<HTMLElement>({ open: false }) };
    const missing = { current: null };
    runtime.render(() => {
        module.useAppear(closed, true, "dialog");
        module.useAppear(missing, true, "window");
    });
    assert.deepEqual(asked, []);
    runtime.unmount();
});

test("a page comes in before the first paint, ahead of the passive effects", async context => {
    const s = await screen(context, "window");
    s.render(false);
    s.render(true);
    assert.deepEqual(s.log, ["passive effect", "animate element", "passive effect"]);
    assert.deepEqual(s.asked[0].keyframes, { opacity: [0, 1] });
});

test("a surface the kit draws while it leaves: drawn while open and while it leaves, anew when opened again as it leaves", async () => {
    const runtime = hooks();
    const { module } = await motion(runtime);
    const presence = (open: boolean | null) => runtime.render(() => module.usePresence(open));
    const state = (open: boolean | null) => {
        const { managed, drawn, leaving, key } = presence(open);
        return { managed, drawn, leaving, key };
    };
    assert.deepEqual(state(false), { managed: true, drawn: false, leaving: false, key: 0 });
    assert.deepEqual(state(true), { managed: true, drawn: true, leaving: false, key: 0 });
    assert.deepEqual(state(false), { managed: true, drawn: true, leaving: true, key: 0 }, "it leaves");
    assert.deepEqual(state(false), { managed: true, drawn: true, leaving: true, key: 0 }, "and stays drawn until its exit ends");
    presence(false).left(0);
    assert.deepEqual(state(false), { managed: true, drawn: false, leaving: false, key: 0 });
    state(true);
    state(false);
    assert.deepEqual(state(true), { managed: true, drawn: true, leaving: false, key: 1 }, "opened again as it leaves: drawn anew");
    presence(true).left(0);
    assert.deepEqual(state(true), { managed: true, drawn: true, leaving: false, key: 1 }, "an exit that was cut short ends nothing");
    state(false);
    presence(false).left(0);
    assert.deepEqual(state(false), { managed: true, drawn: true, leaving: true, key: 1 }, "only the exit of the drawing in sight ends it");
    presence(false).left(1);
    assert.deepEqual(state(false), { managed: true, drawn: false, leaving: false, key: 1 });
    runtime.unmount();
    const unmanaged = hooks();
    const { module: own } = await motion(unmanaged);
    const { managed, drawn, leaving } = unmanaged.render(() => own.usePresence(null));
    assert.deepEqual({ managed, drawn, leaving }, { managed: false, drawn: true, leaving: false }, "a Radix root of its own: Radix decides");
});
