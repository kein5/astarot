import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, kitStandIns } from "../../../../../../../../logics/test/hookHarness.ts";
import type { VolumeCheckButtonProps } from "./VolumeCheckButton.tsx";

async function volumeCheck() {
    const runtime = hooks(), calls: string[] = [];
    const { VolumeCheckButton } = await loadModule<typeof import("./VolumeCheckButton.tsx")>(new URL("./VolumeCheckButton.tsx", import.meta.url), runtime);
    const props: VolumeCheckButtonProps = { isChecking: { state: "ok", data: false }, SvgComponent: () => null,
        startFunction: () => calls.push("start"), stopFunction: () => calls.push("stop") };
    const toggle = () => {
        const node = find(runtime.render(VolumeCheckButton.type, props), node => node.type === kitStandIns.Toggle);
        assert.ok(node);
        return node;
    };
    return { calls, props, toggle, VolumeCheckButton };
}

test("the volume check is the kit's Toggle at the compact size, pressed while the check runs", async () => {
    const { calls, props, toggle, VolumeCheckButton } = await volumeCheck();
    assert.equal(VolumeCheckButton.displayName, "VolumeCheckButton", "named for React's tools, as memo would leave it unnamed");
    assert.deepEqual([toggle().props.tone, toggle().props.size, toggle().props.pressed, toggle().props["aria-disabled"]], [undefined, "compact", false, false]);
    assert.ok(find(toggle(), node => node.type === "span" && node.props.children === "config_page.device.check_volume"), "named by its words");
    toggle().props.onPressedChange(true);
    assert.deepEqual(calls, ["start"]);
    props.isChecking = { state: "ok", data: true };
    assert.equal(toggle().props.pressed, true);
    toggle().props.onPressedChange(false);
    assert.deepEqual(calls, ["start", "stop"]);
    // Neither started nor stopped yet: a press does nothing.
    props.isChecking = { state: "ok", data: undefined };
    assert.equal(toggle().props.pressed, false);
    toggle().props.onPressedChange(true);
    assert.deepEqual(calls, ["start", "stop"]);
});

test("holding Enter or Space toggles the volume check once, and a pending check ignores presses", async () => {
    const { calls, props, toggle } = await volumeCheck();
    const press = (key: string, repeat = false) => {
        let prevented = false;
        toggle().props.onKeyDown({ key, repeat, preventDefault() { prevented = true; } });
        return prevented;
    };

    assert.equal(press("Enter"), true, "the key's own press of the button is held back");
    for (let i = 0; i < 5; i++) press("Enter", true);
    assert.deepEqual(calls, ["start"]);
    assert.equal(press("Tab"), false);
    assert.deepEqual(calls, ["start"]);

    props.isChecking = { state: "pending", data: false };
    assert.equal(toggle().props["aria-disabled"], true);
    press("Enter");
    toggle().props.onPressedChange(true);
    assert.deepEqual(calls, ["start"]);

    props.isChecking = { state: "ok", data: true };
    assert.equal(toggle().props["aria-disabled"], false);
    press(" ");
    for (let i = 0; i < 5; i++) press(" ", true);
    assert.deepEqual(calls, ["start", "stop"]);
});
