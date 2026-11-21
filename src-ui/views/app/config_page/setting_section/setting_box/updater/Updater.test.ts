import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import * as appUpdateLogic from "../../../../../../logics/common/appUpdate.ts";
import type { AppUpdateState } from "../../../../../../logics/common/appUpdate.ts";

// #614: the update page shows its general words as hints. How a copy that updates here is updated
// is the heading's hint; why a copy cannot update here, and whom the app asks at each start, stay
// on screen.
async function page(info: AppUpdateState["info"]) {
    const runtime = hooks();
    const appUpdate: AppUpdateState = { ...appUpdateLogic.INITIAL_APP_UPDATE, info };
    const { Updater } = await loadModule<typeof import("./Updater.tsx")>(new URL("./Updater.tsx", import.meta.url), runtime, {
        "@logics_common": { useSoftwareVersion: () => ({ currentSoftwareVersion: { data: "0.6.0" } }), useNotificationStatus: () => ({ showNotification_Error() {} }) },
        "@logics_configs": { useOthers: () => ({ currentEnableCheckSoftwareUpdates: { state: "ok", data: true }, toggleEnableCheckSoftwareUpdates() {} }),
            useExperimentalFeatures: () => ({ currentReleaseChannel: { state: "ok", data: "stable" } }) },
        "../../../../../../logics/common/useAppUpdate": { useAppUpdate: () => ({ appUpdate, loadAppUpdateInfo() {}, checkAppUpdate() {}, installAppUpdate: async () => null }) },
        "../../../../../../logics/common/appUpdate.ts": appUpdateLogic,
        "../_components": { SectionLabelComponent: "heading" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/_atoms/_open_webpage_button/_OpenWebpageButton": { _OpenWebpageButton: "link" },
        "../_templates/Templates": { CheckboxContainer: "checkbox" },
    });
    const tree = runtime.render(Updater);
    const one = (type: string) => nodesIn(tree).filter(node => node.type === type);
    return { tree, heading: one("heading")[0], policies: one("p").filter(node => node.props.className === "policy"), checkbox: one("checkbox")[0] };
}
const info = (kind: string, mode: "install" | "manual" | "package_manager" | "disabled") =>
    ({ kind, mode, channel: "stable", current_version: "0.6.0", package_manager: null });

test("a copy that updates here says how in its heading's hint, with no paragraph before its buttons", async () => {
    const { tree, heading, policies } = await page(info("windows_installer", "install"));
    assert.equal(tree.type, "hints", "the page is inside HintDescriptions");
    assert.equal(heading.props.desc, "app_update.policy.install");
    assert.deepEqual(policies, []);
});

test("why a copy cannot update here stays on screen", async () => {
    for (const [kind, mode, policy] of [["windows_portable", "manual", "windows_portable"], ["linux_archive", "manual", "linux_archive"],
        ["appimage_read_only", "manual", "appimage_read_only"], ["deb", "package_manager", "package_manager"]] as const) {
        const { heading, policies } = await page(info(kind, mode));
        assert.equal(heading.props.desc, undefined, kind);
        assert.deepEqual(policies.map(node => node.props.children), [`app_update.policy.${policy}`], kind);
    }
});

test("that the app asks at each start stays on screen beside its checkbox; whom it asks is the hint", async () => {
    const { checkbox } = await page(info("windows_installer", "install"));
    assert.deepEqual([checkbox.props.lead, checkbox.props.desc, checkbox.props.keep_desc],
        ["app_update.check_at_start_lead", "app_update.check_at_start_desc", undefined]);
    // A copy that never checks has no such setting.
    assert.equal((await page(info("deb", "package_manager"))).checkbox, undefined);
});
