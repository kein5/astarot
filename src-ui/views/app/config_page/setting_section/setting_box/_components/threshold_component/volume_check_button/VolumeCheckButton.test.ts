import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../../../logics/test/hookHarness.ts";
import type { VolumeCheckButtonProps } from "./VolumeCheckButton.tsx";

test("holding Enter or Space toggles the volume check once, and a pending check ignores presses", async () => {
    const runtime = hooks(), calls: string[] = [];
    const { VolumeCheckButton } = await loadModule<typeof import("./VolumeCheckButton.tsx")>(new URL("./VolumeCheckButton.tsx", import.meta.url), runtime);
    const props: VolumeCheckButtonProps = { isChecking: { state: "ok", data: false }, SvgComponent: () => null,
        startFunction: () => calls.push("start"), stopFunction: () => calls.push("stop") };
    const button = () => {
        const node = find(runtime.render(VolumeCheckButton.type, props), node => node.props?.role === "button");
        assert.ok(node);
        return node;
    };
    const press = (key: string, repeat = false) => button().props.onKeyDown({ key, repeat, preventDefault() {} });

    press("Enter");
    for (let i = 0; i < 5; i++) press("Enter", true);
    assert.deepEqual(calls, ["start"]);

    props.isChecking = { state: "pending", data: false };
    assert.equal(button().props["aria-disabled"], true);
    press("Enter");
    button().props.onClick();
    assert.deepEqual(calls, ["start"]);

    props.isChecking = { state: "ok", data: true };
    assert.equal(button().props["aria-disabled"], false);
    press(" ");
    for (let i = 0; i < 5; i++) press(" ", true);
    assert.deepEqual(calls, ["start", "stop"]);
});
