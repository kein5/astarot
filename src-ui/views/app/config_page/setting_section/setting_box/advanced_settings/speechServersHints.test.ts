import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);

// #614: the speech.cpp servers' descriptions go to the parts that show them as hints on a reviewed
// page (the fold's title, a row's label, the checkbox's name); the readouts and warnings stay.
interface Options {
    cpuBuild?: string;
    gpuBuild?: string;
    devices?: { kind: string; name: string; label: string }[];
}

async function render({ cpuBuild = "separate", gpuBuild = "ready", devices = [{ kind: "gpu", name: "gpu0", label: "GPU" }] }: Options = {}) {
    const runtime = hooks();
    const profile = { model: "", voice_file: "", vad_model: "", diarization_model: "", device: "auto", low_latency: false };
    const settings = { profiles: { japanese: { ...profile }, asr: { ...profile } } };
    const { SpeechServers } = await loadModule<typeof import("./SpeechServers.tsx")>(new URL("./SpeechServers.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings, state: {}, devices,
            builds: { cpu_build: cpuBuild, gpu_build: gpuBuild }, pending: {}, error: null, send() {}, updateError() {} }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft: settings, setDraft() {}, saving: false, dirty: false, submit() {}, navigationDialog: null }) },
        "./ModelDownloads": { ModelDownloads: "downloads", HardwareReadout: "hardware" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model" },
        "../../../../../../logics/common/pathExample": { pathExample: (name: string) => name },
    });
    return runtime.render(SpeechServers, { profiles: ["japanese", "asr"] });
}

test("the servers' descriptions are the fold's, the rows' and the checkbox's; no paragraph is left", async () => {
    const tree = await render();
    assert.equal(findIn(tree, node => node.type === "setup").props.desc, "speech_servers.help");
    const rows = all(tree, node => node.type === "form-row").map(node => [node.props.label, node.props.description]);
    assert.deepEqual(rows, [
        // Which GPUs the choices use, then what "CPU" runs on this platform.
        ["speech_servers.device", "speech_servers.device_help\nspeech_servers.cpu_build_separate"],
        ["speech_servers.diarization_model", "speech_servers.diarization_help"],
        ["speech_servers.device", "speech_servers.device_help\nspeech_servers.cpu_build_separate"],
    ]);
    const check = findIn(tree, node => node.type === "hint-check").props;
    assert.deepEqual([check.label, check.description, check.checked], ["speech_servers.low_latency", "speech_servers.low_latency_help", false]);
    assert.ok(!find(tree, node => node.type === "description"));
});

test("a device row has no description to show when nothing applies; the missing GPU build stays a warning", async () => {
    const tree = await render({ cpuBuild: "none", gpuBuild: "unavailable", devices: [] });
    assert.equal(findIn(tree, node => node.type === "form-row" && node.props.label === "speech_servers.device").props.description, undefined);
    const warnings = all(tree, node => node.type === "readout" && node.props.tone === "warning");
    assert.equal(warnings.length, 2, "one per server");
    assert.equal(findIn(warnings[0], node => node.type === "p").props.children, "speech_servers.gpu_build_unavailable");
});

// A server's paths are the kit's monospaced fields, start and stop are the kit's primary and quiet
// buttons, and reload is its plain button. Each waits as before: start for a saved model (and the
// VAD model for speech recognition), stop for something to stop, reload for no unsaved edit.
interface Server { state?: Record<string, unknown>; pending?: Record<string, unknown>; dirty?: boolean; saving?: boolean;
    model?: string; vad?: string }
async function server({ state = {}, pending = {}, dirty = false, saving = false, model = "m.gguf", vad = "v.gguf" }: Server) {
    const runtime = hooks(), sent: [string, unknown][] = [], edits: unknown[] = [];
    const profile = { model, voice_file: "", vad_model: vad, diarization_model: "", device: "auto", low_latency: false };
    const settings = { profiles: { japanese: { ...profile }, asr: { ...profile } } };
    const { SpeechServers } = await loadModule<typeof import("./SpeechServers.tsx")>(new URL("./SpeechServers.tsx", import.meta.url), runtime, {
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings, state, devices: [],
            builds: { cpu_build: "separate", gpu_build: "ready" }, pending, error: null,
            send: (endpoint: string, body?: unknown) => sent.push([endpoint, body]), updateError() {} }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft: settings, setDraft: (next: unknown) => edits.push(next),
            saving, dirty, submit() {}, navigationDialog: null }) },
        "./ModelDownloads": { ModelDownloads: "downloads", HardwareReadout: "hardware" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model" },
        "../../../../../../logics/common/pathExample": { pathExample: (name: string) => name },
    });
    const tree = runtime.render(SpeechServers, { profiles: ["japanese", "asr"] });
    const buttons = all(tree, node => node.type === kitStandIns.Button);
    const named = (words: string) => buttons.filter(node => node.props.children === words);
    return { tree, sent, edits, named, fields: all(tree, node => node.type === kitStandIns.TextField) };
}

test("a server's paths are the kit's monospaced fields, and they wait while the server is busy", async () => {
    const idle = await server({ state: { japanese: { state: "stopped", generation: 1 }, asr: { state: "stopped", generation: 2 } } });
    assert.ok(idle.fields.length > 0);
    assert.ok(idle.fields.every(field => field.props.mono === true && field.props.disabled === false && field.props.spellCheck === false));
    assert.ok(idle.fields.some(field => field.props.value === "m.gguf"));
    idle.fields[0].props.onChange({ target: { value: "other.gguf" } });
    assert.equal(idle.edits.length, 1);
    for (const busy of [{ state: { japanese: { state: "ready" }, asr: { state: "ready" } } }, { state: {} },
        { pending: { japanese: true, asr: true }, state: { japanese: { state: "stopped" }, asr: { state: "stopped" } } }]) {
        assert.ok((await server(busy)).fields.every(field => field.props.disabled === true), JSON.stringify(busy));
    }
    // A save that waits leaves the fields usable, so focus stays where it was (#1111).
    const saving = await server({ saving: true, state: { japanese: { state: "stopped" }, asr: { state: "stopped" } } });
    assert.ok(saving.fields.every(field => field.props.disabled === false));
});

test("start, stop and reload are the kit's primary, quiet and plain buttons and wait as before", async () => {
    const stopped = { japanese: { state: "stopped", generation: 7 }, asr: { state: "stopped", generation: 8 } };
    const s = await server({ state: stopped });
    const [start] = s.named("speech_servers.start"), [stop] = s.named("speech_servers.stop"), [reload] = s.named("speech_servers.reload");
    assert.deepEqual([start.props.tone, stop.props.tone, reload.props.tone], ["primary", "quiet", undefined]);
    assert.deepEqual([start.props.disabled, stop.props.disabled, reload.props.disabled], [false, true, false]);
    start.props.onClick();
    reload.props.onClick();
    assert.deepEqual(s.sent.slice(-3), [["/run/start_speech_server", { profile: "japanese", generation: 7 }],
        ["/get/data/speech_server_settings", undefined], ["/get/data/speech_server_state", undefined]]);
    // Running: stop can be pressed and start cannot.
    const running = await server({ state: { japanese: { state: "ready" }, asr: { state: "ready" } } });
    assert.deepEqual([running.named("speech_servers.start")[0].props.disabled, running.named("speech_servers.stop")[0].props.disabled], [true, false]);
    running.named("speech_servers.stop")[0].props.onClick();
    assert.deepEqual(running.sent.at(-1), ["/run/stop_speech_server", { profile: "japanese" }]);
    // A start on its way can be stopped.
    assert.equal((await server({ state: stopped, pending: { japanese: true } })).named("speech_servers.stop")[0].props.disabled, false);
    // An unsaved edit or a save holds start and reload back.
    for (const held of [{ dirty: true }, { saving: true }]) {
        const h = await server({ ...held, state: stopped });
        assert.deepEqual([h.named("speech_servers.start")[0].props.disabled, h.named("speech_servers.reload")[0].props.disabled], [true, true], JSON.stringify(held));
    }
    // No model, or for speech recognition no VAD model, or a cleanup not confirmed: no start.
    assert.equal((await server({ state: stopped, model: " " })).named("speech_servers.start")[0].props.disabled, true);
    const noVad = (await server({ state: stopped, vad: "" })).named("speech_servers.start");
    assert.deepEqual(noVad.map(button => button.props.disabled), [false, true]);
    const cleanup = { ...stopped, japanese: { ...stopped.japanese, error_code: "speech_server_cleanup_unconfirmed" } };
    assert.equal((await server({ state: cleanup })).named("speech_servers.start")[0].props.disabled, true);
});
