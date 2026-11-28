import assert from "node:assert/strict";
import { Children } from "react";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn, kitStandIns, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

const all = (tree: unknown, predicate: (node: TreeNode) => boolean) => nodesIn(tree).filter(predicate);
// The elements straight inside a node, as React keeps them (no false or null).
const childrenOf = (node: TreeNode) => Children.toArray(node.props.children).map(child => treeNode(child)).filter(child => child !== null);
// The box under a server group's legend, which holds everything else of the group (#1403).
const boxOf = (group: TreeNode) => {
    const box = childrenOf(group).find(node => node.props.className === "group_content");
    assert.ok(box, "the group holds a box under its legend");
    return box;
};

// #614: the speech.cpp servers' descriptions go to the parts that show them as hints on a reviewed
// page (the fold's title, a row's label, the checkbox's name); the readouts and warnings stay.
interface Options {
    cpuBuild?: string;
    gpuBuild?: string;
    devices?: { kind: string; name: string; label: string }[];
}

async function render({ cpuBuild = "separate", gpuBuild = "ready", devices = [{ kind: "gpu", name: "gpu0", label: "GPU" }] }: Options = {},
    props: { needed?: boolean; embedded?: boolean } = {}) {
    const runtime = hooks();
    const profile = { model: "", voice_file: "", vad_model: "", diarization_model: "", device: "auto", low_latency: false };
    const settings = { profiles: { japanese: { ...profile }, asr: { ...profile } } };
    const { SpeechServers } = await loadModule<typeof import("./SpeechServers.tsx")>(new URL("./SpeechServers.tsx", import.meta.url), runtime, {
        "../../../../../../logics/transcription/listeningModel": await import("../../../../../../logics/transcription/listeningModel.ts"),
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings, state: {}, devices,
            builds: { cpu_build: cpuBuild, gpu_build: gpuBuild }, pending: {}, error: null, send() {}, updateError() {} }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft: settings, setDraft() {}, saving: false, dirty: false, submit() {}, navigationDialog: null }) },
        "./ModelDownloads": { ModelDownloads: "downloads", HardwareReadout: "hardware" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/path_field/PathField": { PathField: "path-field" },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model" },
        "../_components/fold/Fold": { Fold: "fold" },
        "../../../../../../logics/common/pathExample": { pathExample: (name: string) => name },
    });
    return runtime.render(SpeechServers, { profiles: ["japanese", "asr"], ...props });
}

test("the servers' descriptions are the fold's, the rows' and the checkbox's; no paragraph is left", async () => {
    const tree = await render();
    assert.equal(findIn(tree, node => node.type === "setup").props.desc, "speech_servers.help");
    const rows = all(tree, node => node.type === "form-row").map(node => [node.props.label, node.props.description]);
    assert.deepEqual(rows, [
        // Each path is a row of its own (#1231); which GPUs the choices use, then what "CPU" runs on this platform.
        ["speech_servers.model", undefined], ["speech_servers.voice_file", undefined],
        ["speech_servers.device", "speech_servers.device_help\nspeech_servers.cpu_build_separate"],
        ["speech_servers.model", undefined], ["speech_servers.vad_model", undefined],
        ["speech_servers.diarization_model", "speech_servers.diarization_help"],
        ["speech_servers.device", "speech_servers.device_help\nspeech_servers.cpu_build_separate"],
    ]);
    const check = findIn(tree, node => node.type === "hint-check").props;
    assert.deepEqual([check.label, check.description, check.checked], ["speech_servers.low_latency", "speech_servers.low_latency_help", false]);
    assert.ok(!find(tree, node => node.type === "description"));
});

// #1230: the page says when its feature needs a model set here, and the fold starts open then. On
// the TTS page the servers sit inside the voice settings' section, which frames them.
test("the fold is needed as the page says, and an embedded part has no frame of its own", async () => {
    const plain = await render();
    assert.equal(findIn(plain, node => node.type === "setup").props.needed, false);
    assert.equal(plain.props.className, "container");
    const embedded = await render({}, { needed: true, embedded: true });
    assert.equal(findIn(embedded, node => node.type === "setup").props.needed, true);
    assert.deepEqual([embedded.type, embedded.props.className, embedded.props["aria-label"]], ["section", undefined, "speech_servers.title"]);
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
    model?: string; vad?: string; listening?: string }
async function server({ state = {}, pending = {}, dirty = false, saving = false, model = "m.gguf", vad = "v.gguf", listening = "" }: Server) {
    const runtime = hooks(), sent: [string, unknown][] = [], edits: unknown[] = [];
    const profile = { model, voice_file: "", vad_model: vad, diarization_model: "", device: "auto", low_latency: false };
    const settings = { profiles: { japanese: { ...profile }, asr: { ...profile, listening_model: listening } } };
    const { SpeechServers } = await loadModule<typeof import("./SpeechServers.tsx")>(new URL("./SpeechServers.tsx", import.meta.url), runtime, {
        // A label that carries a server's state shows it, so each readout says whose state is whose.
        "@useI18n": { useI18n: () => ({ t: (key: string, values?: { state?: string }) => values?.state ? `${key} ${values.state}` : key }) },
        "../../../../../../logics/transcription/listeningModel": await import("../../../../../../logics/transcription/listeningModel.ts"),
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings, state, devices: [],
            builds: { cpu_build: "separate", gpu_build: "ready" }, pending, error: null,
            send: (endpoint: string, body?: unknown) => sent.push([endpoint, body]), updateError() {} }) },
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({ draft: settings, setDraft: (next: unknown) => edits.push(next),
            saving, dirty, submit() {}, navigationDialog: null }) },
        "./ModelDownloads": { ModelDownloads: "downloads", HardwareReadout: "hardware" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/setup_section/SetupSection": { SetupSection: "setup" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
        "../_components/path_field/PathField": { PathField: "path-field" },
        "../_components/hint/HintCheck": { HintCheck: "hint-check" },
        "../_components/custom_model_link/CustomModelLink": { CustomModelLink: "custom-model" },
        "../_components/fold/Fold": { Fold: "fold" },
        "../../../../../../logics/common/pathExample": { pathExample: (name: string) => name },
    });
    const tree = runtime.render(SpeechServers, { profiles: ["japanese", "asr"] });
    const buttons = all(tree, node => node.type === kitStandIns.Button);
    const named = (words: string) => buttons.filter(node => node.props.children === words);
    // A row's readouts (0 Japanese TTS, 1 ASR + VAD): each one's first line, the state, and its tone.
    const readoutsOf = (index: number) => all(all(tree, node => node.type === "fieldset")[index], node => node.type === "readout")
        .map(node => [findIn(node, child => child.type === "p").props.children, node.props.tone]);
    const setup = findIn(tree, node => node.type === "setup").props;
    // The starts and stops sent, without the page's reads.
    const runs = () => sent.filter(([endpoint]) => endpoint.startsWith("/run/"));
    return { tree, sent, runs, edits, named, fields: all(tree, node => node.type === "path-field"), readouts: readoutsOf(1), readoutsOf,
        summary: setup.status, attention: setup.attention };
}

// #1231: each path is a path field, the kit's monospaced field with the button that picks a GGUF
// file beside it; a picked path is an edit, as a typed one is.
test("a server's paths are path fields that pick GGUF files, and they wait while the server is busy", async () => {
    const idle = await server({ state: { japanese: { state: "stopped", generation: 1 }, asr: { state: "stopped", generation: 2 } } });
    assert.deepEqual(idle.fields.map(field => field.props.label), ["speech_servers.model", "speech_servers.voice_file",
        "speech_servers.model", "speech_servers.vad_model", "speech_servers.diarization_model"]);
    assert.ok(idle.fields.every(field => field.props.disabled === false && field.props.maxLength === 4096));
    assert.ok(idle.fields.every(field => JSON.stringify(field.props.pick) === JSON.stringify({ kind: "file", extensions: ["gguf"] })));
    assert.ok(idle.fields.some(field => field.props.value === "m.gguf"));
    idle.fields[0].props.onChange("other.gguf");
    assert.equal(idle.edits.length, 1);
    for (const busy of [{ state: { japanese: { state: "ready" }, asr: { state: "ready" } } }, { state: {} },
        { pending: { japanese: true, asr: true }, state: { japanese: { state: "stopped" }, asr: { state: "stopped" } } }]) {
        assert.ok((await server(busy)).fields.every(field => field.props.disabled === true), JSON.stringify(busy));
    }
    // A save that waits leaves the fields usable, so focus stays where it was (#1111).
    const saving = await server({ saving: true, state: { japanese: { state: "stopped" }, asr: { state: "stopped" } } });
    assert.ok(saving.fields.every(field => field.props.disabled === false));
});

// #1266 (decided on 2026-11-27): in each server group the default models' download comes first,
// and the paths of a model of one's own follow in a closed fold, with the guide to them.
test("each server group offers the default models first and keeps the paths of one's own in a closed fold", async () => {
    const s = await server({ state: { japanese: { state: "stopped", generation: 1 }, asr: { state: "stopped", generation: 2 } } });
    const groups = all(s.tree, node => node.type === "fieldset");
    assert.equal(groups.length, 2);
    for (const [group, name] of groups.map((group, i) => [group, ["japanese", "asr"][i]] as const)) {
        const parts = Children.toArray(boxOf(group).props.children).map(child => treeNode(child)?.type);
        assert.ok(parts.indexOf("downloads") >= 0 && parts.indexOf("downloads") < parts.indexOf("fold"), name);
        const fold = all(group, node => node.type === "fold")[0];
        assert.deepEqual([fold.props.summary, fold.props.size, fold.props.open, fold.props["data-own-model"]], ["speech_servers.own_model", "link", undefined, name]);
        assert.equal(all(fold, node => node.type === "custom-model").length, 1, "the guide to one's own model");
        assert.deepEqual(all(fold, node => node.type === "path-field").map(field => field.props.label),
            name === "asr" ? ["speech_servers.model", "speech_servers.vad_model", "speech_servers.diarization_model"] : ["speech_servers.model", "speech_servers.voice_file"]);
    }
    // No path field and no guide outside the folds.
    assert.equal(all(s.tree, node => node.type === "path-field").length, 5);
    assert.equal(all(s.tree, node => node.type === "custom-model").length, 2);
});

test("a TTS server's start, stop and reload are the kit's primary, quiet and plain buttons and wait as before", async () => {
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
    // No model, or a cleanup not confirmed: no start.
    assert.equal((await server({ state: stopped, model: " " })).named("speech_servers.start")[0].props.disabled, true);
    const cleanup = { ...stopped, japanese: { ...stopped.japanese, error_code: "speech_server_cleanup_unconfirmed" } };
    assert.equal((await server({ state: cleanup })).named("speech_servers.start")[0].props.disabled, true);
});

// #1396 (decided on 2026-11-28): with a model of Listening's own, the ASR + VAD row runs two servers,
// Mic input's and Listening's own (#1242). The state shows each, with whose it is, so that
// Listening's running server is not read as stopped; each failure is said under its own readout;
// and the row's paths wait while either server runs. With one model for both, the row is Mic
// input's server as before, but Listening's server that still runs is shown.
test("the state of the ASR + VAD row shows each recognition server it runs", async () => {
    const stopped = { japanese: { state: "stopped", generation: 7 }, asr: { state: "stopped", generation: 8 }, asr_listening: { state: "stopped", generation: 3 } };
    const s = await server({ state: stopped, listening: "l.gguf" });
    assert.deepEqual(s.readouts, [["speech_servers.state_of_asr speech_servers.state_stopped", "neutral"],
        ["speech_servers.state_of_asr_listening speech_servers.state_stopped", "neutral"]]);
    assert.equal(s.summary, "speech_servers.japanese: speech_servers.model_set · speech_servers.state_stopped / speech_servers.asr: " +
        "speech_servers.model_set · speech_servers.state_of_asr speech_servers.state_stopped · speech_servers.state_of_asr_listening speech_servers.state_stopped");
    assert.equal(s.attention, false, "nothing to fix");
    // A start on its way says so, and a server the state does not list yet is not confirmed.
    const asked = await server({ state: { ...stopped, asr_listening: undefined }, pending: { asr: { generation: 8 } }, model: "", listening: "l.gguf" });
    assert.deepEqual(asked.readouts, [["speech_servers.state_of_asr speech_servers.state_pending", "warning"],
        ["speech_servers.state_of_asr_listening speech_servers.state_unknown", "neutral"]]);
    assert.match(asked.summary, /speech_servers\.asr: speech_servers\.model_unset · /);

    // Listening's server runs alone, as its switch started it: the state says so and the paths wait.
    const listening = await server({ state: { ...stopped, asr_listening: { state: "ready", generation: 4 } }, listening: "l.gguf" });
    assert.deepEqual(listening.readouts, [["speech_servers.state_of_asr speech_servers.state_stopped", "neutral"],
        ["speech_servers.state_of_asr_listening speech_servers.state_ready", "active"]]);
    assert.ok(listening.fields.slice(2).every(field => field.props.disabled === true), "the asr row's paths wait while one of its servers runs");

    // Listening's failure is said in its own words, under its own readout, and holds the fold open.
    const failed = await server({ state: { ...stopped, asr: { state: "ready", generation: 9 },
        asr_listening: { state: "failed", generation: 4, error_code: "speech_server_out_of_memory" } }, listening: "l.gguf" });
    assert.deepEqual(failed.readouts, [["speech_servers.state_of_asr speech_servers.state_ready", "active"],
        ["speech_servers.state_of_asr_listening speech_servers.state_failed", "failed"]]);
    const asrGroup = all(failed.tree, node => node.type === "fieldset")[1];
    const parts = all(asrGroup, node => node.type === "readout" || node.props?.role === "alert")
        .map(node => node.type === "readout" ? "readout" : node.props.children);
    // In its switch's words, which turn the switch on again, before the server's own (#1396).
    assert.deepEqual(parts, ["readout", "readout", ["realtime_toggle.speech_server_out_of_memory", "speech_servers.errors.speech_server_out_of_memory"]]);
    assert.equal(findIn(failed.tree, node => node.type === "setup").props.attention, true);

    for (const shared of ["", "m.gguf"]) {
        const one = await server({ state: stopped, listening: shared });
        assert.deepEqual(one.readouts, [["speech_servers.state_stopped", "neutral"]], shared);
        assert.match(one.summary, /speech_servers\.asr: speech_servers\.model_set · speech_servers\.state_stopped$/);
    }
    const left = await server({ state: { ...stopped, asr_listening: { state: "ready", generation: 4 } } });
    assert.deepEqual(left.readouts, [["speech_servers.state_of_asr speech_servers.state_stopped", "neutral"],
        ["speech_servers.state_of_asr_listening speech_servers.state_ready", "active"]]);
    assert.deepEqual(left.readoutsOf(0), [["speech_servers.state_stopped", "neutral"]], "the TTS row is its own server alone");

    // Moved under each readout, a server's own lines stay: the low-latency standby, a notice, and
    // the standby's failure.
    const standby = await server({ state: { ...stopped, japanese: { state: "ready", generation: 7, notice: "speech_server_cpu_fallback",
        low_latency: { state: "ready", error_code: "speech_server_low_latency_failed" } } } });
    const japanese = all(standby.tree, node => node.type === "fieldset")[0];
    assert.deepEqual(all(findIn(japanese, node => node.type === "readout"), node => node.type === "p").map(node => node.props.children),
        ["speech_servers.state_ready", "speech_servers.low_latency_ready", "speech_servers.notices.speech_server_cpu_fallback"]);
    assert.deepEqual(all(japanese, node => node.props?.role === "alert").map(node => node.props.children), ["speech_servers.low_latency_failed"]);
    assert.equal(standby.attention, true);
});

// #1403: what a server group holds comes and goes with its servers (Listening's own server, a
// failure, the low-latency standby's failure), always inside the one box under the legend.
// Chromium dropped the layout of the catalog in the group when Listening's state was added straight
// into the <fieldset> (tests/integration/speechServerCatalog.spec.ts).
test("a server group holds its legend and one box, whatever its servers do", async () => {
    const stopped = { japanese: { state: "stopped", generation: 7 }, asr: { state: "stopped", generation: 8 } };
    const cases = [
        await server({ state: stopped }),
        await server({ state: { ...stopped, asr_listening: { state: "stopped", generation: 3 } }, listening: "l.gguf" }),
        await server({ state: { japanese: { state: "ready", generation: 7, low_latency: { state: "ready", error_code: "speech_server_low_latency_failed" } },
            asr: { state: "failed", generation: 8, error_code: "speech_server_out_of_memory" },
            asr_listening: { state: "failed", generation: 3, error_code: "speech_server_out_of_memory" } }, listening: "l.gguf" }),
    ];
    for (const [index, { tree }] of cases.entries()) {
        const groups = all(tree, node => node.type === "fieldset");
        assert.equal(groups.length, 2);
        for (const group of groups) {
            assert.deepEqual(childrenOf(group).map(node => node.type), ["legend", "div"], `case ${index}`);
            assert.ok(all(boxOf(group), node => node.type === "readout").length > 0, "the readouts are in the box");
        }
    }
});

// #1396 (decided on 2026-11-28): the main switches start and stop the speech recognition servers,
// and nothing else does. The ASR + VAD row has no Start or Stop, whatever its servers do; the TTS
// rows keep theirs, as before. Reload stays for the whole fold.
test("the ASR + VAD row has no start or stop; the TTS row keeps them", async () => {
    const states = [{ japanese: { state: "stopped", generation: 7 }, asr: { state: "stopped", generation: 8 } },
        { japanese: { state: "stopped", generation: 7 }, asr: { state: "ready", generation: 9 }, asr_listening: { state: "failed", generation: 3 } }];
    for (const state of states) {
        for (const listening of ["", "l.gguf"]) {
            const s = await server({ state, listening });
            const groups = all(s.tree, node => node.type === "fieldset");
            const named = (group: TreeNode) => all(group, node => node.type === kitStandIns.Button).map(node => node.props.children);
            assert.deepEqual([named(groups[0]), named(groups[1])], [["speech_servers.start", "speech_servers.stop"], []], JSON.stringify({ state, listening }));
            assert.deepEqual(s.named("speech_servers.reload").length, 1);
        }
    }
    // A TTS server's failure keeps the server's own words; its stop waits while it stops.
    const tts = await server({ state: { japanese: { state: "failed", generation: 7, error_code: "speech_server_exited" }, asr: { state: "stopped", generation: 8 } } });
    const japanese = all(tts.tree, node => node.type === "fieldset")[0];
    assert.deepEqual(all(japanese, node => node.props?.role === "alert").map(node => node.props.children), [["speech_servers.errors.speech_server_exited"]]);
    const stopping = await server({ state: { japanese: { state: "stopping", generation: 7 }, asr: { state: "stopped", generation: 8 } } });
    assert.equal(stopping.named("speech_servers.stop")[0].props.disabled, true);
});
