import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import { flush } from "../../../../../../logics/test/bridgeHarness.ts";
import * as view from "../../../../../../logics/configs/steamVrAutoLaunch.ts";

// The VR page's "Start with SteamVR" row (#1384): asked each time the settings open, drawn from the
// core's last answer, and not drawn in a build SteamVR cannot start.

async function setup(context: TestContext, answer: unknown, open = true, supported = true) {
    const runtime = hooks(), asked: string[] = [], toggled: string[] = [];
    // Whether the settings are open; a test opens and closes them between renders.
    const page = { open };
    const { SteamVrAutoLaunch } = await loadModule<typeof import("./SteamVrAutoLaunch.tsx")>(new URL("./SteamVrAutoLaunch.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key }) },
        "@logics_configs": { useVr: () => ({
            currentSteamVrAutoLaunchSupported: { state: "ok", data: supported },
            currentSteamVrAutoLaunch: { state: "ok", data: answer },
            getSteamVrAutoLaunch: () => asked.push("get"),
            toggleSteamVrAutoLaunch: () => toggled.push("toggle"),
        }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: page.open } }) },
        "../_components": { SectionLabelComponent: "section" },
        "../_templates/Templates": { SwitchContainer: "switch" },
        "../../../../../common_components/stable_words/StableWords": { StableWords: "stable-words" },
        "../../../../../../logics/configs/steamVrAutoLaunch.ts": view,
    });
    context.onTestFinished(() => runtime.unmount());
    const draw = () => runtime.render(SteamVrAutoLaunch, {});
    const tree = draw();
    await flush();
    return { tree, asked, toggled, page, draw };
}

test("the row asks SteamVR when the settings open and shows SteamVR's flag under its own heading", async context => {
    const s = await setup(context, { available: true, enabled: true });
    assert.deepEqual(s.asked, ["get"]);
    assert.ok(s.tree);
    const [heading, row] = s.tree.props.children;
    assert.deepEqual([heading.type, heading.props.label], ["section", "config_page.vr.section_label_steamvr"]);
    assert.deepEqual([row.type, row.props.setting_id, row.props.label, row.props.desc],
        ["switch", "steamvr_auto_launch", "config_page.vr.steamvr_auto_launch.label", "config_page.vr.steamvr_auto_launch.desc"]);
    // The note keeps room for its longest line even while it says nothing (#912).
    assert.deepEqual([row.props.note.type, row.props.note.props.current, row.props.note.props.align], ["stable-words", "", "start"]);
    assert.deepEqual(row.props.note.props.words, [...view.STEAMVR_NOTES]);
    assert.deepEqual([row.props.variable, row.props.is_available], [{ state: "ok", data: true }, true]);
    row.props.toggleFunction();
    assert.deepEqual(s.toggled, ["toggle"]);
});

test("without SteamVR the switch cannot be pressed and says how to change it", async context => {
    const s = await setup(context, { available: false, reason: "steamvr_not_running", enabled: null });
    assert.ok(s.tree);
    const row = s.tree.props.children[1];
    assert.deepEqual([row.props.is_available, row.props.note.props.current, row.props.variable.data],
        [false, "config_page.vr.steamvr_auto_launch.steamvr_not_running", false]);
});

test("a build SteamVR cannot start draws nothing and asks nothing, and a closed settings page asks nothing", async context => {
    const unsupported = await setup(context, null, true, false);
    assert.equal(unsupported.tree, null);
    assert.deepEqual(unsupported.asked, []);
    const closed = await setup(context, null, false);
    assert.deepEqual(closed.asked, []);
});

test("the row asks SteamVR again each time the settings open, as SteamVR's own settings may have changed it", async context => {
    const s = await setup(context, { available: true, enabled: false }, false);
    s.page.open = true;
    s.draw(); await flush();
    assert.deepEqual(s.asked, ["get"]);
    s.page.open = false;
    s.draw(); await flush();
    s.page.open = true;
    s.draw(); await flush();
    assert.deepEqual(s.asked, ["get", "get"]);
});
