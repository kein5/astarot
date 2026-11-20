import assert from "node:assert/strict";
import { test } from "vitest";
import { readFile } from "node:fs/promises";
import { draw, findIn, componentName, hooks, loadModule, nodesIn } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";

// #614: a row of the VR settings carries a note only when the note says what its name does not.
// "Show only when looking at the wrist" needs none. The hand the launcher is on is drawn on each
// choice as the toolbar draws a hand, and a fold says the values in use. The tooltips' switch says
// what a tooltip is: no tooltip could say that.

// Settings as the window reads them: every current value is there (the ones given, or nothing),
// every action does nothing.
const settings = (values: Record<string, { state: string; data: unknown }> = {}) => () => new Proxy({}, {
    get: (_, key) => String(key) in values ? values[String(key)] : String(key).startsWith("current") ? { state: "ok", data: null } : () => {} });

// The rows of one page of the VR settings (the templates, kept as names).
async function page(id: string, transcription: Record<string, { state: string; data: unknown }> = {}): Promise<TreeNode[]> {
    const runtime = hooks();
    const { VrSettingsWindow } = await loadModule<typeof import("./VrSettingsWindow.tsx")>(new URL("./VrSettingsWindow.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, variables?: object) => variables ? `${key} ${JSON.stringify(variables)}` : key, i18n: { language: "en" } }) },
        "../../logics/common/languageNames.ts": { createLanguageNames: () => ({}) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: true } }), useIsOscAvailable: settings(), useVolume: settings() },
        "@logics_configs": { useAppearance: settings(), useDevice: settings(), useOcr: settings(), useOthers: settings(),
            useTranscription: settings(transcription), useTranslation: settings(), useVr: settings() },
        "@store": { useStore_MicVolume: settings(), useStore_SelectableFontFamilyList: settings(), useStore_SpeakerVolume: settings() },
        "@ui_configs": { ui_configs: {} },
        "./VrWindow": { VrWindow: "window" },
        "./VrHandIcon": { VrHandIcon: "hand" },
        "./VrSettingsRows": { Disclosure: "disclosure", Picker: "picker", SectionLabel: "section-label", SegmentRow: "segment-row",
            SelectRow: "select-row", StepperRow: "stepper-row", ThresholdRow: "threshold-row", ToggleRow: "toggle-row" },
        "../app/config_page/setting_section/setting_box/_components/compute_device/computeDeviceOptions": { buildComputeDeviceOptions: () => [] },
        "../../logics/configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "../../logics/configs/ctranslate2License": { isNonCommercialWeight: () => false },
        "../../logics/common/featureLabel.ts": { splitFeatureLabel: (text: string) => ({ name: text, abbr: "" }) },
    });
    const window = runtime.render(VrSettingsWindow, { onClose() {} });
    // The category the window draws, asked for this page; then that page, down to its rows.
    const category = findIn(window, node => componentName(node) === "Category", "the category");
    return nodesIn(draw(draw(category, { ...category.props, id })));
}

test("the launcher's rows: only the tooltips' switch has a note; each hand is drawn on its choice", async () => {
    const rows = await page("vr");
    const launcher = rows.slice(rows.findIndex(node => node.type === "section-label" && node.props.label === "vr_panel.launcher") + 1)
        .filter(row => row.type !== "hand");
    assert.deepEqual(launcher.map(row => [row.type, row.props.label, row.props.sub]), [
        ["segment-row", "vr_panel.launcher_hand", undefined],
        ["toggle-row", "vr_panel.launcher_auto_hide", undefined],
        ["toggle-row", "vr_panel.tooltip_enabled", "vr_panel.tooltip_enabled_desc"],
    ]);
    // The left hand and its mirror image, before the names, which stay.
    const options: { id: string; label: string; icon: TreeNode }[] = launcher[0].props.options;
    assert.deepEqual(options.map(option => [option.id, option.label, option.icon.type, option.icon.props.right === true]), [
        ["LeftHand", "vr_panel.anchor_left_hand", "hand", false],
        ["RightHand", "vr_panel.anchor_right_hand", "hand", true],
    ]);
});

test("the hand of the launcher's choice is the toolbar's hand, mirrored for the right", async () => {
    const { VrHandIcon, HAND_PATH } = await loadModule<typeof import("./VrHandIcon.tsx")>(new URL("./VrHandIcon.tsx", import.meta.url), hooks());
    const left = VrHandIcon({}), right = VrHandIcon({ right: true });
    assert.deepEqual([left.props.style, right.props.style], [undefined, { transform: "scaleX(-1)" }]);
    assert.ok([left, right].every(icon => icon.props["aria-hidden"] === "true" && icon.props.children.props.d === HAND_PATH));
    // The toolbar draws its hand anchors from the same path.
    const toolbar = await readFile(new URL("./VrToolbar.tsx", import.meta.url), "utf8");
    assert.match(toolbar, /import \{ HAND_PATH \} from "\.\/VrHandIcon";/);
    assert.match(toolbar, /hand: HAND_PATH,/);
});

test("the speaker's fold says the values in use, and that a change is on its way", async () => {
    const ok = (data: unknown) => ({ state: "ok", data });
    const values = { currentSpeakerRecordTimeout: ok(3), currentSpeakerPhraseTimeout: ok(5), currentSpeakerMaxWords: ok(10) };
    const fold = (rows: TreeNode[]) => rows.find(row => row.type === "disclosure" && row.props.label === "config_page.transcription.section_label_speaker");
    const settled = fold(await page("transcription", values));
    assert.ok(settled);
    assert.equal(settled.props.summary, 'vr_panel.settings.speaker_values {"record":3,"phrase":5,"max":10}');
    assert.equal(settled.props.is_pending, false);
    const changing = fold(await page("transcription", { ...values, currentSpeakerPhraseTimeout: { state: "pending", data: 6 } }));
    assert.equal(changing?.props.is_pending, true);
});
