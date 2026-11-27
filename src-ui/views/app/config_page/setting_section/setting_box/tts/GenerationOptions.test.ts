import * as routeState from "../../../../../../logics/voice/routeState.ts";
import * as directVoiceDraft from "../../../../../../logics/voice/directVoiceDraft.ts";
import * as rvcStartOptions from "../../../../../../logics/voice/rvcStartOptions.ts";
import * as voiceErrorTextModule from "../../../../../../logics/voice/voiceErrorText.ts";
import * as voiceAudition from "../../../../../../logics/voice/voiceAudition.ts";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { hooks, loadModule, find, findIn, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";

interface Options {
    seed?: string;
    instructions?: string;
    modelOptions?: Record<string, unknown>;
    // The page's words; the harness's own gives the key alone.
    t?: (key: string, values?: Record<string, unknown>) => string;
}

async function setup({ seed = "invalid", instructions = "\u0001", modelOptions = {}, t }: Options = {}) {
    const runtime = hooks();
    const draft = { japanese_seed: seed, japanese_instructions: instructions, japanese_server: "external", japanese_url: "" };
    const { GenerationOptions, validGenerationOptions } = await loadModule<typeof import("./GenerationOptions.tsx")>(new URL("./GenerationOptions.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: draft, modelOptions, send: () => {} }) },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ state: {} }) },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/page_pointer/PagePointer": { PageLinkButton: "page-link" },
        ...(t ? { "@useI18n": { useI18n: () => ({ t }) } } : {}),
    });
    return { runtime, draft, GenerationOptions, validGenerationOptions,
        render: () => runtime.render(GenerationOptions, { role: "japanese", draft, field: () => {}, errorId: "options-error" }) };
}
type Setup = Awaited<ReturnType<typeof setup>>;
// The seed is the kit's TextField and the instruction the kit's Textarea; both take invalid.
const kind = (type: string) => type === "input" ? kitStandIns.TextField : kitStandIns.Textarea;
const invalidOf = (field: TreeNode) => field.props.invalid;

test("invalid TTS seed and instruction point to the shared form error and clear after correction", async () => {
    const s = await setup();
    let tree = s.render();
    // The instruction's field also says how many characters it holds (its count under it).
    const countId = () => findIn(s.render(), node => node.type === "row").props.actions.props.id;
    const described = (field: TreeNode) => String(field.props["aria-describedby"] ?? "").split(" ").filter(Boolean);
    for (const type of ["input", "textarea"]) {
        const field = findIn(tree, node => node.type === kind(type));
        assert.equal(invalidOf(field), true);
        assert.deepEqual(described(field), type === "textarea" ? [countId(), "options-error"] : ["options-error"]);
    }
    assert.equal(s.validGenerationOptions(s.draft), false);
    s.draft.japanese_seed = "42"; s.draft.japanese_instructions = "話す速さをゆっくりに";
    tree = s.render();
    for (const type of ["input", "textarea"]) {
        const field = findIn(tree, node => node.type === kind(type));
        assert.equal(invalidOf(field), false);
        assert.deepEqual(described(field), type === "textarea" ? [countId()] : []);
    }
    assert.equal(s.validGenerationOptions(s.draft), true);
    s.runtime.unmount();
});

test("the seed and instruction fields show an example while they are empty", async () => {
    const s = await setup({ seed: "", instructions: "" });
    s.draft.japanese_seed = "0";
    const tree = s.render();
    for (const type of ["input", "textarea"]) assert.equal(findIn(tree, node => node.type === kind(type)).props.placeholder, "voice_ui.example");
    s.runtime.unmount();
});

test("the instruction is the kit's Textarea in a form's shape, with its limit, its rows and its draft field", async () => {
    const s = await setup({ seed: "", instructions: "" });
    const written: string[][] = [];
    const tree = s.runtime.render(s.GenerationOptions, { role: "japanese", draft: s.draft, errorId: "options-error",
        field: (key: string, value: string) => { written.push([key, value]); } });
    const field = findIn(tree, node => node.type === kitStandIns.Textarea).props;
    // Not fill: a form's field starts at 8rem and has an edge to drag (Field.css.ts).
    assert.deepEqual([field.fill, field.mono, field.maxLength, field.rows, field["aria-label"], field.value], [undefined, undefined, 8000, 3, "voice_ui.instruction", ""]);
    // A valid instruction is described by its count alone.
    assert.equal(field["aria-describedby"], findIn(tree, node => node.type === "row").props.actions.props.id);
    field.onChange({ target: { value: "ゆっくり話す" } });
    assert.deepEqual(written, [["japanese_instructions", "ゆっくり話す"]]);
    s.runtime.unmount();
});

test("the count under the instruction counts characters as they are typed, an emoji as one", async () => {
    const s = await setup({ seed: "", instructions: "ゆっくり😀", t: (key, values) => values ? `${key} ${JSON.stringify(values)}` : key });
    const count = findIn(s.render(), node => node.type === "row").props.actions;
    assert.equal(count.props.children, 'voice_ui.instruction_count {"count":5}');
    s.runtime.unmount();
});

test("TTS model-specific seed range error is associated without changing the save contract", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const s = await setup({ seed: "123", instructions: "", modelOptions: { japanese: {
        server: "external", configured_url: "http://local", options: { seed: { minimum: 0, maximum: 100 } },
    } } });
    s.draft.japanese_url = "http://local";
    const tree = s.render(), input = findIn(tree, node => node.type === kitStandIns.TextField), alert = findIn(tree, node => node.props?.role === "alert");
    assert.equal(input.props.invalid, true);
    assert.equal(input.props["aria-describedby"], alert.props.id);
    assert.equal(s.validGenerationOptions(s.draft), true); // Model support is advisory, as before.
    s.runtime.unmount();
});

// hints: whether the page keeps descriptions out of sight (#614).
const loadVoiceSettings = (s: Setup, runtime: HookRuntime, hints = false) =>
    loadModule<typeof import("../advanced_settings/VoiceSettings.tsx")>(new URL("../advanced_settings/VoiceSettings.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ settings: s.draft, status: {}, devices: {}, send: () => {}, modelOptions: {} }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft: s.draft }) },
        "../tts/GenerationOptions": { GenerationOptions: s.GenerationOptions, validGenerationOptions: s.validGenerationOptions, currentModelOptions: () => null },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ state: {} }) },
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ fromCode: (code: string) => code }) },
        "../tts/TtsEngine": { TtsEngine: "engine", TTS_ENGINES: {}, AUDIO_QUERY_ENGINES: [], validCoeiroinkOptions: () => true, validAudioQueryOptions: () => true },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route" }, "../tts/VirtualMicEntry": { VirtualMicEntry: "virtual-mic" }, "./StopVoiceButton": { StopVoiceButton: "stop-voice" }, "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorTextModule,
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
        "./StatusLine": { StatusLine: "status" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/lead/Lead": { Lead: "lead" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/page_pointer/PagePointer": { PageLinkButton: "page-link" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
    });

test("TTS form supplies an existing error ID to both language groups", async () => {
    const s = await setup(), runtime = hooks();
    const { VoiceSettings } = await loadVoiceSettings(s, runtime);
    // The options' error is the alert with an id; a missing output device is said apart (#1266).
    const tree = runtime.render(VoiceSettings), alert = findIn(tree, node => node.props?.role === "alert" && !!node.props.id);
    const groups: TreeNode[] = [];
    find(tree, node => { if (node.type === s.GenerationOptions) groups.push(node); return false; });
    assert.equal(groups.length, 2);
    for (const group of groups) assert.equal(group.props.errorId, alert.props.id);
    runtime.unmount(); s.runtime.unmount();
});

// #614: what the TTS page reads is its heading's hint and what the monitor plays is its legend's;
// the rows' words are their labels'. What the instruction is for is its label's hint too; the count
// of its characters stays in sight under the field, as they are typed.
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
    // Each speech.cpp voice is a row too, typed until the server lists its voices (#1266).
    assert.deepEqual(rows, [["voice.output_device", "voice_ui.output_hint"], ["voice.japanese_voice", "voice_ui.voice_list_hint"],
        ["voice.multilingual_voice", "voice_ui.voice_list_hint"], ["voice.mic_mode", "voice.mic_hint"], ["voice.conversion", "voice.conversion_hint"]]);
    const instruction = findIn(s.render(), node => node.type === "row");
    assert.deepEqual([instruction.props.description, instruction.props.keepDescription], ["voice_ui.instruction_desc", undefined]);
    assert.equal(instruction.props.actions.props.children, "voice_ui.instruction_count");
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
        "../_components/lead/Lead": { Lead: "lead" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/path_field/PathField": { PathField: "path-field" },
        "../_components/page_pointer/PagePointer": { PageLinkButton: "page-link" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model-link" },
        "../_components/file_drop_zone/FileDropZone": { FileDropZone: "file-drop" },
        "../../../../../../logics/common/fileDrop": { extensionOf: (path: string) => path.slice(path.lastIndexOf(".")).toLowerCase() },
        "../../../../../../logics/voice/conversionLatency": { conversionDelaySeconds: () => null },
        "../../../../../../logics/common/pathExample": { pathExample: (file: string) => `/models/${file}` },
        "../../../../../../logics/voice/rvcStartOptions": rvcStartOptions,
        "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => ({ catalog: null }) },
        "../../../../../../logics/voice/voiceAudition": voiceAudition,
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: object) => options ? `${key}:${JSON.stringify(options)}` : key }) },
    });
    const tree = runtime.render(DirectVoiceSettings, { variant: "rvc" });
    const alert = findIn(tree, node => node.props?.children === "voice_ui.invalid_rvc_numbers");
    const fields: TreeNode[] = [];
    find(tree, node => { if (node.type === kitStandIns.TextField && node.props.type === "number") fields.push(node); return false; });
    assert.equal(fields.length, 3);
    for (const field of fields) {
        assert.equal(field.props["aria-describedby"], alert.props.id);
        assert.equal(typeof field.props.invalid, "boolean");
    }
    assert.ok(fields.some(field => field.props.invalid));
    // A cleared number field still shows what goes in it.
    assert.deepEqual(fields.map(field => field.props.placeholder),
        [12, 0.75, 4].map(value => `voice_ui.example:${JSON.stringify({ value })}`));
    // Each path field shows an example path, written the way this OS writes paths (pathExample),
    // beside the button that picks it: the runtime's folder, the model's and the index's file (#1231).
    const paths: TreeNode[] = [];
    find(tree, node => { if (node.type === "path-field") paths.push(node); return false; });
    assert.deepEqual(paths.map(field => field.props.placeholder), ["rvc-runtime", "voice.pth", "voice.index"]
        .map(file => `voice_ui.example:${JSON.stringify({ value: `/models/${file}` })}`));
    assert.deepEqual(paths.map(field => field.props.pick), [{ kind: "folder" }, { kind: "file", extensions: ["pth"] }, { kind: "file", extensions: ["index"] }]);
    runtime.unmount();
});

// The seed field is the kit's TextField, labelled and with an example; Check is the kit's plain
// button, which needs a saved URL (or the bundled server running) and says so while it waits.
test("the seed field and the check of the model's options are the kit's parts", async () => {
    const s = await setup({ seed: "", instructions: "" });
    s.draft.japanese_seed = "0";
    let tree = s.render();
    const seed = findIn(tree, node => node.type === kitStandIns.TextField);
    assert.deepEqual([seed.props.inputMode, seed.props.placeholder, seed.props.invalid], ["numeric", "voice_ui.example", false]);
    assert.ok(find(tree, node => node.type === "label" && [node.props.children].flat().includes("voice_ui.seed_value")));
    let check = findIn(tree, node => node.type === kitStandIns.Button);
    assert.equal(check.props.children, "voice_ui.check_options");
    assert.equal(check.props.disabled, true, "no URL yet");
    const reason = findIn(tree, node => node.type === "p" && node.props.id === check.props["aria-describedby"]);
    assert.equal(reason.props.children, "voice_ui.check_needs_url");
    s.draft.japanese_url = "http://local";
    tree = s.render();
    check = findIn(tree, node => node.type === kitStandIns.Button);
    assert.deepEqual([check.props.disabled, check.props["aria-describedby"]], [false, undefined]);
    s.runtime.unmount();
});

test("the seed's mode is the kit's Select: random clears the seed and fixed starts it at 0", async () => {
    // D-14 (decided on 2026-11-25): the settings' select fields are the kit's Select.
    const s = await setup({ seed: "42", instructions: "" });
    const set: [string, string][] = [];
    const tree = s.runtime.render(s.GenerationOptions, { role: "japanese", draft: s.draft, errorId: "options-error",
        field: (key: string, value: string) => { set.push([key, value]); } });
    const mode = findIn(tree, node => node.type === kitStandIns.Select);
    assert.deepEqual([mode.props["aria-label"], mode.props.value], ["voice_ui.seed_mode", "fixed"]);
    const label = findIn(tree, node => node.type === "label" && find(node, inner => inner.type === kitStandIns.Select) !== null);
    assert.equal([label.props.children].flat()[0], "voice_ui.seed_mode");
    const options: unknown[][] = [];
    find(mode, node => { if (node.type === kitStandIns.SelectOption) options.push([node.props.value, node.props.children]); return false; });
    assert.deepEqual(options, [["random", "voice_ui.seed_random"], ["fixed", "voice_ui.seed_fixed"]]);
    assert.equal(find(tree, node => node.type === "select" || node.type === "option"), null, "no native list");
    mode.props.onChange({ target: { value: "random" } });
    mode.props.onChange({ target: { value: "fixed" } });
    assert.deepEqual(set, [["japanese_seed", ""], ["japanese_seed", "0"]]);
    // No seed: the mode is random.
    s.draft.japanese_seed = "";
    const random = s.runtime.render(s.GenerationOptions, { role: "japanese", draft: s.draft, errorId: "options-error", field: () => {} });
    assert.equal(findIn(random, node => node.type === kitStandIns.Select).props.value, "random");
    s.runtime.unmount();
});
