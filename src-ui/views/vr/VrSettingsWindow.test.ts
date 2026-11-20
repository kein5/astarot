import assert from "node:assert/strict";
import { test } from "vitest";
import { draw, findIn, componentName, hooks, loadModule, nodesIn } from "../../logics/test/hookHarness.ts";

// #614: a row of the VR settings carries a note only when the note says what its name does not.
// "Show only when looking at the wrist" needs none. The hand the launcher is on says which hand
// presses it, and the tooltips' switch says what a tooltip is: no tooltip could say that.

// Settings as the window reads them: every current value is there, every action does nothing.
const settings = () => new Proxy({}, { get: (_, key) => String(key).startsWith("current") ? { state: "ok", data: null } : () => {} });

test("the launcher's rows: the wrist switch has no note; the hand and the tooltips keep theirs", async () => {
    const runtime = hooks();
    const { VrSettingsWindow } = await loadModule<typeof import("./VrSettingsWindow.tsx")>(new URL("./VrSettingsWindow.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "../../logics/common/languageNames.ts": { createLanguageNames: () => ({}) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: true } }), useIsOscAvailable: settings, useVolume: settings },
        "@logics_configs": { useAppearance: settings, useDevice: settings, useOcr: settings, useOthers: settings, useTranscription: settings, useTranslation: settings, useVr: settings },
        "@store": { useStore_MicVolume: settings, useStore_SelectableFontFamilyList: settings, useStore_SpeakerVolume: settings },
        "@ui_configs": { ui_configs: {} },
        "./VrWindow": { VrWindow: "window" },
        "./VrSettingsRows": { Disclosure: "disclosure", Picker: "picker", SectionLabel: "section-label", SegmentRow: "segment-row",
            SelectRow: "select-row", StepperRow: "stepper-row", ThresholdRow: "threshold-row", ToggleRow: "toggle-row" },
        "../app/config_page/setting_section/setting_box/_components/compute_device/computeDeviceOptions": { buildComputeDeviceOptions: () => [] },
        "../../logics/configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "../../logics/configs/ctranslate2License": { isNonCommercialWeight: () => false },
        "../../logics/common/featureLabel.ts": { splitFeatureLabel: (text: string) => ({ name: text, abbr: "" }) },
    });
    const page = runtime.render(VrSettingsWindow, { onClose() {} });
    // The category the window draws, asked for the VR page; then that page, down to its rows.
    const category = findIn(page, node => componentName(node) === "Category", "the category");
    const rows = nodesIn(draw(draw(category, { ...category.props, id: "vr" })));
    const launcher = rows.slice(rows.findIndex(node => node.type === "section-label" && node.props.label === "vr_panel.launcher") + 1);
    assert.deepEqual(launcher.map(row => [row.type, row.props.label, row.props.sub]), [
        ["segment-row", "vr_panel.launcher_hand", "vr_panel.launcher_hand_desc"],
        ["toggle-row", "vr_panel.launcher_auto_hide", undefined],
        ["toggle-row", "vr_panel.tooltip_enabled", "vr_panel.tooltip_enabled_desc"],
    ]);
});
