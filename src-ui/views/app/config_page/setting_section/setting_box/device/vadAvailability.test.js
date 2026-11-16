import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.js";

// #391: without a VAD engine the VAD option says why it cannot be chosen, and a VAD switch
// saved by an earlier version shows the volume mode that applies instead.
const RadioButton = () => null, ThresholdComponent = () => null;

const render = async device => {
    const runtime = hooks();
    const toggled = [];
    const module = await loadModule(new URL("./Device.jsx", import.meta.url), runtime, {
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
            ThresholdComponent, SwitchBox: () => null, RadioButton },
    });
    const page = runtime.render(module.Device);
    const containers = page.props.children.filter(node => typeof node?.type === "function" && node.type.name.endsWith("Container"));
    return { toggled, sources: containers.map(node => {
        const tree = node.type(node.props);
        return { radio: find(tree, item => item.type === RadioButton).props, threshold: find(tree, item => item.type === ThresholdComponent).props };
    }) };
};

test("without a VAD engine the VAD option is unavailable with its reason, and a saved switch shows the volume mode", async () => {
    const { sources, toggled } = await render({
        currentVadAvailable: { data: false },
        currentMicVadFilter: { data: true, state: "ok" }, currentSpeakerVadFilter: { data: true, state: "ok" },
    });
    for (const [source, mode] of [[sources[0], "auto"], [sources[1], "manual"]]) {
        const vad = source.radio.options.find(option => option.id === "vad");
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
    const vad = sources[0].radio.options.find(option => option.id === "vad");
    assert.equal(vad.disabled, false);
    assert.equal(vad.desc, "config_page.device.mic_dynamic_energy_threshold.desc_for_vad");
    assert.equal(sources[0].radio.checked_variable.data, "vad");
    assert.equal(sources[0].threshold.is_vad_active, true);
    assert.equal(sources[1].radio.checked_variable.data, "manual");
});

test("the reason and the refusal are written in both languages", () => {
    for (const language of ["en", "ja"]) {
        const strings = yaml.load(readFileSync(new URL(`../../../../../../../locales/${language}.yml`, import.meta.url), "utf8"));
        assert.equal(typeof strings.config_page.device.desc_vad_unavailable, "string", language);
        assert.equal(typeof strings.backend_errors.VAD_UNAVAILABLE, "string", language);
    }
});
