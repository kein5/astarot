import * as routeState from "../../../../../../logics/voice/routeState.ts";
import * as rvcStartOptions from "../../../../../../logics/voice/rvcStartOptions.ts";
import * as directVoiceDraft from "../../../../../../logics/voice/directVoiceDraft.ts";
import * as voiceErrorText from "../../../../../../logics/voice/voiceErrorText.ts";
import * as voiceAudition from "../../../../../../logics/voice/voiceAudition.ts";
import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, kitStandIns, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";

// RVC can convert through DirectML (Windows) with the "ONNX Runtime · DirectML" runtime the
// translation shares. The RVC page lists the device and offers that runtime only where the
// backend offers it, and always shows a saved DirectML choice.
const settings = { mode: "converted", engine: "rvc", runtime: "", reference: "", rvc_runtime: "/rvc", rvc_model: "voice.pth",
    rvc_index: "", rvc_pitch: 0, rvc_index_rate: 0, rvc_device: "auto", rvc_threads: 0, rvc_highpass: true };

async function render(catalog: unknown, device = "auto", variant: "rvc" | "all" = "rvc") {
    const runtime = hooks();
    const draft = { ...settings, rvc_device: device };
    const { DirectVoiceSettings } = await loadModule<typeof import("./DirectVoiceSettings.tsx")>(new URL("./DirectVoiceSettings.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft }) },
        "../../../../../../logics/voice/routeState": routeState,
        "../../../../../../logics/voice/directVoiceDraft": directVoiceDraft,
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ directState: { settings: draft }, directSources: {},
            settings: { routing: "managed" }, route: {}, send: () => {}, setDirectDraftBlocked: () => {} }), sourceKey: (value: unknown) => value },
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
        "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => ({ catalog }) },
        "../../../../../../logics/voice/voiceAudition": voiceAudition,
        "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorText,
    });
    const nodes = nodesIn(runtime.render(DirectVoiceSettings, { variant }));
    runtime.unmount();
    const select = nodes.find(node => node.type === kitStandIns.Select && node.props["aria-label"] === "voice.vc_rvc_device");
    assert.ok(select, "the device select is shown");
    const devices = nodesIn(select).filter(node => node.type === kitStandIns.SelectOption).map(node => node.props.value);
    const setups = nodes.filter(node => node.type === "runtime").map(node => node.props.engine);
    // What DirectML offers, in one sentence; what it needs is the sentence's hint (#614).
    const hint = nodes.some(node => node.type === "lead" && node.props.text === "voice_ui.rvc_directml_lead"
        && node.props.details === "voice_ui.rvc_directml_details");
    return { devices, setups, hint, nodes };
}

test("where the DirectML runtime is offered, the RVC page lists DirectML and offers its runtime", async () => {
    const page = await render({ runtimes: [{ id: "rvc" }, { id: "onnxruntime-directml" }] });
    assert.deepEqual(page.devices, ["auto", "cuda", "directml", "cpu"]);
    assert.deepEqual(page.setups, ["rvc", "onnxruntime-directml"]);
    assert.equal(page.hint, true);
});

test("elsewhere the page offers neither, but a saved DirectML choice stays visible", async () => {
    const linux = await render({ runtimes: [{ id: "rvc" }] });
    assert.deepEqual(linux.devices, ["auto", "cuda", "cpu"]);
    assert.deepEqual(linux.setups, ["rvc"]);
    assert.equal(linux.hint, false);
    // Before the catalog arrives, nothing is offered yet.
    assert.deepEqual((await render(null)).devices, ["auto", "cuda", "cpu"]);
    assert.deepEqual((await render({ runtimes: [{ id: "rvc" }] }, "directml")).devices, ["auto", "cuda", "directml", "cpu"]);
});

// D-14 (decided on 2026-11-25): the page's lists are the kit's Select with the kit's options. The
// form that edits everything also chooses between forwarding and conversion.
test("the page's lists are the kit's Select, named as before, and no list of its own is drawn", async () => {
    for (const [variant, names] of [["rvc", ["voice.vc_rvc_device", "voice.input_source"]],
        ["all", ["voice.direct_mode", "voice.vc_rvc_device", "voice.input_source"]]] as const) {
        const { nodes } = await render({ runtimes: [{ id: "rvc" }] }, "auto", variant);
        assert.deepEqual(nodes.filter(node => node.type === kitStandIns.Select).map(node => node.props["aria-label"]), names, variant);
        assert.deepEqual(nodes.filter(node => node.type === "select" || node.type === "option"), [], variant);
    }
});
