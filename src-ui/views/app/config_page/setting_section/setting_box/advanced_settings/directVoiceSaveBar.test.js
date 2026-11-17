import * as routeState from "../../../../../../logics/voice/routeState.ts";
import * as rvcStartOptions from "../../../../../../logics/voice/rvcStartOptions.ts";
import * as directVoiceDraft from "../../../../../../logics/voice/directVoiceDraft.ts";
import * as draftRebase from "../../../../../../logics/voice/draftRebase.ts";
import * as voiceErrorText from "../../../../../../logics/voice/voiceErrorText.ts";
import { changedPaths } from "../../../../../../logics/voice/saveBar.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.js";

// #429: input forwarding under the advanced settings showed a saved RVC conversion as forwarding
// and put that change in the save bar as soon as the page opened. Any save from the page then
// wrote mode "passthrough", and the RVC switch on the main page could no longer turn on.
// These renders run the real settings draft and read what the save bar would show and save.
const rvcSettings = { mode: "converted", engine: "rvc", runtime: "", reference: "", rvc_runtime: "/rvc", rvc_model: "voice.pth",
    rvc_index: "", rvc_pitch: 0, rvc_index_rate: 0, rvc_device: "auto", rvc_threads: 0, rvc_highpass: true };

async function open(variant, settings) {
    const runtime = hooks(), entries = new Map(), writes = [];
    const ui = { "@useI18n": { useI18n: () => ({ t: key => key }) } };
    const { useSettingsDraft } = await loadModule(new URL("../../../../../../logics/voice/useSettingsDraft.jsx", import.meta.url), runtime, {
        ...ui, "./draftRebase": draftRebase,
        "./saveBar": { changedPaths, setSaveBarEntry: (id, entry) => { if (entry) entries.set(id, entry); else entries.delete(id); } },
    });
    const { DirectVoiceSettings } = await loadModule(new URL("./DirectVoiceSettings.jsx", import.meta.url), runtime, { ...ui,
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft },
        "../../../../../../logics/voice/routeState": routeState,
        "../../../../../../logics/voice/directVoiceDraft": directVoiceDraft,
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ directState: { settings }, directSources: {},
            settings: { routing: "managed" }, route: {}, updateDirectError: () => {}, setDirectDraftBlocked: () => {},
            send: (endpoint, value) => {
                if (endpoint !== "/set/data/direct_voice_settings") return true;
                writes.push(value);
                return Promise.resolve({ status: 200, result: { settings: value } });
            } }), sourceKey: value => value },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route", VoiceRouteControls: "controls" },
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
        "./ModelDownloads": { ModelDownloads: "downloads" }, "./VcRuntimeSetup": { VcRuntimeSetup: "runtime" }, "./StatusLine": { StatusLine: "status" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model-link" },
        "../_components/file_drop_zone/FileDropZone": { FileDropZone: "file-drop" },
        "../../../../../../logics/common/fileDrop": { extensionOf: path => path.slice(path.lastIndexOf(".")).toLowerCase() },
        "../../../../../../logics/voice/conversionLatency": { conversionDelaySeconds: () => null },
        "../../../../../../logics/common/pathExample": { pathExample: file => file },
        "../../../../../../logics/voice/rvcStartOptions": rvcStartOptions,
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
    const text = JSON.stringify(page.tree, (key, value) => key === "_owner" || key === "_store" ? undefined : value);
    assert.match(text, /voice\.vc_monitor_passthrough/);
    assert.doesNotMatch(text, /voice\.vc_rvc_pitch/);
    page.runtime.unmount();
});

const flatten = node => !node || typeof node !== "object" ? [] :
    Array.isArray(node) ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)];
const selectButton = tree => flatten(tree).find(node => node.type === "button" && node.props.children === "voice_ui.select_rvc");

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
