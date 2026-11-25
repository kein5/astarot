import assert from "node:assert/strict";
import { test } from "vitest";
import type { VoiceSettings as VoiceSettingsValue } from "../../../../../../logics/voice/useVoice";
import * as voiceErrorTextModule from "../../../../../../logics/voice/voiceErrorText.ts";
import { find, findIn, hooks, kitStandIns, loadModule } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

async function setup(initial: VoiceSettingsValue = {}) {
    const runtime = hooks();
    let draft: VoiceSettingsValue = {
        mode: "off",
        mic_mode: "off",
        target_slot: "1",
        direct_policy: "suppress",
        output_device: "",
        routing: "external",
        monitor: "off",
        ...initial,
    };
    const setDraft = (next: VoiceSettingsValue | ((previous: VoiceSettingsValue) => VoiceSettingsValue)) => {
        draft = typeof next === "function" ? next(draft) : next;
    };
    const { VoiceSettings } = await loadModule<typeof import("./VoiceSettings.tsx")>(new URL("./VoiceSettings.tsx", import.meta.url), runtime, {
        "@useI18n": {
            useI18n: () => ({
                t: (key: string, options?: object) => (options ? `${key}:${JSON.stringify(options)}` : key),
                i18n: { exists: () => false },
            }),
        },
        "../../../../../../logics/voice/useVoice": {
            useVoice: () => ({ settings: draft, status: {}, devices: {}, error: null, send: () => {}, updateError: () => {} }),
        },
        "../../../../../../logics/voice/useSettingsDraft": {
            useSettingsDraft: () => ({ draft, setDraft, saving: false, dirty: false, submit: () => {}, navigationDialog: null }),
        },
        "../tts/GenerationOptions": { GenerationOptions: "generation-options", validGenerationOptions: () => true },
        "../tts/TtsEngine": { TtsEngine: "engine", TTS_ENGINES: {}, AUDIO_QUERY_ENGINES: [], validCoeiroinkOptions: () => true, validAudioQueryOptions: () => true },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route" },
        "../tts/VirtualMicEntry": { VirtualMicEntry: "virtual-mic" },
        "./StopVoiceButton": { StopVoiceButton: "stop-voice" },
        "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorTextModule,
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
        "./StatusLine": { StatusLine: "status" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => false },
    });
    return {
        runtime,
        draft: () => draft,
        render: () => runtime.render(VoiceSettings),
    };
}

const optionPairs = (select: TreeNode) => {
    const items: [unknown, unknown][] = [];
    find(select, node => {
        if (node.type === kitStandIns.SelectOption) items.push([node.props.value, node.props.children]);
        return false;
    });
    return items;
};

test("microphone speech mode matches the chat speech mode's options and order", async () => {
    const s = await setup();
    const tree = s.render();
    const chatMode = findIn(tree, node => node.type === kitStandIns.Select && node.props["aria-label"] === "voice.mode");
    const micMode = findIn(tree, node => node.type === kitStandIns.Select && node.props["aria-label"] === "voice.mic_mode");
    assert.deepEqual(optionPairs(micMode), [
        ["off", "voice.off"],
        ["original", "voice.original"],
        ["translated", "voice.translated"],
    ]);
    assert.deepEqual(optionPairs(micMode), optionPairs(chatMode));

    micMode.props.onChange({ target: { value: "original" } });
    assert.equal(s.draft().mic_mode, "original");
    s.runtime.unmount();
});

test("original microphone speech enables direct policy and the advanced status, without requiring a translation slot", async () => {
    for (const [micMode, directDisabled, slotDisabled, micStatus] of [
        ["off", true, true, "config_page.advanced_status.off"],
        ["original", false, true, "config_page.advanced_status.on"],
        ["translated", false, false, "config_page.advanced_status.on"],
    ] as const) {
        const s = await setup({ mode: "off", mic_mode: micMode });
        const tree = s.render();
        const directPolicy = findIn(tree, node => node.type === kitStandIns.Select && node.props["aria-label"] === "voice.direct_policy");
        const targetSlot = findIn(tree, node => node.type === kitStandIns.Select && node.props["aria-label"] === "voice.target_slot");
        const advanced = findIn(tree, node => node.type === "advanced");
        assert.equal(directPolicy.props.disabled, directDisabled, `direct_policy disabled for mic_mode=${micMode}`);
        assert.equal(targetSlot.props.disabled, slotDisabled, `target_slot disabled for mic_mode=${micMode}`);
        assert.equal(
            advanced.props.status,
            `config_page.advanced_status.tts:${JSON.stringify({ monitor: "config_page.advanced_status.off", mic: micStatus })}`,
            `advanced status for mic_mode=${micMode}`,
        );
        s.runtime.unmount();
    }
});

test("a language whose server the settings do not name uses the bundled one, and asks for no address", async () => {
    const addressShown = (tree: unknown, role: string) => find(tree, node => node.type === "fieldset"
        && node.props["aria-label"] === `speech_servers.${role} · voice.title`
        && find(node, inner => typeof inner.props?.placeholder === "string" && inner.props.placeholder.startsWith("voice_ui.example")) !== null) !== null;
    const serverChoice = (tree: unknown, role: string) =>
        findIn(tree, node => node.type === kitStandIns.Select && node.props["aria-label"] === `speech_servers.${role}_selection`).props.value;
    const unset = await setup({ japanese_voice: "none", multilingual_voice: "none" });
    let tree = unset.render();
    assert.deepEqual([serverChoice(tree, "japanese"), serverChoice(tree, "multilingual")], ["bundled", "bundled"]);
    assert.deepEqual([addressShown(tree, "japanese"), addressShown(tree, "multilingual")], [false, false]);
    unset.runtime.unmount();
    const external = await setup({ japanese_server: "external", japanese_url: "http://x", multilingual_server: "bundled" });
    tree = external.render();
    assert.deepEqual([serverChoice(tree, "japanese"), serverChoice(tree, "multilingual")], ["external", "bundled"]);
    assert.deepEqual([addressShown(tree, "japanese"), addressShown(tree, "multilingual")], [true, false]);
    external.runtime.unmount();
});

test("every list of the form is the kit's Select with the kit's options, named and enabled as before", async () => {
    // D-14 (decided on 2026-11-25): the settings' select fields are the kit's Select, a native
    // <select> in the kit's field. The page draws no list of its own.
    const s = await setup({ mic_mode: "original", monitor: "on", conversion: "on" });
    const tree = s.render();
    const kinds = new Set<unknown>();
    const lists: unknown[][] = [];
    find(tree, node => {
        kinds.add(node.type);
        if (node.type === kitStandIns.Select) lists.push([node.props["aria-label"], node.props.disabled ?? null]);
        return false;
    });
    assert.deepEqual(lists, [["voice.mode", null], ["voice.target_slot", true], ["voice.output_device", false],
        ["speech_servers.japanese_selection", null], ["speech_servers.multilingual_selection", null], ["voice.monitor", null],
        ["voice.monitor_device", false], ["voice.mic_mode", null], ["voice.direct_policy", false], ["voice.conversion", null]]);
    for (const native of ["select", "option", "optgroup"]) assert.equal(kinds.has(native), false, `no native ${native}`);
    // Mixing cannot go with the conversion: the kit's option keeps its own disabled state.
    const policy = findIn(tree, node => node.type === kitStandIns.Select && node.props["aria-label"] === "voice.direct_policy");
    const mix = findIn(policy, node => node.type === kitStandIns.SelectOption && node.props.value === "mix");
    assert.equal(mix.props.disabled, true);
    s.runtime.unmount();
});
