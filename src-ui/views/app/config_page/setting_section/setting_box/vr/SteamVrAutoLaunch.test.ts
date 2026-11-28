import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import { flush } from "../../../../../../logics/test/bridgeHarness.ts";
import * as view from "../../../../../../logics/configs/steamVrAutoLaunch.ts";

// The VR page's "Start with SteamVR" row (#1384): asked each time the settings open, drawn from the
// core's last answer, and not drawn in a build SteamVR cannot start.

async function setup(context: TestContext, answer: unknown, open = true) {
    const runtime = hooks(), asked: string[] = [], toggled: string[] = [];
    const { SteamVrAutoLaunch } = await loadModule<typeof import("./SteamVrAutoLaunch.tsx")>(new URL("./SteamVrAutoLaunch.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@logics_configs": { useVr: () => ({
            currentSteamVrAutoLaunch: { state: "ok", data: answer },
            getSteamVrAutoLaunch: () => asked.push("get"),
            toggleSteamVrAutoLaunch: () => toggled.push("toggle"),
        }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: open } }) },
        "../_components": { SectionLabelComponent: "section" },
        "../_templates/Templates": { SwitchContainer: "switch" },
        "../../../../../../logics/configs/steamVrAutoLaunch.ts": view,
    });
    context.onTestFinished(() => runtime.unmount());
    const tree = runtime.render(SteamVrAutoLaunch, {});
    await flush();
    return { tree, asked, toggled };
}

test("the row asks SteamVR when the settings open and shows SteamVR's flag under its own heading", async context => {
    const s = await setup(context, { available: true, enabled: true });
    assert.deepEqual(s.asked, ["get"]);
    assert.ok(s.tree);
    const [heading, row] = s.tree.props.children;
    assert.deepEqual([heading.type, heading.props.label], ["section", "config_page.vr.section_label_steamvr"]);
    assert.deepEqual([row.type, row.props.setting_id, row.props.label, row.props.desc, row.props.note],
        ["switch", "steamvr_auto_launch", "config_page.vr.steamvr_auto_launch.label", "config_page.vr.steamvr_auto_launch.desc", undefined]);
    assert.deepEqual([row.props.variable, row.props.is_available], [{ state: "ok", data: true }, true]);
    row.props.toggleFunction();
    assert.deepEqual(s.toggled, ["toggle"]);
});

test("without SteamVR the switch cannot be pressed and says how to change it", async context => {
    const s = await setup(context, { available: false, reason: "steamvr_not_running", enabled: null });
    assert.ok(s.tree);
    const row = s.tree.props.children[1];
    assert.deepEqual([row.props.is_available, row.props.note, row.props.variable.data],
        [false, "config_page.vr.steamvr_auto_launch.steamvr_not_running", false]);
});

test("a build SteamVR cannot start draws nothing, and a closed settings page asks nothing", async context => {
    const unsupported = await setup(context, { available: false, reason: "unsupported", enabled: null });
    assert.equal(unsupported.tree, null);
    const closed = await setup(context, null, false);
    assert.deepEqual(closed.asked, []);
});
