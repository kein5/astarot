import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../../logics/test/hookHarness.ts";

const all = (tree, predicate) => {
    const result = [];
    find(tree, node => { if (predicate(node)) result.push(node); return false; });
    return result;
};

// #614: the speech.cpp servers' descriptions go to the parts that show them as hints on a reviewed
// page (the fold's title, a row's label, the checkbox's name); the readouts and warnings stay.
async function render({ cpuBuild = "separate", gpuBuild = "ready", devices = [{ kind: "gpu", name: "gpu0", label: "GPU" }] } = {}) {
    const runtime = hooks();
    const profile = { model: "", voice_file: "", vad_model: "", diarization_model: "", device: "auto", low_latency: false };
    const settings = { profiles: { japanese: { ...profile }, asr: { ...profile } } };
    const { SpeechServers } = await loadModule(new URL("./SpeechServers.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings, state: {}, devices,
            builds: { cpu_build: cpuBuild, gpu_build: gpuBuild }, pending: {}, error: null, send() {}, updateError() {} }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft: settings, setDraft() {}, saving: false, dirty: false, submit() {}, navigationDialog: null }) },
        "./ModelDownloads": { ModelDownloads: "downloads", HardwareReadout: "hardware" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model" },
        "../../../../../../logics/common/pathExample": { pathExample: name => name },
    });
    return runtime.render(SpeechServers, { profiles: ["japanese", "asr"] });
}

test("the servers' descriptions are the fold's, the rows' and the checkbox's; no paragraph is left", async () => {
    const tree = await render();
    assert.equal(find(tree, node => node.type === "setup").props.desc, "speech_servers.help");
    const rows = all(tree, node => node.type === "form-row").map(node => [node.props.label, node.props.description]);
    assert.deepEqual(rows, [
        // Which GPUs the choices use, then what "CPU" runs on this platform.
        ["speech_servers.device", "speech_servers.device_help\nspeech_servers.cpu_build_separate"],
        ["speech_servers.diarization_model", "speech_servers.diarization_help"],
        ["speech_servers.device", "speech_servers.device_help\nspeech_servers.cpu_build_separate"],
    ]);
    const check = find(tree, node => node.type === "hint-check").props;
    assert.deepEqual([check.label, check.description, check.checked], ["speech_servers.low_latency", "speech_servers.low_latency_help", false]);
    assert.ok(!find(tree, node => node.type === "description"));
});

test("a device row has no description to show when nothing applies; the missing GPU build stays a warning", async () => {
    const tree = await render({ cpuBuild: "none", gpuBuild: "unavailable", devices: [] });
    assert.equal(find(tree, node => node.type === "form-row" && node.props.label === "speech_servers.device").props.description, undefined);
    const warnings = all(tree, node => node.type === "readout" && node.props.tone === "warning");
    assert.equal(warnings.length, 2, "one per server");
    assert.equal(find(warnings[0], node => node.type === "p").props.children, "speech_servers.gpu_build_unavailable");
});
