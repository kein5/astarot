import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { find, findIn, hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// #1308 ★1 (decided on 2026-11-28): Mic input's and Listening's speech recognition models side by
// side in the speech.cpp part, each chosen among the models on the PC and applied for its input
// alone. ★3: taking a model here selects speech.cpp when no engine is selected.

const row = (id: string, languages: string[] = ["ja"]) => ({ id, target: "asr", name: `${id} name`, speech: { name: id, label: id, type: "q8_0", default: true, languages, detects: false } });
const catalog = { catalog_version: "v7", models: [row("reazon"), row("qwen"), { id: "vad", target: "vad", name: "vad" }] };
const downloaded = { reazon: { model: "/m/reazon.gguf" }, qwen: { model: "/m/qwen.gguf" }, vad: { model: "/m/vad.gguf" } };

async function fixture(context: TestContext) {
    const runtime = hooks(), sent: unknown[][] = [], engines: unknown[] = [];
    const state = {
        server: "bundled",
        asr: { model: "/m/reazon.gguf", listening_model: "", vad_model: "/m/vad.gguf" } as Record<string, string>,
        servers: {} as Record<string, { state: string }>,
        jobs: {} as Record<string, { job_id: string; phase: string }>,
        engine: { state: "ok", data: null as string | null },
    };
    const { SourceModels } = await loadModule<typeof import("./SourceModels.tsx")>(new URL("./SourceModels.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, values?: object) => values ? `${key} ${JSON.stringify(values)}` : key }) },
        "@logics_configs": { useTranscription: () => ({ currentSelectedTranscriptionEngine: state.engine,
            setSelectedTranscriptionEngine: (engine: unknown) => engines.push(engine) }) },
        "../../../../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => ({ settings: { server: state.server } }) },
        "../../../../../../logics/voice/useSpeechServers": { useSpeechServers: () => ({ settings: { version: 1, profiles: { asr: state.asr } },
            state: state.servers, send: (...args: unknown[]) => sent.push(["speech", ...args]) }) },
        "../../../../../../logics/voice/useModelDownloads": { useModelDownloads: () => ({ catalog, state: { jobs: state.jobs, downloaded },
            send: (...args: unknown[]) => sent.push(args) }) },
        "../../../../../../logics/transcription/listeningModel": await import("../../../../../../logics/transcription/listeningModel.ts"),
        "../../../../../../logics/voice/modelCatalog": { familyLabel: (entry: { speech?: { label?: string } }) => entry.speech?.label },
        "../advanced_settings/VoiceSettings.css.ts": { container: "container" },
        "../_components/form_row/FormRow": { FormRow: "form-row" },
    });
    context.onTestFinished(() => runtime.unmount());
    const draw = () => runtime.render(SourceModels);
    const select = (tree: TreeNode | null, label: string) => findIn(tree, node => node.type === "select" && node.props["aria-label"] === label);
    const options = (node: TreeNode) => nodesIn(node).filter(child => child.type === "option").map(child => [child.props.value, child.props.children]);
    return { state, sent, engines, draw, select, options };
}

const MIC = "source_models.mic", LISTENING = "realtime.listening_model";

test("the two models sit side by side on the bundled server, each with the models on the PC", async context => {
    const s = await fixture(context);
    const tree = s.draw();
    assert.equal(tree?.props["data-setting-id"], "source_models", "where the settings search leads (N-13)");
    const mic = s.select(tree, MIC), listening = s.select(tree, LISTENING);
    assert.deepEqual([mic.props.value, s.options(mic)], ["reazon", [["reazon", "reazon name"], ["qwen", "qwen name"]]]);
    assert.deepEqual([listening.props.value, s.options(listening)],
        ["", [["", `realtime.listening_same_named {"model":"reazon"}`], ["qwen", "qwen name"]]], "one model for both at first");
    // Each row is where the search and the dialogs lead.
    assert.ok(find(tree, node => node.props?.["data-setting-id"] === "source_model_mic"));
    assert.ok(find(tree, node => node.props?.["data-setting-id"] === "source_model_speaker"));
    // A server of one's own serves its own model: nothing to choose here.
    s.state.server = "external";
    assert.equal(s.draw(), null);
});

test("a file of one's own is named so, and no model set says so", async context => {
    const s = await fixture(context);
    s.state.asr = { ...s.state.asr, model: "/own/mine.gguf", listening_model: "/own/theirs.gguf" };
    let tree = s.draw();
    assert.deepEqual(s.options(s.select(tree, MIC))[0], ["/own/mine.gguf", "realtime.listening_own_file"]);
    assert.equal(s.select(tree, LISTENING).props.value, "/own/theirs.gguf");
    s.state.asr = { ...s.state.asr, model: "", listening_model: "" };
    tree = s.draw();
    assert.deepEqual([s.select(tree, MIC).props.value, s.options(s.select(tree, MIC))[0]], ["", ["", "source_models.unset"]]);
});

test("a choice is checked, then applied for its input alone", async context => {
    const s = await fixture(context);
    s.select(s.draw(), MIC).props.onChange({ target: { value: "qwen" } });
    assert.deepEqual(s.sent.at(-1), ["/run/check_model_download", { id: "qwen", catalog_version: "v7" }]);
    assert.equal(s.select(s.draw(), MIC).props.disabled, true, "waits for its check");
    s.state.jobs = { qwen: { job_id: "q1", phase: "ready" } };
    s.draw(); s.draw();
    assert.deepEqual(s.sent.at(-1), ["/run/apply_model_download", { id: "qwen", job_id: "q1", expected: { model: "/m/reazon.gguf" } }], "Mic input's: no source");
    s.select(s.draw(), LISTENING).props.onChange({ target: { value: "qwen" } });
    s.state.jobs = { qwen: { job_id: "q2", phase: "ready" } };
    s.draw(); s.draw();
    assert.deepEqual(s.sent.at(-1), ["/run/apply_model_download", { id: "qwen", job_id: "q2", expected: { model: "" }, source: "speaker" }]);
    // Back to one model for both: Listening's own model is taken away.
    s.state.asr = { ...s.state.asr, listening_model: "/m/qwen.gguf" };
    s.select(s.draw(), LISTENING).props.onChange({ target: { value: "" } });
    assert.deepEqual(s.sent.at(-1), ["speech", "/set/data/speech_server_settings", { version: 1, profiles: { asr: { ...s.state.asr, listening_model: "" } } }]);
});

test("while an ASR server runs, the models wait and say why", async context => {
    const s = await fixture(context);
    for (const name of ["asr", "asr_listening"]) {
        s.state.servers = { [name]: { state: "ready" } };
        const tree = s.draw();
        assert.deepEqual([s.select(tree, MIC).props.disabled, s.select(tree, LISTENING).props.disabled], [true, true], name);
        const help = findIn(tree, node => node.type === "form-row" && node.props.label === MIC).props.description;
        assert.ok(String(help).split("\n").includes("source_models.running"), name);
    }
    s.state.servers = { asr: { state: "stopped" } };
    assert.equal(s.select(s.draw(), MIC).props.disabled, false);
});

test("a model that comes to be set selects speech.cpp when no engine is selected (★3)", async context => {
    const s = await fixture(context);
    s.state.asr = { ...s.state.asr, model: "" };
    s.draw();
    assert.deepEqual(s.engines, [], "nothing on opening the page");
    s.state.asr = { ...s.state.asr, model: "/m/qwen.gguf" };
    s.draw(); s.draw();
    assert.deepEqual(s.engines, ["SpeechCpp"]);
    // An engine chosen already is left as it is.
    const chosen = await fixture(context);
    chosen.state.engine = { state: "ok", data: "Groq_Whisper" };
    chosen.state.asr = { ...chosen.state.asr, model: "" };
    chosen.draw();
    chosen.state.asr = { ...chosen.state.asr, model: "/m/qwen.gguf" };
    chosen.draw();
    assert.deepEqual(chosen.engines, []);
    // A model set already when the page opens selects nothing.
    const set = await fixture(context);
    set.draw(); set.draw();
    assert.deepEqual(set.engines, []);
});
