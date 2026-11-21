import assert from "node:assert/strict";
import { test } from "vitest";
import { find, hooks, loadModule } from "../../../../../../../logics/test/hookHarness.ts";

// #912: a readout whose mark comes and goes keeps the mark's place, so its words stay put.
test("a readout keeps the mark's place only when asked to", async () => {
    const runtime = hooks();
    const { EnvReadout } = await loadModule<typeof import("./EnvReadout.tsx")>(new URL("./EnvReadout.tsx", import.meta.url), runtime);
    const mark = (props: object) => find(runtime.render(EnvReadout, props), node => node.props?.className === "mark")?.props ?? null;
    assert.equal(mark({}), null);
    assert.deepEqual(mark({ reserveMark: true }), { className: "mark", "aria-hidden": "true" });
    // Its words wrap beside the kept place, not under it.
    assert.equal(runtime.render(EnvReadout, { reserveMark: true }).props.className, "readout neutral reserved");
    assert.equal(runtime.render(EnvReadout, {}).props.className, "readout neutral");
    // A mark in use is drawn in the same place, whether its place is kept or not, and no empty one beside it.
    for (const reserveMark of [false, true]) {
        const tree = runtime.render(EnvReadout, { progress: "working", reserveMark });
        assert.equal(find(tree, node => node.props?.state === "working")?.props.arrived, false);
        assert.equal(find(tree, node => node.props?.className === "mark"), null);
    }
    runtime.unmount();
});
