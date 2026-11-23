import * as routeState from "../../../../../../logics/voice/routeState.ts";
import * as rvcStartOptions from "../../../../../../logics/voice/rvcStartOptions.ts";
import * as directVoiceDraft from "../../../../../../logics/voice/directVoiceDraft.ts";
import * as draftRebase from "../../../../../../logics/voice/draftRebase.ts";
import * as voiceErrorText from "../../../../../../logics/voice/voiceErrorText.ts";
import * as voiceAudition from "../../../../../../logics/voice/voiceAudition.ts";
import { changedPaths } from "../../../../../../logics/voice/saveBar.ts";
import type { SaveBarEntry } from "../../../../../../logics/voice/saveBar.ts";
import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { DirectVoiceSettingsProps } from "./DirectVoiceSettings.tsx";

type Variant = NonNullable<DirectVoiceSettingsProps["variant"]>;

// #429: input forwarding under the advanced settings showed a saved RVC conversion as forwarding
// and put that change in the save bar as soon as the page opened. Any save from the page then
// wrote mode "passthrough", and the RVC switch on the main page could no longer turn on.
// These renders run the real settings draft and read what the save bar would show and save.
const rvcSettings = { mode: "converted", engine: "rvc", runtime: "", reference: "", rvc_runtime: "/rvc", rvc_model: "voice.pth",
    rvc_index: "", rvc_pitch: 0, rvc_index_rate: 0, rvc_device: "auto", rvc_threads: 0, rvc_highpass: true };

async function open(variant: Variant, settings: typeof rvcSettings) {
    const runtime = hooks(), entries = new Map<string, SaveBarEntry>(), writes: Record<string, unknown>[] = [];
    const ui = { "@useI18n": { useI18n: () => ({ t: (key: string) => key }) } };
    const { useSettingsDraft } = await loadModule<typeof import("../../../../../../logics/voice/useSettingsDraft.tsx")>(new URL("../../../../../../logics/voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        ...ui, "./draftRebase": draftRebase,
        "./saveBar": { changedPaths, setSaveBarEntry: (id: string, entry: SaveBarEntry | null) => { if (entry) entries.set(id, entry); else entries.delete(id); } },
    });
    const { DirectVoiceSettings } = await loadModule<typeof import("./DirectVoiceSettings.tsx")>(new URL("./DirectVoiceSettings.tsx", import.meta.url), runtime, { ...ui,
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft },
        "../../../../../../logics/voice/routeState": routeState,
        "../../../../../../logics/voice/directVoiceDraft": directVoiceDraft,
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ directState: { settings }, directSources: {},
            settings: { routing: "managed" }, route: {}, updateDirectError: () => {}, setDirectDraftBlocked: () => {},
            send: (endpoint: string, value: Record<string, unknown>) => {
                if (endpoint !== "/set/data/direct_voice_settings") return true;
                writes.push(value);
                return Promise.resolve({ status: 200, result: { settings: value } });
            } }), sourceKey: (value: unknown) => value },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route", VoiceRouteControls: "controls" },
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
        "./ModelDownloads": { ModelDownloads: "downloads" }, "./VcRuntimeSetup": { VcRuntimeSetup: "runtime" }, "./StatusLine": { StatusLine: "status" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/lead/Lead": { Lead: "lead" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/page_pointer/PagePointer": { PageLinkButton: "page-link" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model-link" },
        "../_components/file_drop_zone/FileDropZone": { FileDropZone: "file-drop" },
        "../../../../../../logics/common/fileDrop": { extensionOf: (path: string) => path.slice(path.lastIndexOf(".")).toLowerCase() },
        "../../../../../../logics/voice/conversionLatency": { conversionDelaySeconds: () => null },
        "../../../../../../logics/common/pathExample": { pathExample: (file: string) => file },
        "../../../../../../logics/voice/rvcStartOptions": rvcStartOptions,
        "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => ({ catalog: null }) },
        "../../../../../../logics/voice/voiceAudition": voiceAudition,
        "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorText,
    });
    const render = () => runtime.render(DirectVoiceSettings, { variant });
    // The first render has no draft yet; the second shows the saved settings.
    render();
    const tree = render();
    const [entry] = entries.values();
    return { runtime, tree, entry, writes, render };
}

test("#429: opening input forwarding with RVC saved leaves the save bar empty", async () => {
    const page = await open("legacy", rvcSettings);
    assert.equal(page.entry.dirty, false);
    assert.equal(page.entry.edited, false);
    assert.deepEqual(page.entry.changes, []);
    page.runtime.unmount();
});

test("#429: a save from input forwarding keeps the RVC selection", async () => {
    const page = await open("legacy", rvcSettings);
    // The save bar saves only forms with changes, so this form is not written at all;
    // a write that does happen keeps the saved mode and engine.
    await page.entry.save();
    assert.equal(page.writes.length, 1);
    assert.equal(page.writes[0].mode, "converted");
    assert.equal(page.writes[0].engine, "rvc");
    assert.equal(page.writes[0].rvc_model, "voice.pth");
    page.render();
    assert.deepEqual(page.entry.changes, []);
    page.runtime.unmount();
});

test("input forwarding with RVC saved still shows forwarding, not the conversion", async () => {
    const page = await open("legacy", rvcSettings);
    const text = JSON.stringify(page.tree, (key: string, value: unknown) => key === "_owner" || key === "_store" ? undefined : value);
    // Forwarded input is not played on the monitor: the row says so (#614).
    assert.match(text, /voice\.vc_monitor_not_converted/);
    assert.doesNotMatch(text, /voice\.vc_rvc_pitch/);
    page.runtime.unmount();
});

// #614: the monitor is set on the TTS page. Here a row says what it does for this voice now, and
// its button opens the TTS page on that setting; what it covers is the row's hint.
test("the monitor row says what it plays now and leads to the TTS page's setting", async () => {
    for (const [variant, settings, value] of [["legacy", rvcSettings, "voice.vc_monitor_not_converted"], ["rvc", rvcSettings, "voice.monitor_off"]] as const) {
        const page = await open(variant, settings);
        const row = nodesIn(page.tree).find(node => node.type === "row" && node.props.label === "voice_ui.monitor_heading");
        assert.ok(row, variant);
        assert.deepEqual([row.props.description, row.props.group], ["voice.vc_monitor_help", true]);
        const state = nodesIn(row).find(node => node.props?.["data-vc-monitor"] !== undefined);
        assert.equal(state?.props.children, value, variant);
        const link = nodesIn(row).find(node => node.type === "page-link");
        assert.deepEqual([link?.props.tab, link?.props.action, link?.props.target], ["tts", "voice.vc_monitor_action", "tts_monitor"]);
        page.runtime.unmount();
    }
});

const selectButton = (tree: unknown) => nodesIn(tree).find(node => node.type === "button" && node.props.children === "voice_ui.select_rvc");

test("#436: opening the RVC page with forwarding saved leaves the save bar empty and offers a button", async () => {
    const forwarding = await open("rvc", { ...rvcSettings, mode: "passthrough" });
    assert.equal(forwarding.entry.dirty, false, "opening the page changes nothing");
    assert.deepEqual(forwarding.entry.changes, []);
    const button = selectButton(forwarding.tree);
    assert.ok(button, "the page offers to switch to RVC");
    await button.props.onClick();
    assert.equal(forwarding.writes.length, 1);
    assert.equal(forwarding.writes[0].mode, "converted");
    assert.equal(forwarding.writes[0].engine, "rvc");
    assert.equal(forwarding.writes[0].rvc_model, "voice.pth");
    forwarding.runtime.unmount();
    const converted = await open("rvc", rvcSettings);
    assert.deepEqual(converted.entry.changes, []);
    assert.equal(selectButton(converted.tree), undefined, "no button once RVC is selected");
    converted.runtime.unmount();
});

test("#436: saving an RVC field with forwarding saved keeps forwarding", async () => {
    const page = await open("rvc", { ...rvcSettings, mode: "passthrough" });
    await page.entry.save();
    assert.equal(page.writes.length, 1);
    assert.equal(page.writes[0].mode, "passthrough");
    page.runtime.unmount();
});

// #614: what each form is for, what to expect of the conversion and what the input does not do are
// its heading's description (a hint on the RVC page); nothing repeats them as a paragraph. What
// Start waits for and the monitor's line stay in sight.
const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);
const forms: [Variant, string, string][] = [
    ["rvc", "config_page.rvc.rvc_settings.label", "voice.vc_rvc_hint\nvoice_ui.rvc_latency_hint\nvoice.input_scope"],
    ["legacy", "voice.input_title", "voice.input_description\nvoice.input_scope"],
];
for (const [variant, heading, intro] of forms) test(`${variant}: the form's description is its heading's`, async () => {
    const page = await open(variant, rvcSettings);
    const [label] = all(page.tree, node => node.type === "heading");
    assert.equal(label.props.label, heading);
    assert.equal(label.props.desc, intro);
    // Not in a fold here, so a category heading; in the RVC page's fold it is a subheading.
    assert.equal(label.props.sub, false);
    const paragraphs = all(page.tree, node => node.type === "description").map(node => node.props.text);
    for (const text of ["voice.vc_rvc_hint", "voice.input_description", "voice_ui.rvc_latency_hint", "voice.input_scope"]) assert.ok(!paragraphs.includes(text), text);
    if (variant === "rvc") {
        const [worker] = all(page.tree, node => node.type === "setup" && node.props.title === "voice_ui.rvc_worker_title");
        assert.equal(worker.props.desc, "voice_ui.rvc_worker_hint");
    }
    page.runtime.unmount();
});

test("#614: that the input does not use RVC yet stays in sight beside its button", async () => {
    const page = await open("rvc", { ...rvcSettings, mode: "passthrough" });
    const [row] = all(page.tree, node => node.type === "row" && node.props.label === "voice_ui.select_rvc_label");
    assert.equal(row.props.description, "voice_ui.select_rvc_pending");
    assert.equal(row.props.keepDescription, true);
    page.runtime.unmount();
});
