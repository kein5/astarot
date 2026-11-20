import * as routeState from "../../../../../../logics/voice/routeState.ts";
import * as directVoiceDraft from "../../../../../../logics/voice/directVoiceDraft.ts";
import * as rvcStartOptions from "../../../../../../logics/voice/rvcStartOptions.ts";
import * as voiceErrorTextModule from "../../../../../../logics/voice/voiceErrorText.ts";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule, find, findIn } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";

interface Options {
    seed?: string;
    instructions?: string;
    modelOptions?: Record<string, unknown>;
}

async function setup({ seed = "invalid", instructions = "\u0001", modelOptions = {} }: Options = {}) {
    const runtime = hooks();
    const draft = { japanese_seed: seed, japanese_instructions: instructions, japanese_server: "external", japanese_url: "" };
    const { GenerationOptions, validGenerationOptions } = await loadModule<typeof import("./GenerationOptions.tsx")>(new URL("./GenerationOptions.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: draft, modelOptions, send: () => {} }) },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ state: {} }) },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/form_row/FormRow": { FormRow: "row" },
    });
    return { runtime, draft, GenerationOptions, validGenerationOptions,
        render: () => runtime.render(GenerationOptions, { role: "japanese", draft, field: () => {}, errorId: "options-error" }) };
}
type Setup = Awaited<ReturnType<typeof setup>>;

test("invalid TTS seed and instruction point to the shared form error and clear after correction", async () => {
    const s = await setup();
    let tree = s.render();
    for (const type of ["input", "textarea"]) {
        const field = findIn(tree, node => node.type === type);
        assert.equal(field.props["aria-invalid"], true);
        assert.equal(field.props["aria-describedby"], "options-error");
    }
    assert.equal(s.validGenerationOptions(s.draft), false);
    s.draft.japanese_seed = "42"; s.draft.japanese_instructions = "話す速さをゆっくりに";
    tree = s.render();
    for (const type of ["input", "textarea"]) {
        const field = findIn(tree, node => node.type === type);
        assert.equal(field.props["aria-invalid"], false);
        assert.equal(field.props["aria-describedby"], undefined);
    }
    assert.equal(s.validGenerationOptions(s.draft), true);
    s.runtime.unmount();
});

test("the seed and instruction fields show an example while they are empty", async () => {
    const s = await setup({ seed: "", instructions: "" });
    s.draft.japanese_seed = "0";
    const tree = s.render();
    for (const type of ["input", "textarea"]) assert.equal(findIn(tree, node => node.type === type).props.placeholder, "voice_ui.example");
    s.runtime.unmount();
});

test("TTS model-specific seed range error is associated without changing the save contract", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = await setup({ seed: "123", instructions: "", modelOptions: { japanese: {
        server: "external", configured_url: "http://local", options: { seed: { minimum: 0, maximum: 100 } },
    } } });
    s.draft.japanese_url = "http://local";
    const tree = s.render(), input = findIn(tree, node => node.type === "input"), alert = findIn(tree, node => node.props?.role === "alert");
    assert.equal(input.props["aria-invalid"], true);
    assert.equal(input.props["aria-describedby"], alert.props.id);
    assert.equal(s.validGenerationOptions(s.draft), true); // Model support is advisory, as before.
    s.runtime.unmount();
});

// hints: whether the page keeps descriptions out of sight (#614).
const loadVoiceSettings = (s: Setup, runtime: HookRuntime, hints = false) =>
    loadModule<typeof import("../advanced_settings/VoiceSettings.tsx")>(new URL("../advanced_settings/VoiceSettings.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: s.draft, status: {}, devices: {}, send: () => {} }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft: s.draft }) },
        "../tts/GenerationOptions": { GenerationOptions: s.GenerationOptions, validGenerationOptions: s.validGenerationOptions },
        "../tts/TtsEngine": { TtsEngine: "engine", TTS_ENGINES: {}, AUDIO_QUERY_ENGINES: [], validCoeiroinkOptions: () => true, validAudioQueryOptions: () => true },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route" }, "../tts/VirtualMicEntry": { VirtualMicEntry: "virtual-mic" }, "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorTextModule,
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
        "./StatusLine": { StatusLine: "status" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
    });

test("TTS form supplies an existing error ID to both language groups", async () => {
    const s = await setup(), runtime = hooks();
    const { VoiceSettings } = await loadVoiceSettings(s, runtime);
    const tree = runtime.render(VoiceSettings), alert = findIn(tree, node => node.props?.role === "alert");
    const groups: TreeNode[] = [];
    find(tree, node => { if (node.type === s.GenerationOptions) groups.push(node); return false; });
    assert.equal(groups.length, 2);
    for (const group of groups) assert.equal(group.props.errorId, alert.props.id);
    runtime.unmount(); s.runtime.unmount();
});

// #614: what the TTS page reads is its heading's hint and what the monitor plays is its legend's;
// the rows' words are their labels'. The instruction's line counts as it is typed, so it stays.
for (const hints of [false, true]) test(`${hints ? "hints" : "no hints"}: the TTS page's descriptions follow the page`, async () => {
    const s = await setup({ seed: "", instructions: "" }), runtime = hooks();
    const { VoiceSettings } = await loadVoiceSettings(s, runtime, hints);
    const tree = runtime.render(VoiceSettings);
    assert.equal(findIn(tree, node => node.type === "heading").props.desc, "voice_ui.tts_description");
    const descriptions: unknown[] = [];
    find(tree, node => { if (node.type === "description") descriptions.push(node.props.text); return false; });
    assert.deepEqual(descriptions, hints ? [] : ["voice.monitor_hint"]);
    const legend = find(tree, node => node.type === "legend" && JSON.stringify(node.props.children).includes("voice_ui.monitor_heading"));
    const mark = find(legend, node => node.type === "hint");
    assert.equal(Boolean(mark), hints);
    if (hints) {
        assert.ok(mark);
        assert.deepEqual([mark.props.text, mark.props.focusable], ["voice.monitor_hint", true]);
    }
    const rows: unknown[][] = [];
    find(tree, node => { if (node.type === "row") rows.push([node.props.label, node.props.description]); return false; });
    assert.deepEqual(rows, [["voice.output_device", "voice_ui.output_hint"], ["voice.mic_mode", "voice.mic_hint"], ["voice.conversion", "voice.conversion_hint"]]);
    const instruction = findIn(s.render(), node => node.type === "row");
    assert.equal(instruction.props.keepDescription, true);
    runtime.unmount(); s.runtime.unmount();
});

for (const [pitch, rate, threads] of [[25, 0.5, 0], [0, -1, 0], [NaN, NaN, 0], [0, 0, 65], [0, 0, 1.5]]) test(`RVC numeric fields reference their error (${pitch}, ${rate}, ${threads})`, async () => {
    const runtime = hooks();
    const draft = { mode: "converted", engine: "rvc", rvc_pitch: pitch, rvc_index_rate: rate,
        rvc_runtime: "", rvc_model: "", rvc_index: "", rvc_device: "auto", rvc_threads: threads, rvc_highpass: true };
    const { DirectVoiceSettings } = await loadModule<typeof import("../advanced_settings/DirectVoiceSettings.tsx")>(new URL("../advanced_settings/DirectVoiceSettings.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft }) },
        "../../../../../../logics/voice/routeState": routeState,
        "../../../../../../logics/voice/directVoiceDraft": directVoiceDraft,
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ directState: { settings: draft }, directSources: {},
            settings: { routing: "managed" }, route: {}, send: () => {}, setDirectDraftBlocked: () => {} }), sourceKey: (value: unknown) => value },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route", VoiceRouteControls: "controls" }, "../tts/VirtualMicEntry": { VirtualMicEntry: "virtual-mic" }, "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorTextModule,
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
        "./ModelDownloads": { ModelDownloads: "downloads" }, "./VcRuntimeSetup": { VcRuntimeSetup: "runtime" }, "./StatusLine": { StatusLine: "status" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model-link" },
        "../_components/file_drop_zone/FileDropZone": { FileDropZone: "file-drop" },
        "../../../../../../logics/common/fileDrop": { extensionOf: (path: string) => path.slice(path.lastIndexOf(".")).toLowerCase() },
        "../../../../../../logics/voice/conversionLatency": { conversionDelaySeconds: () => null },
        "../../../../../../logics/common/pathExample": { pathExample: (file: string) => `/models/${file}` },
        "../../../../../../logics/voice/rvcStartOptions": rvcStartOptions,
        "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => ({ catalog: null }) },
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key }) },
    });
    const tree = runtime.render(DirectVoiceSettings, { variant: "rvc" });
    const alert = findIn(tree, node => node.props?.children === "voice_ui.invalid_rvc_numbers");
    const fields: TreeNode[] = [];
    find(tree, node => { if (node.type === "input" && node.props.type === "number") fields.push(node); return false; });
    assert.equal(fields.length, 3);
    for (const field of fields) {
        assert.equal(field.props["aria-describedby"], alert.props.id);
        assert.equal(typeof field.props["aria-invalid"], "boolean");
    }
    assert.ok(fields.some(field => field.props["aria-invalid"]));
    // A cleared number field still shows what goes in it.
    assert.deepEqual(fields.map(field => field.props.placeholder),
        [12, 0.75, 4].map(value => `voice_ui.example:${JSON.stringify({ value })}`));
    // Each path field shows an example path, written the way this OS writes paths (pathExample).
    const paths: TreeNode[] = [];
    find(tree, node => { if (node.type === "input" && node.props.type === "text") paths.push(node); return false; });
    assert.deepEqual(paths.map(field => field.props.placeholder), ["rvc-runtime", "voice.pth", "voice.index"]
        .map(file => `voice_ui.example:${JSON.stringify({ value: `/models/${file}` })}`));
    runtime.unmount();
});
