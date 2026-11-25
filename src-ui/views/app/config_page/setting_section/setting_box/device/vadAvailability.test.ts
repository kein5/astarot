import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, findIn, draw } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import { readLocale, localeAt } from "../../../../../../logics/test/locales.ts";

// #391: without a VAD engine the VAD option says why it cannot be chosen, and a VAD switch
// saved by an earlier version shows the volume mode that applies instead.
const RadioButton = () => null, ThresholdComponent = () => null;


const render = async (device: Record<string, unknown>) => {
    const runtime = hooks();
    const toggled: string[] = [];
    const module = await loadModule<typeof import("./Device.tsx")>(new URL("./Device.tsx", import.meta.url), runtime, {
        "./VoiceRouteSettings": { VoiceRouteSettings: () => null },
        "../shared_items/SharedItems": { VrcMicMuteSyncContainer: () => null },
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        "@ui_configs": { ui_configs: {} },
        "@logics_configs": { useDevice: () => ({
            currentEnableAutoMicSelect: { data: true }, currentEnableAutoSpeakerSelect: { data: true },
            currentMicDeviceOptions: { data: [] }, currentMicHostList: { data: [] }, currentSpeakerDeviceOptions: { data: [] },
            currentSelectedMicHost: { data: "" }, currentSelectedMicDeviceId: { data: "" }, currentSelectedSpeakerDeviceId: { data: "" },
            currentEnableAutomaticMicThreshold: { data: true, state: "ok" },
            currentEnableAutomaticSpeakerThreshold: { data: false, state: "ok" },
            toggleMicVadFilter: () => toggled.push("mic_vad"), toggleSpeakerVadFilter: () => toggled.push("speaker_vad"),
            toggleEnableAutomaticMicThreshold: () => toggled.push("mic_auto"),
            toggleEnableAutomaticSpeakerThreshold: () => toggled.push("speaker_auto"),
            ...device,
        }) },
        "../_templates/Templates": { MultiDropdownMenuContainer: () => null },
        "../_components": { SectionLabelComponent: () => null, LabelComponent: () => null, DropdownMenu: () => null,
            ThresholdComponent, RadioButton, SettingSwitch: () => null },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: () => null },
        "../_components/page_pointer/PagePointer": { PagePointer: () => null },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    // The page keeps its rows' descriptions out of sight, as hints (#614).
    const wrapped = runtime.render(module.Device);
    assert.equal(wrapped.type, "hints");
    const page = wrapped.props.children;
    // The sensitivity is set once: it is in the page's 「詳細設定」 (#554).
    const fold = page.props.children.find((node: TreeNode | null) => node?.props?.status !== undefined);
    const containers: TreeNode[] = [fold.props.children].flat()
        .filter((node: TreeNode | null) => typeof node?.type === "function" && node.type.name.endsWith("Container"));
    return { toggled, sources: containers.map(node => {
        // A container of the page drawn as React would: its type is the page's own row component.
        const tree = draw(node);
        return { radio: findIn(tree, item => item.type === RadioButton).props, threshold: findIn(tree, item => item.type === ThresholdComponent).props };
    }) };
};

test("without a VAD engine the VAD option is unavailable with its reason, and a saved switch shows the volume mode", async () => {
    const { sources, toggled } = await render({
        currentVadAvailable: { data: false },
        currentMicVadFilter: { data: true, state: "ok" }, currentSpeakerVadFilter: { data: true, state: "ok" },
    });
    const cases: [typeof sources[number], string][] = [[sources[0], "auto"], [sources[1], "manual"]];
    for (const [source, mode] of cases) {
        const vad = source.radio.options.find((option: { id: string }) => option.id === "vad");
        assert.equal(vad.disabled, true);
        assert.equal(vad.desc, "config_page.device.desc_vad_unavailable");
        assert.equal(source.radio.checked_variable.data, mode, "the mode that cuts the speech");
        assert.equal(source.threshold.is_vad_active, false, "the threshold applies");
    }
    // Choosing the other volume mode turns the saved switch off as before.
    sources[0].radio.selectFunction("manual");
    assert.deepEqual(toggled, ["mic_vad", "mic_auto"]);
});

test("with a VAD engine the VAD option can be chosen and a saved switch shows VAD", async () => {
    const { sources } = await render({
        currentVadAvailable: { data: true },
        currentMicVadFilter: { data: true, state: "ok" }, currentSpeakerVadFilter: { data: false, state: "ok" },
    });
    const vad = sources[0].radio.options.find((option: { id: string }) => option.id === "vad");
    assert.equal(vad.disabled, false);
    assert.equal(vad.desc, "config_page.device.mic_dynamic_energy_threshold.desc_for_vad");
    assert.equal(sources[0].radio.checked_variable.data, "vad");
    assert.equal(sources[0].threshold.is_vad_active, true);
    assert.equal(sources[1].radio.checked_variable.data, "manual");
});

test("the reason and the refusal are written in both languages", () => {
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        assert.equal(typeof localeAt(strings, "config_page.device.desc_vad_unavailable"), "string", language);
        assert.equal(typeof localeAt(strings, "backend_errors.VAD_UNAVAILABLE"), "string", language);
    }
});
