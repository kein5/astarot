import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, eventTarget, unchecked } from "../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../logics/test/hookHarness.ts";
import type { SliderProps } from "./Slider.tsx";

const pointer = (x: number, y = 0) => ({ button: 0, clientX: x, clientY: y, preventDefault() {} });
const key = (name: string) => ({ key: name, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
const track = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };

// The node a test reads: one that is missing fails the test where it is read.
const found = (node: TreeNode | null) => { assert.ok(node); return node; };
// The element's ref object, which React 18's element type leaves out. Setting current on a node
// with no ref stops with a TypeError, as `node.ref.current = ...` did.
const setRef = (node: TreeNode, value: unknown) => {
    const ref: unknown = Reflect.get(node, "ref");
    if (typeof ref !== "object" || ref === null) throw new TypeError("The element has no ref object");
    Reflect.set(ref, "current", value);
};

async function slider(t: TestContext, props: Partial<SliderProps>) {
    const runtime = hooks(), window = eventTarget(), changed: number[] = [];
    Reflect.set(globalThis, "window", window);
    t.onTestFinished(() => { runtime.unmount(); Reflect.deleteProperty(globalThis, "window"); });
    const { Slider } = await loadModule<typeof import("./Slider.tsx")>(new URL("./Slider.tsx", import.meta.url), runtime, {
        "@logics_configs": { useSliderLogic: () => ({ ui_value: 50,
            onChangeFunction: (next: number) => changed.push(next), onChangeCommittedFunction: () => {} }) },
    });
    // Test data: the slider reads only these props here; the slider logic above stands in for the
    // value and the setter.
    const render = () => runtime.render(Slider, unchecked<SliderProps>({ min: 0, max: 100, step: 1, ...props }), tree => {
        setRef(found(find(tree, node => node.props?.onPointerDown)), track);
    });
    return { render, window, changed };
}

const parts = (tree: TreeNode) => ({
    root: found(find(tree, node => node.props?.onPointerDown)),
    thumb: found(find(tree, node => node.props?.role === "slider")),
});

// shadcn/ui's Slider is Radix's: a disabled one is drawn half as strong (data-disabled), leaves
// the tab order, says it is disabled, and neither the pointer nor the keys move it.
test("a disabled slider says so, leaves the tab order and does not move", async t => {
    const { render, window, changed } = await slider(t, { disabled: true });
    const { root, thumb } = parts(render());
    assert.equal(root.props["data-disabled"], "");
    assert.equal(thumb.props.tabIndex, undefined);
    assert.equal(thumb.props["aria-disabled"], true);
    root.props.onPointerDown(pointer(80));
    render();
    assert.deepEqual(window.added, [], "no drag starts");
    const right = key("ArrowRight");
    thumb.props.onKeyDown(right);
    assert.equal(right.defaultPrevented, false);
    assert.deepEqual(changed, []);
});

test("a slider that can be used is in the tab order and moves", async t => {
    const { render, changed } = await slider(t, {});
    const { root, thumb } = parts(render());
    assert.equal(root.props["data-disabled"], undefined);
    assert.equal(thumb.props.tabIndex, 0);
    assert.equal(thumb.props["aria-disabled"], undefined);
    thumb.props.onKeyDown(key("ArrowRight"));
    assert.deepEqual(changed, [51]);
});
