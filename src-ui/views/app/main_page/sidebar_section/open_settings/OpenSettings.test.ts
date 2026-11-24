import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn, kitStandIns } from "../../../../../logics/test/hookHarness.ts";

// The foot of the rail: the kit's icon Button that opens settings, named and with its name as the
// tooltip beside the rail.
test("the rail's settings button is the kit's icon button, named, and opens settings", async () => {
    const runtime = hooks(), opened: boolean[] = [];
    const { OpenSettings } = await loadModule<typeof import("./OpenSettings.tsx")>(new URL("./OpenSettings.tsx", import.meta.url), runtime, {
        "@logics_common": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: (open: boolean) => opened.push(open) }) },
    });
    const tree = runtime.render(OpenSettings);
    const tip = findIn(tree, node => node.type === "tooltip");
    assert.deepEqual([tip.props.title, tip.props.placement], ["studio.open_settings", "right"]);
    const button = findIn(tree, node => node.type === kitStandIns.Button);
    assert.deepEqual([button.props.size, button.props["aria-label"], button.props["data-open-settings"]], ["icon", "studio.open_settings", true]);
    button.props.onClick();
    assert.deepEqual(opened, [true]);
});
