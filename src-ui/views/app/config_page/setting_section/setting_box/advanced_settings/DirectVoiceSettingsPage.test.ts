import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { eventTarget, find, findIn, hooks, loadModule, nodesIn, stubGlobals, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as routeState from "../../../../../../logics/voice/routeState.ts";
import * as rvcStartOptions from "../../../../../../logics/voice/rvcStartOptions.ts";
import * as directVoiceDraft from "../../../../../../logics/voice/directVoiceDraft.ts";
import * as draftRebase from "../../../../../../logics/voice/draftRebase.ts";
import * as voiceErrorText from "../../../../../../logics/voice/voiceErrorText.ts";
import * as voiceAudition from "../../../../../../logics/voice/voiceAudition.ts";
import * as conversionLatency from "../../../../../../logics/voice/conversionLatency.ts";
import * as fileDrop from "../../../../../../logics/common/fileDrop.ts";
import { changedPaths } from "../../../../../../logics/voice/saveBar.ts";
import type { SaveBarEntry } from "../../../../../../logics/voice/saveBar.ts";
import type { DirectVoiceSettingsProps } from "./DirectVoiceSettings.tsx";

// The direct voice form (DirectVoiceSettings.tsx) drawn with the real settings draft and the real
// rules it applies: which route the input needs, how the saved settings become the form, the RVC
// worker's options and devices, the conversion's delay and the voice error sentences. The voice
// hook is a stand-in that holds the state the test gives and records what the form sends; the
// shared parts are stand-ins that keep their props.

// Keys a test takes out of the locale, as missing translations.
const missingKeys = new Set<string>();
const t = (key: string, variables?: Record<string, unknown>) => {
    const { defaultValue, ...values } = variables ?? {};
    if (key.includes("absent") || missingKeys.has(key)) return String(defaultValue ?? key);
    return Object.keys(values).length ? `${key} ${JSON.stringify(values)}` : key;
};
type Variant = NonNullable<DirectVoiceSettingsProps["variant"]>;

// Saved RVC settings: converted RVC with a runtime and a model.
const rvcSaved = { mode: "converted", engine: "rvc", runtime: "", reference: "", rvc_runtime: "/rvc", rvc_model: "voice.pth",
    rvc_index: "", rvc_pitch: 0, rvc_index_rate: 0, rvc_device: "auto", rvc_threads: 0, rvc_highpass: true };
const microphone = { id: "mic-1", label: "Microphone" };

interface Voice {
    settings: Record<string, unknown> | null;
    route: Record<string, unknown>;
    error: string | null;
    directState: Record<string, unknown>;
    directOwner: string | null;
    directPending: unknown;
    directSources: { sources?: { id: string; label: string }[]; error?: string | null };
    directError: string | null;
    selectedSource: string;
}


// The pages a test opened, closed together when it ends.
const pagesByTest = new WeakMap<TestContext, HookRuntime[]>();
function closeWithTest(context: TestContext, runtime: HookRuntime) {
    const pages = pagesByTest.get(context);
    if (pages) { pages.push(runtime); return; }
    const opened = [runtime];
    pagesByTest.set(context, opened);
    context.onTestFinished(() => { for (const page of opened) page.unmount(); });
}

async function directVoice(context: TestContext, given: Partial<Voice> = {}, options: { directml?: boolean; known?: string[]; send?: (endpoint: string, value?: unknown) => unknown } = {}) {
    const runtime = hooks(), sent: unknown[][] = [], blocked: boolean[] = [], errors: unknown[] = [], entries = new Map<string, SaveBarEntry>();
    // Every page of the test is closed before the stand-in window goes: the settings draft guards
    // leaving a page with edits through it.
    closeWithTest(context, runtime);
    stubGlobals(context, { window: eventTarget() });
    const voice: Voice = { settings: { routing: "managed", monitor: "off" }, route: { ready: true }, error: null,
        directState: { observation_id: "1", settings: rvcSaved }, directOwner: null, directPending: null,
        directSources: { sources: [microphone] }, directError: null, selectedSource: "mic-1", ...given };
    const send = (endpoint: string, value?: unknown) => {
        sent.push(value === undefined ? [endpoint] : [endpoint, value]);
        if (options.send) return options.send(endpoint, value);
        return endpoint === "/set/data/direct_voice_settings" ? Promise.resolve({ status: 200, result: { settings: value } }) : true;
    };
    const hook = { send, updateDirectError: (code: unknown) => { errors.push(code); }, setDirectDraftBlocked: (value: boolean) => { blocked.push(value); },
        setSelectedSource: (value: string) => { sent.push(["select", value]); voice.selectedSource = value; } };
    // The kit's Button and TextField as the elements they stand for, with the props the page gives
    // them: a field marked wrong carries `invalid`, which the kit turns into aria-invalid.
    const ui = { "../../../../../kit/index.ts": { Button: "button", TextField: "input" }, "@useI18n": { useI18n: () => ({ t, i18n: { exists: (name: string) => (options.known ?? []).includes(name) } }) } };
    const { useSettingsDraft } = await loadModule<typeof import("../../../../../../logics/voice/useSettingsDraft.tsx")>(new URL("../../../../../../logics/voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        ...ui, "./draftRebase": draftRebase,
        "./saveBar": { changedPaths, setSaveBarEntry: (id: string, entry: SaveBarEntry | null) => { if (entry) entries.set(id, entry); else entries.delete(id); } },
    });
    // The form saves by itself (#1111): the tests read the form where they read the save bar's
    // entry, and save it as focus leaving it does.
    let last: { value: ReturnType<typeof useSettingsDraft>; saved: unknown; canSave: unknown } | undefined;
    const drafts = { useSettingsDraft: (...args: Parameters<typeof useSettingsDraft>) => {
        const value = useSettingsDraft(...args);
        last = { value, saved: args[0], canSave: args[3]?.canSave };
        return value;
    } };
    const module = await loadModule<typeof import("./DirectVoiceSettings.tsx")>(new URL("./DirectVoiceSettings.tsx", import.meta.url), runtime, { ...ui,
        "../../../../../../logics/voice/useSettingsDraft": drafts,
        "../../../../../../logics/voice/routeState": routeState,
        "../../../../../../logics/voice/directVoiceDraft": directVoiceDraft,
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ ...voice, ...hook }), sourceKey: (value: unknown) => value },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route-summary", VoiceRouteControls: "route-controls" },
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
        "../../../../../../logics/common/fileDrop": fileDrop,
        "../../../../../../logics/voice/conversionLatency": conversionLatency,
        "../../../../../../logics/common/pathExample": { pathExample: (file: string) => `/path/${file}` },
        "../../../../../../logics/voice/rvcStartOptions": rvcStartOptions,
        "../../../../../../logics/voice/useVcRuntimes": { useVcRuntimes: () => ({ catalog: options.directml ? { runtimes: [{ id: rvcStartOptions.DIRECTML_RUNTIME }] } : { runtimes: [] } }) },
        "../../../../../../logics/voice/voiceAudition": voiceAudition,
        "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorText,
    });
    let props: DirectVoiceSettingsProps = { variant: "all" };
    const draw = (next: Partial<DirectVoiceSettingsProps> = {}) => {
        props = { ...props, ...next };
        return runtime.render(module.DirectVoiceSettings, props);
    };
    // The first drawing makes the draft from the saved settings; the second shows it.
    const open = (next: Partial<DirectVoiceSettingsProps> = {}) => { draw(next); return draw(); };
    const entry = () => {
        assert.ok(last, "the form");
        const { value, saved: savedNow, canSave } = last;
        const before: Record<string, unknown> = savedNow && typeof savedNow === "object" ? { ...savedNow } : {};
        const draft: Record<string, unknown> = value.draft && typeof value.draft === "object" ? { ...value.draft } : {};
        return { changes: [...new Set([...Object.keys(before), ...Object.keys(draft)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(draft[key])),
            canSave: typeof canSave === "function" ? !!canSave(value.draft) : canSave !== false,
            save: async () => { value.commit(); for (let i = 0; i < 10; i++) await Promise.resolve(); }, discard: () => value.discard() };
    };
    return { runtime, voice, hook, sent, blocked, errors, draw, open, entry };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const ofType = (tree: unknown, type: string) => nodesIn(tree).filter(node => node.type === type);
const texts = (tree: unknown, type: string) => ofType(tree, type).map(textOf);
const buttonNamed = (tree: unknown, words: string) => findIn(tree, node => node.type === "button" && textOf(node) === words, `the button ${words}`);
const inputNamed = (tree: unknown, words: string) => {
    const label = findIn(tree, node => node.type === "label" && [node.props.children].flat()[0] === words, `the field ${words}`);
    return findIn(label, node => node.type === "input" || node.type === "select");
};
const selectNamed = (tree: unknown, name: string) => findIn(tree, node => node.type === "select" && node.props["aria-label"] === name, `the list ${name}`);
const choose = (tree: unknown, name: string, value: string) => selectNamed(tree, name).props.onChange({ target: { value } });
const alerts = (tree: unknown) => ofType(tree, "p").filter(node => node.props.role === "alert").map(textOf);
// Whether Start can be pressed, and the line its button points to: what it waits for. While the
// input runs that line is not shown ("hidden").
const startReason = (tree: TreeNode) => {
    const start = buttonNamed(tree, "voice.input_start");
    const id = start.props["aria-describedby"];
    const line = id === undefined ? null : find(tree, node => node.type === "p" && node.props.id === id);
    return { disabled: start.props.disabled, reason: id === undefined ? null : line ? textOf(line) : "hidden" };
};
const classesOf = (node: TreeNode) => String(node.props.className ?? "").split(" ").filter(Boolean);

test("before the saved settings arrive the form says the input is unknown; it asks for the settings, the inputs and the state", async context => {
    const v = await directVoice(context, { directState: {} });
    const tree = v.open();
    assert.deepEqual([tree.type, tree.props.role, textOf(tree)], ["p", "status", "voice.input_unknown"]);
    assert.deepEqual(v.sent, [["/get/data/voice_settings"], ["/get/data/direct_voice_sources"], ["/get/data/direct_voice_state"]]);
    v.draw();
    assert.equal(v.sent.length, 3, "drawn again, nothing is asked twice");
});

test("the form keeps the main screen's direct voice switch waiting while it has unsaved edits, and lets go when it closes", async context => {
    const v = await directVoice(context);
    v.open();
    assert.deepEqual(v.blocked, [false]);
    inputNamed(v.draw(), "voice.vc_rvc_pitch").props.onChange({ target: { valueAsNumber: 5 } });
    v.draw();
    assert.deepEqual(v.blocked, [false, false, true]);
    v.runtime.unmount();
    assert.equal(v.blocked.at(-1), false);
});

test("the status line says what the input does now, with the tone of that state", async context => {
    const cases: [Record<string, unknown>, unknown, string, string][] = [
        [{}, null, "voice.input_unknown", "idle"],
        [{ observation_id: "1", error: "boom" }, null, "voice.input_failed", "failed"],
        [{ observation_id: "1" }, { id: "x" }, "voice.input_pending", "pending"],
        [{ observation_id: "1", pending: true }, null, "voice.input_pending", "pending"],
        [{ observation_id: "1", stopping: true }, null, "voice.input_pending", "pending"],
        [{ observation_id: "1", active: true, mode: "passthrough" }, null, "voice.input_active", "active"],
        [{ observation_id: "1", active: true, mode: "converted", conversion_state: "idle" }, null, "voice.vc_idle", "active"],
        [{ observation_id: "1", active: true, mode: "converted", conversion_verified: true }, null, "voice.vc_active", "active"],
        [{ observation_id: "1", active: true, mode: "converted" }, null, "voice.vc_ready", "active"],
        [{ observation_id: "1" }, null, "voice.input_stopped", "idle"],
    ];
    for (const [state, pending, words, tone] of cases) {
        const v = await directVoice(context, { directState: { settings: rvcSaved, ...state }, directPending: pending });
        const line = findIn(v.open(), node => node.type === "status");
        assert.deepEqual([textOf(line), line.props.tone], [words, tone], JSON.stringify(state));
    }
});

test("while RVC converts on the RVC page, a line says on which device and how far behind the voice it is", async context => {
    const running = { observation_id: "1", settings: rvcSaved, active: true, mode: "converted", conversion_device: "gpu", conversion_latency_ms: 120, conversion_block_ms: 80, round_trip_ms: 0 };
    const lines = async (state: Record<string, unknown>, owner: string | null) => {
        const v = await directVoice(context, { directState: state, directOwner: owner });
        return texts(v.open({ variant: "rvc" }), "p").filter(line => line.startsWith("voice_ui.rvc_running"));
    };
    assert.deepEqual(await lines(running, "rvc"), [`voice_ui.rvc_running_gpu {"seconds":"0.2"}`]);
    assert.deepEqual(await lines({ ...running, conversion_device: "cpu", conversion_latency_ms: 520 }, "rvc"), [`voice_ui.rvc_running_cpu {"seconds":"0.6"}`]);
    assert.deepEqual(await lines(running, "legacy"), [], "input forwarding runs it: nothing to say here");
    assert.deepEqual(await lines({ ...running, mode: "passthrough" }, "rvc"), []);
});

test("each page names the form its own way, and says what it is for", async context => {
    const v = await directVoice(context);
    const heading = (variant: Variant, subheading = false) => {
        const tree = v.open({ variant, subheading });
        const label = findIn(tree, node => node.type === "heading").props;
        return [tree.props["aria-label"], tree.props["data-setting-id"], label.label, label.sub, label.desc];
    };
    assert.deepEqual(heading("rvc", true), ["config_page.rvc.rvc_settings.label", "rvc_settings", "config_page.rvc.rvc_settings.label", true,
        "voice.vc_rvc_hint\nvoice_ui.rvc_latency_hint\nvoice.input_scope"]);
    assert.deepEqual(heading("legacy"), ["voice.input_title", "direct_voice_settings", "voice.input_title", false, "voice.input_description\nvoice.input_scope"]);
    // The form that edits everything, with RVC saved: what to expect of the conversion too.
    assert.deepEqual(heading("all"), ["voice.input_title", "direct_voice_settings", "voice.input_title", false,
        "voice.input_description\nvoice_ui.rvc_latency_hint\nvoice.input_scope"]);
});

test("the RVC page offers to use RVC while forwarding is saved, and switches only when asked, once at a time", async context => {
    let answer: (value: unknown) => void = () => {};
    const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, mode: "passthrough", rvc_pitch: 3 } } },
        { send: endpoint => endpoint === "/set/data/direct_voice_settings" ? new Promise(resolve => { answer = resolve; }) : true });
    let tree = v.open({ variant: "rvc" });
    const row = findIn(tree, node => node.type === "row" && node.props.label === "voice_ui.select_rvc_label").props;
    assert.deepEqual([row.group, row.description], [true, "voice_ui.select_rvc_pending"]);
    assert.equal(startReason(tree).reason, "voice_ui.start_needs_rvc");
    const button = buttonNamed(tree, "voice_ui.select_rvc");
    assert.equal(button.props.disabled, false);
    v.sent.length = 0;
    const first = button.props.onClick();
    tree = v.draw();
    assert.equal(buttonNamed(tree, "voice_ui.select_rvc").props.disabled, true, "waiting for the answer");
    await buttonNamed(tree, "voice_ui.select_rvc").props.onClick();
    assert.deepEqual(v.sent, [["/set/data/direct_voice_settings", { ...rvcSaved, mode: "converted", engine: "rvc", rvc_pitch: 3 }]], "the saved settings, with RVC selected");
    answer({ status: 200 });
    await first;
    assert.equal(buttonNamed(v.draw(), "voice_ui.select_rvc").props.disabled, false);
    // Saved as RVC already, or on another page: no row.
    const saved = await directVoice(context);
    assert.equal(find(saved.open({ variant: "rvc" }), node => node.props?.label === "voice_ui.select_rvc_label"), null);
    assert.equal(find(saved.open({ variant: "all" }), node => node.props?.label === "voice_ui.select_rvc_label"), null);
});

test("the form says a Seed-VC conversion was moved to RVC, except in input forwarding, and warns when another page's input runs", async context => {
    const moved = await directVoice(context, { directState: { observation_id: "1", settings: rvcSaved, notice: "seed_vc_moved_to_rvc" } });
    const notice = (variant: Variant) => ofType(moved.open({ variant }), "p").filter(node => node.props.role === "status").map(textOf);
    assert.deepEqual(notice("rvc"), ["voice_ui.seed_vc_moved_to_rvc"]);
    assert.deepEqual(notice("all"), ["voice_ui.seed_vc_moved_to_rvc"]);
    assert.deepEqual(notice("legacy"), []);
    // The RVC page's conversion runs: input forwarding cannot be used now, and says so.
    const busy = await directVoice(context, { directState: { observation_id: "1", settings: rvcSaved, active: true, pending: true }, directOwner: "rvc" });
    assert.deepEqual(alerts(busy.open({ variant: "legacy" })), ["voice_ui.input_conflict"]);
    assert.deepEqual(alerts(busy.open({ variant: "rvc" })), [], "its own input");
    assert.deepEqual(alerts(busy.open({ variant: "all" })), []);
    const forwarding = await directVoice(context, { directState: { observation_id: "1", settings: rvcSaved, pending: true }, directOwner: "legacy" });
    assert.deepEqual(alerts(forwarding.open({ variant: "rvc" })), ["voice_ui.input_conflict"]);
    assert.deepEqual(alerts(forwarding.open({ variant: "legacy" })), []);
    const nobody = await directVoice(context, { directState: { observation_id: "1", settings: rvcSaved, pending: true } });
    assert.deepEqual(alerts(nobody.open({ variant: "all" })), ["voice_ui.input_conflict"], "running, and no page owns it");
});

test("the form that edits everything chooses between forwarding and conversion, and shows RVC's numbers only for the conversion", async context => {
    const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, mode: "passthrough" } } });
    let tree = v.open({ variant: "all" });
    const mode = inputNamed(tree, "voice.direct_mode");
    assert.deepEqual([mode.type, mode.props["aria-label"], mode.props.value, mode.props.disabled], ["select", "voice.direct_mode", "passthrough", false]);
    assert.deepEqual(ofType(mode, "option").map(option => [option.props.value, textOf(option)]),
        [["passthrough", "voice.direct_passthrough"], ["converted", "voice.direct_converted"]]);
    assert.equal(find(tree, node => node.type === "input" && node.props.type === "number"), null, "forwarding has no numbers");
    assert.equal(find(tree, node => node.type === "setup" && node.props.title === "voice_ui.rvc_worker_title"), null);
    mode.props.onChange({ target: { value: "converted" } });
    tree = v.draw();
    assert.equal(inputNamed(tree, "voice.direct_mode").props.value, "converted");
    assert.ok(find(tree, node => node.type === "setup" && node.props.title === "voice_ui.rvc_worker_title"));
    // The other pages have no choice of mode.
    assert.equal(find(v.open({ variant: "rvc" }), node => node.props?.["aria-label"] === "voice.direct_mode"), null);
    assert.equal(find(v.open({ variant: "legacy" }), node => node.props?.["aria-label"] === "voice.direct_mode"), null);
});

test("RVC's pitch and index rate are checked as they are typed, and an index rate needs an index file", async context => {
    const v = await directVoice(context);
    let tree = v.open({ variant: "rvc" });
    const field = (name: string) => inputNamed(v.draw(), `voice.vc_${name}`).props;
    const pitch = field("rvc_pitch"), rate = field("rvc_index_rate");
    assert.deepEqual([pitch.type, pitch.min, pitch.max, pitch.step, pitch.placeholder, pitch.value, pitch.invalid, pitch["aria-describedby"]],
        ["number", -24, 24, 1, `voice_ui.example {"value":12}`, 0, false, undefined]);
    assert.deepEqual([rate.type, rate.min, rate.max, rate.step, rate.placeholder, rate.value, rate.invalid],
        ["number", 0, 1, 0.05, `voice_ui.example {"value":0.75}`, 0, false]);
    assert.deepEqual(alerts(tree), []);
    for (const [name, value, invalid] of [["rvc_pitch", 25, true], ["rvc_pitch", -25, true], ["rvc_pitch", 1.5, true], ["rvc_pitch", -24, false], ["rvc_pitch", Number.NaN, true],
        ["rvc_index_rate", 1.5, true], ["rvc_index_rate", -0.1, true], ["rvc_index_rate", Number.NaN, true], ["rvc_index_rate", 1, false]] as const) {
        field(name).onChange({ target: { valueAsNumber: value } });
        tree = v.draw();
        const shown = inputNamed(tree, `voice.vc_${name}`).props;
        assert.equal(shown.invalid, invalid, `${name} ${value}`);
        assert.equal(shown.value, Number.isFinite(value) ? value : "", `${name} ${value}`);
        const error = find(tree, node => node.type === "p" && textOf(node) === "voice_ui.invalid_rvc_numbers");
        assert.equal(error !== null, invalid, `${name} ${value}`);
        if (error) {
            assert.equal(error.props.role, "alert");
            assert.equal(shown["aria-describedby"], error.props.id, "the field points to the error");
            assert.equal(inputNamed(tree, "voice.vc_rvc_threads").props["aria-describedby"], error.props.id);
            assert.deepEqual(startReason(tree), { disabled: true, reason: "voice_ui.start_needs_setup" });
        }
        field(name).onChange({ target: { valueAsNumber: 0 } });
    }
    // An index rate without an index file says the file is needed, and the start waits for it.
    field("rvc_index_rate").onChange({ target: { valueAsNumber: 0.5 } });
    tree = v.draw();
    assert.deepEqual(alerts(tree), ["voice_ui.rvc_index_required"]);
    assert.equal(startReason(tree).reason, "voice_ui.start_needs_setup");
    inputNamed(tree, "voice.vc_rvc_index").props.onChange({ target: { value: "voice.index" } });
    tree = v.draw();
    assert.deepEqual(alerts(tree), []);
    assert.equal(startReason(tree).reason, "voice_ui.start_needs_save", "complete, with edits to save first");
});

test("the RVC worker's device, threads and high-pass are set in a fold whose line says them", async context => {
    const v = await directVoice(context);
    let tree = v.open({ variant: "rvc" });
    const worker = () => findIn(v.draw(), node => node.type === "setup" && node.props.title === "voice_ui.rvc_worker_title");
    assert.deepEqual([worker().props.desc, worker().props.status], ["voice_ui.rvc_worker_hint",
        `voice_ui.rvc_worker_status {"device":"voice.vc_rvc_device_auto","threads":"voice_ui.rvc_threads_auto","highpass":"voice_ui.rvc_highpass_on"}`]);
    const device = inputNamed(worker(), "voice.vc_rvc_device");
    assert.deepEqual([device.props["aria-label"], device.props.value], ["voice.vc_rvc_device", "auto"]);
    assert.deepEqual(ofType(device, "option").map(option => [option.props.value, textOf(option)]),
        [["auto", "voice.vc_rvc_device_auto"], ["cuda", "voice.vc_rvc_device_cuda"], ["cpu", "voice.vc_rvc_device_cpu"]], "no DirectML where it is not offered");
    device.props.onChange({ target: { value: "cpu" } });
    const threads = inputNamed(worker(), "voice.vc_rvc_threads");
    assert.deepEqual([threads.props.type, threads.props.min, threads.props.max, threads.props.step, threads.props.placeholder, threads.props.value, threads.props.invalid],
        ["number", 0, rvcStartOptions.MAX_RVC_THREADS, 1, `voice_ui.example {"value":4}`, 0, false]);
    threads.props.onChange({ target: { valueAsNumber: 8 } });
    const highpass = findIn(worker(), node => node.type === "input" && node.props.type === "checkbox");
    assert.equal(highpass.props.checked, true);
    highpass.props.onChange({ target: { checked: false } });
    tree = v.draw();
    assert.equal(worker().props.status, `voice_ui.rvc_worker_status {"device":"voice.vc_rvc_device_cpu","threads":8,"highpass":"voice_ui.rvc_highpass_off"}`);
    assert.equal(textOf(findIn(worker(), node => node.type === "label" && find(node, inner => inner.props?.type === "checkbox") !== null)), "voice.vc_rvc_highpass");
    // Threads are a whole number from 0 to the most the worker takes.
    for (const [value, invalid] of [[65, true], [-1, true], [2.5, true], [Number.NaN, true], [64, false]] as const) {
        inputNamed(worker(), "voice.vc_rvc_threads").props.onChange({ target: { valueAsNumber: value } });
        const shown = inputNamed(worker(), "voice.vc_rvc_threads").props;
        assert.deepEqual([shown.invalid, shown.value], [invalid, Number.isFinite(value) ? value : ""], String(value));
    }
    // A device the locale does not name is shown by its own name.
    inputNamed(worker(), "voice.vc_rvc_device").props.onChange({ target: { value: "absent-device" } });
    assert.match(worker().props.status, /"device":"absent-device"/);
    assert.ok(tree);
});

test("where the DirectML runtime is offered, the worker can use it and the setup offers that runtime", async context => {
    const v = await directVoice(context, {}, { directml: true });
    const tree = v.open({ variant: "rvc" });
    assert.deepEqual(ofType(inputNamed(tree, "voice.vc_rvc_device"), "option").map(option => option.props.value), ["auto", "cuda", "directml", "cpu"]);
    const setup = findIn(tree, node => node.type === "setup" && node.props.title === "voice_ui.setup_rvc");
    const lead = findIn(setup, node => node.type === "lead").props;
    assert.deepEqual([lead.text, lead.details], ["voice_ui.rvc_directml_lead", "voice_ui.rvc_directml_details"]);
    assert.deepEqual(ofType(setup, "runtime").map(node => node.props.engine), ["rvc", rvcStartOptions.DIRECTML_RUNTIME]);
    assert.equal(ofType(setup, "runtime")[1].props.disabled, false);
    const plain = await directVoice(context);
    assert.equal(find(plain.open({ variant: "rvc" }), node => node.type === "lead"), null);
});

test("the input is chosen from the inputs found, a lost one stays named as disconnected, and the list can be asked for again", async context => {
    const v = await directVoice(context, { directSources: { sources: [microphone, { id: "line", label: "Line in" }] }, selectedSource: "gone" });
    let tree = v.open({ variant: "rvc" });
    const row = findIn(tree, node => node.type === "row" && node.props.label === "voice.input_source");
    assert.equal(row.props.description, "voice.input_selection_hint");
    const select = findIn(row, node => node.type === "select");
    assert.deepEqual([select.props["aria-label"], select.props.value, select.props.disabled], ["voice.input_source", "gone", false]);
    assert.deepEqual(ofType(select, "option").map(option => [option.props.value, textOf(option)]),
        [["", "voice.select_input"], ["gone", "voice.disconnected"], ["mic-1", "Microphone"], ["line", "Line in"]]);
    assert.equal(startReason(tree).reason, "voice_ui.start_needs_input");
    select.props.onChange({ target: { value: "line" } });
    assert.deepEqual(v.sent.at(-1), ["select", "line"]);
    tree = v.draw();
    assert.deepEqual(ofType(findIn(tree, node => node.type === "select" && node.props["aria-label"] === "voice.input_source"), "option").map(option => option.props.value), ["", "mic-1", "line"]);
    findIn(row, node => node.type === "row").props.actions.props.onClick();
    assert.deepEqual(v.sent.at(-1), ["/get/data/direct_voice_sources"]);
    assert.equal(textOf(row.props.actions), "voice.refresh_inputs");
    // Nothing found yet: only the empty choice.
    const none = await directVoice(context, { directSources: {}, selectedSource: "" });
    assert.deepEqual(ofType(findIn(none.open(), node => node.props?.["aria-label"] === "voice.input_source"), "option").map(option => option.props.value), [""]);
});

test("Start says the first thing it waits for: the route, the input, the setup, RVC, a save, the backend or the running input", async context => {
    const reason = async (given: Partial<Voice>, variant: Variant = "rvc", saved: Record<string, unknown> = {}) => {
        const v = await directVoice(context, { ...given, directState: { observation_id: "1", ...given.directState, settings: { ...rvcSaved, ...saved } } });
        return startReason(v.open({ variant }));
    };
    const blocked = (text: string) => ({ disabled: true, reason: text });
    assert.deepEqual(await reason({ directState: { output_route: "device" }, settings: { routing: "managed" } }), blocked("voice_ui.start_needs_output"));
    assert.deepEqual(await reason({ settings: { routing: "direct" } }), blocked("voice_ui.start_needs_mic"));
    assert.deepEqual(await reason({ settings: null }), blocked("voice_ui.start_needs_mic"));
    assert.deepEqual(await reason({ selectedSource: "" }), blocked("voice_ui.start_needs_input"));
    for (const saved of [{ rvc_runtime: " " }, { rvc_model: "voice.onnx" }, { rvc_index: "voice.txt" }, { rvc_index_rate: 0.5 }, { rvc_threads: 99 }]) {
        assert.deepEqual(await reason({}, "rvc", saved), blocked("voice_ui.start_needs_setup"), JSON.stringify(saved));
    }
    assert.deepEqual(await reason({}, "rvc", { rvc_model: "VOICE.PTH", rvc_index: "v.INDEX", rvc_index_rate: 0.5 }), { disabled: false, reason: null }, "the file types in any case");
    assert.deepEqual(await reason({ route: { ready: false } }), blocked("voice_ui.start_waiting_route"));
    assert.deepEqual(await reason({ route: { ready: true, pending: true } }), blocked("voice_ui.start_waiting_route"));
    assert.deepEqual(await reason({ directSources: { sources: [microphone], error: "lost" } }), blocked("voice_ui.start_input_unavailable"));
    assert.deepEqual(await reason({ directState: { active: true, requested: true } }), blocked("hidden"), "running: no line under the button");
    assert.deepEqual(await reason({ directPending: { id: "x" } }), blocked("hidden"));
    // A device route that has its output device is ready; input forwarding needs no setup.
    assert.deepEqual(await reason({ directState: { output_route: "device" }, settings: { routing: "direct", output_device: "Speakers" } }), { disabled: false, reason: null });
    assert.deepEqual(await reason({}, "legacy", { rvc_runtime: "" }), { disabled: false, reason: null });
    // Before the first state arrives the route is not known.
    const unknown = await directVoice(context, { directState: { settings: rvcSaved } });
    assert.deepEqual(startReason(unknown.open({ variant: "rvc" })), blocked("voice_ui.start_waiting_route"));
});

test("Start sends the chosen input with the conversion's options, or the input alone for forwarding; Stop stops only the input this page runs", async context => {
    const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, rvc_index: "v.index", rvc_index_rate: 0.5, rvc_pitch: -3, rvc_device: "cpu", rvc_threads: 4, rvc_highpass: false } } });
    let tree = v.open({ variant: "rvc" });
    const start = buttonNamed(tree, "voice.input_start");
    assert.deepEqual([start.props.tone, start.props.disabled, start.props["aria-describedby"]], ["primary", false, undefined]);
    start.props.onClick();
    assert.deepEqual(v.sent.at(-1), ["/run/start_direct_voice", { source: "mic-1", mode: "converted", options: { engine: "rvc", runtime: "/rvc", model: "voice.pth",
        index: "v.index", pitch: -3, index_rate: 0.5, device: "cpu", threads: 4, highpass: false } }]);
    const stop = buttonNamed(tree, "voice.input_stop");
    assert.equal(stop.props.disabled, true, "nothing runs");
    const column = findIn(tree, node => node.type === "div" && find(node, inner => textOf(inner) === "voice.input_start" && inner.type === "button") !== null
        && [node.props.children].flat().length === 2);
    assert.equal(classesOf(column).length, 2, "the actions' row in the control column");

    const forwarding = await directVoice(context);
    buttonNamed(forwarding.open({ variant: "legacy" }), "voice.input_start").props.onClick();
    assert.deepEqual(forwarding.sent.at(-1), ["/run/start_direct_voice", { source: "mic-1" }]);

    const running = await directVoice(context, { directState: { observation_id: "1", settings: rvcSaved, active: true, requested: true }, directOwner: "rvc" });
    tree = running.open({ variant: "rvc" });
    assert.equal(buttonNamed(tree, "voice.input_stop").props.disabled, false);
    buttonNamed(tree, "voice.input_stop").props.onClick();
    assert.deepEqual(running.sent.at(-1), ["/run/stop_direct_voice"]);
    assert.equal(buttonNamed(running.open({ variant: "legacy" }), "voice.input_stop").props.disabled, true, "another page's input");
    // Started from nowhere chosen, nothing is sent.
    const none = await directVoice(context, { selectedSource: "" });
    buttonNamed(none.open({ variant: "rvc" }), "voice.input_start").props.onClick();
    assert.equal(none.sent.some(call => call[0] === "/run/start_direct_voice"), false);
});

test("the setup fold's line says whether the runtime and the model are set and whether the route is ready, and opens on a route error", async context => {
    const fold = async (given: Partial<Voice>, variant: Variant, saved: Record<string, unknown> = {}) => {
        const v = await directVoice(context, { ...given, directState: { observation_id: "1", ...given.directState, settings: { ...rvcSaved, ...saved } } });
        const setup = findIn(v.open({ variant }), node => node.type === "setup" && String(node.props.title).startsWith("voice_ui.setup_")).props;
        return [setup.title, setup.status, setup.attention];
    };
    assert.deepEqual(await fold({}, "rvc"), ["voice_ui.setup_rvc", "voice_ui.runtime_set · speech_servers.model_set · voice_ui.mic_ready", false]);
    assert.deepEqual(await fold({ settings: { routing: "direct" }, error: "route_failed" }, "rvc", { rvc_runtime: "", rvc_model: "voice.onnx" }),
        ["voice_ui.setup_rvc", "voice_ui.runtime_unset · speech_servers.model_unset · voice_ui.mic_unready", true]);
    assert.deepEqual(await fold({ directState: { output_route: "device" }, settings: { output_device: "Speakers" } }, "legacy"), ["voice_ui.setup_input", "voice_ui.output_ready", false]);
    assert.deepEqual(await fold({ directState: { output_route: "device" }, settings: {} }, "legacy"), ["voice_ui.setup_input", "voice_ui.output_unready", false]);
    // A Seed-VC conversion saved by an earlier version, on the form that edits everything.
    assert.deepEqual(await fold({}, "all", { engine: "seed-vc", runtime: "/seed", reference: "" }),
        ["voice_ui.setup_input", "voice_ui.runtime_set · speech_servers.model_unset · voice_ui.mic_ready", false]);
    assert.deepEqual(await fold({}, "all", { engine: "seed-vc", runtime: "", reference: "ref.wav" }),
        ["voice_ui.setup_input", "voice_ui.runtime_unset · speech_servers.model_set · voice_ui.mic_ready", false]);
});

test("RVC's paths are typed or dropped, its runtime is set up in place, and the model catalog knows what the form would replace", async context => {
    const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, rvc_index: "old.index", rvc_pitch: 2, rvc_index_rate: 0.5 } } });
    let tree = v.open({ variant: "all" });
    const setup = () => findIn(v.draw(), node => node.type === "setup" && node.props.title === "voice_ui.setup_input");
    assert.deepEqual(ofType(setup(), "description").map(node => node.props.text), ["voice.vc_rvc_hint"]);
    const fields = ofType(setup(), "input").map(node => [node.props.type, node.props.value, node.props.maxLength, node.props.placeholder]);
    // Text fields of the kit, which are text unless they say otherwise.
    assert.deepEqual(fields, [[undefined, "/rvc", 4096, `voice_ui.example {"value":"/path/rvc-runtime"}`], [undefined, "voice.pth", 4096, `voice_ui.example {"value":"/path/voice.pth"}`],
        [undefined, "old.index", 4096, `voice_ui.example {"value":"/path/voice.index"}`]]);
    assert.deepEqual(texts(setup(), "label").map(text => text.split(/\s/)[0]), ["voice.vc_rvc_runtime", "voice.vc_rvc_model", "voice.vc_rvc_index"]);
    assert.equal(findIn(setup(), node => node.type === "custom-model-link").props.section, "rvc");
    const catalog = () => findIn(setup(), node => node.type === "downloads").props;
    assert.deepEqual([catalog().targets, catalog().blocked, catalog().expected, catalog().audition], [["rvc"], false, { rvc: { model: "voice.pth", index: "old.index" } },
        { values: { pitch: 2, index_rate: 0.5 }, input: "mic-1" }]);
    const drop = findIn(setup(), node => node.type === "file-drop").props;
    assert.deepEqual([drop.accept, drop.disabled, drop.hint], [[".pth", ".index"], false, "voice_ui.rvc_drop_hint"]);
    drop.onFiles(["/new/voice.PTH", "/notes.txt", "/new/voice.index"]);
    assert.deepEqual(ofType(setup(), "input").map(node => node.props.value), ["/rvc", "/new/voice.PTH", "/new/voice.index"]);
    // A drop saves at once (#1111); until the saved paths come back, an Apply waits.
    assert.ok(catalog().blocked, "an Apply would replace what the user has dropped");
    findIn(setup(), node => node.type === "file-drop").props.onFiles(["/other.index"]);
    assert.deepEqual(ofType(setup(), "input").map(node => node.props.value), ["/rvc", "/new/voice.PTH", "/other.index"], "only what was dropped");
    ofType(setup(), "input")[0].props.onChange({ target: { value: "/typed" } });
    const runtime = findIn(setup(), node => node.type === "runtime").props;
    // The drop's save waits for its answer here, and the runtime's setup waits with it.
    assert.deepEqual([runtime.engine, runtime.current, runtime.disabled], ["rvc", "/typed", true]);
    runtime.onUse("/fetched");
    assert.equal(ofType(setup(), "input")[0].props.value, "/fetched");
    // Invalid numbers: the audition has none to use.
    inputNamed(v.draw(), "voice.vc_rvc_pitch").props.onChange({ target: { valueAsNumber: 99 } });
    assert.deepEqual(catalog().audition, { values: null, input: "mic-1" });
    // Without an input chosen, the audition has none.
    v.voice.selectedSource = "";
    assert.equal(catalog().audition.input, null);
    // While the input runs, nothing on the fold changes.
    const busy = await directVoice(context, { directState: { observation_id: "1", settings: rvcSaved, pending: true } });
    tree = busy.open({ variant: "rvc" });
    const busySetup = findIn(tree, node => node.type === "setup" && node.props.title === "voice_ui.setup_rvc");
    assert.deepEqual([findIn(busySetup, node => node.type === "downloads").props.blocked, findIn(busySetup, node => node.type === "file-drop").props.disabled,
        findIn(busySetup, node => node.type === "runtime").props.disabled, ofType(busySetup, "input").every(node => node.props.disabled)], ["busy", true, true, true]);
    assert.equal(find(busySetup, node => node.type === "description"), null, "the RVC page opens with the RVC hint already");
});

test("a Seed-VC conversion saved by an earlier version keeps its runtime and reference fields until it is moved to RVC", async context => {
    const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, engine: "seed-vc", runtime: "/seed", reference: "ref.wav" } } });
    const tree = v.open({ variant: "all" });
    const setup = findIn(tree, node => node.type === "setup" && node.props.title === "voice_ui.setup_input");
    assert.deepEqual(ofType(setup, "description").map(node => node.props.text), ["voice.vc_hint"]);
    assert.deepEqual(ofType(setup, "input").map(node => node.props.value), ["/seed", "ref.wav"]);
    assert.equal(findIn(setup, node => node.type === "custom-model-link").props.section, "seed-vc");
    assert.deepEqual([find(setup, node => node.type === "file-drop"), find(setup, node => node.type === "downloads")], [null, null]);
    const runtime = findIn(setup, node => node.type === "runtime").props;
    assert.deepEqual([runtime.engine, runtime.current], ["seed-vc", "/seed"]);
    runtime.onUse("/seed2");
    assert.equal(ofType(findIn(v.draw(), node => node.type === "setup" && node.props.title === "voice_ui.setup_input"), "input")[0].props.value, "/seed2");
    assert.deepEqual(startReason(v.draw()), { disabled: true, reason: "voice_ui.start_needs_save" }, "an edit to save first");
    const saved = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, engine: "seed-vc", runtime: "/seed", reference: "ref.wav" } } });
    buttonNamed(saved.open({ variant: "all" }), "voice.input_start").props.onClick();
    assert.deepEqual(saved.sent.at(-1), ["/run/start_direct_voice", { source: "mic-1", mode: "converted", options: { runtime: "/seed", reference: "ref.wav" } }]);
    assert.equal(find(saved.open({ variant: "all" }), node => node.type === "setup" && node.props.title === "voice_ui.rvc_worker_title"), null);
});

test("the input needs the managed microphone or its output device, and the fold offers to prepare the microphone with its errors", async context => {
    const v = await directVoice(context, { settings: { routing: "direct", monitor: "off" }, error: "mic_failed" }, { known: ["voice_setup_errors.mic_failed"] });
    let tree = v.open({ variant: "legacy" });
    const setup = findIn(tree, node => node.type === "setup" && node.props.title === "voice_ui.setup_input");
    assert.deepEqual(ofType(setup, "description").map(node => node.props.text), ["voice.input_requires_managed"]);
    const prepare = buttonNamed(setup, "voice.prepare_microphone");
    assert.equal(prepare.props.disabled, false);
    prepare.props.onClick();
    assert.deepEqual(v.sent.at(-1), ["/set/data/voice_settings", { routing: "managed", monitor: "off" }]);
    const column = findIn(setup, node => node.type === "div" && find(node, inner => inner.type === "button") !== null);
    assert.equal(classesOf(column).length, 2);
    assert.deepEqual(alerts(setup), ["voice_setup_errors.mic_failed (mic_failed)"]);
    assert.equal(find(tree, node => node.type === "route-controls"), null);
    assert.equal(findIn(tree, node => node.type === "row" && node.props.label === "voice.input_source").props.description, "voice.input_selection_hint");
    // The route's own sentence, else the voice pages' and the main screen's, else the code with the page to check.
    const other = await directVoice(context, { settings: { routing: "direct" }, error: "odd code" });
    assert.deepEqual(alerts(findIn(other.open({ variant: "legacy" }), node => node.type === "setup")),
        [`odd code · voice_ui.check_settings {"page":"config_page.side_menu_labels.rvc"}`]);
    // Without the settings or while the input runs, it waits.
    const unknown = await directVoice(context, { settings: null });
    assert.equal(buttonNamed(unknown.open({ variant: "legacy" }), "voice.prepare_microphone").props.disabled, true);
    const running = await directVoice(context, { settings: { routing: "direct" }, directState: { observation_id: "1", settings: rvcSaved, stopping: true } });
    assert.equal(buttonNamed(running.open({ variant: "legacy" }), "voice.prepare_microphone").props.disabled, true);
    // Managed: the route's controls, and nothing to prepare.
    const managed = await directVoice(context);
    tree = managed.open({ variant: "legacy" });
    assert.ok(find(tree, node => node.type === "route-controls"));
    assert.equal(find(tree, node => textOf(node) === "voice.prepare_microphone" && node.type === "button"), null);
    // Before the first state, nothing is said about the route.
    const early = await directVoice(context, { settings: { routing: "direct" }, directState: { settings: rvcSaved } });
    assert.equal(find(early.open({ variant: "legacy" }), node => node.type === "description" && node.props.text === "voice.input_requires_managed"), null);
    // An output device route: the controls, and a sentence while it has no device.
    const device = await directVoice(context, { settings: { routing: "direct" }, directState: { observation_id: "1", settings: rvcSaved, output_route: "device" } });
    tree = device.open({ variant: "legacy" });
    assert.ok(find(tree, node => node.type === "route-controls"));
    assert.deepEqual(ofType(findIn(tree, node => node.type === "setup"), "description").map(node => node.props.text), ["voice.input_requires_output"]);
    assert.equal(findIn(tree, node => node.type === "row" && node.props.label === "voice.input_source").props.description, "voice.input_selection_hint_device");
    const reason = findIn(tree, node => node.type === "p" && textOf(node) === "voice_ui.start_needs_output");
    assert.equal(classesOf(reason).length, 1, "under the button, in the control column");
});

test("the monitor row says whether the converted voice is heard, and a monitor error is said in its words", async context => {
    const row = async (given: Partial<Voice>, variant: Variant) => {
        const v = await directVoice(context, given);
        const tree = v.open({ variant });
        const monitor = findIn(tree, node => node.type === "row" && node.props.label === "voice_ui.monitor_heading").props;
        const link = findIn(tree, node => node.type === "page-link").props;
        return { status: textOf(monitor.status), marked: monitor.status.props["data-vc-monitor"], group: monitor.group, fold: monitor.fold, description: monitor.description,
            link: [link.tab, link.action, link.target], readouts: ofType(tree, "readout").map(node => [node.props.tone, texts(node, "p")]) };
    };
    const on = await row({ settings: { routing: "managed", monitor: "on" } }, "rvc");
    assert.deepEqual(on, { status: "voice.monitor_on", marked: true, group: true, fold: false, description: "voice.vc_monitor_help",
        link: ["tts", "voice.vc_monitor_action", "tts_monitor"], readouts: [] });
    assert.equal((await row({}, "rvc")).status, "voice.monitor_off");
    assert.equal((await row({ settings: { routing: "managed", monitor: "on" } }, "legacy")).status, "voice.vc_monitor_not_converted");
    assert.deepEqual((await row({ directState: { observation_id: "1", settings: rvcSaved, monitor_error: "device_lost" } }, "rvc")).readouts,
        [["failed", ["voice.monitor_errors.device_lost"]]]);
    assert.deepEqual((await row({ directState: { observation_id: "1", settings: rvcSaved, monitor_error: "absent_reason" } }, "rvc")).readouts,
        [["failed", ["voice.monitor_error"]]]);
});

test("why the input cannot be used is said once, from the inputs, the form or the state, and a failed save stands alone", async context => {
    const last = async (given: Partial<Voice>, known: string[] = []) => {
        const v = await directVoice(context, given, { known });
        return alerts(v.open({ variant: "rvc" })).at(-1);
    };
    assert.equal(await last({ directSources: { sources: [microphone], error: "no_inputs" }, directError: "later", directState: { observation_id: "1", settings: rvcSaved, error: "last" } },
        ["voice_ui.errors.no_inputs"]), "voice.input_error: voice_ui.errors.no_inputs (no_inputs)");
    assert.equal(await last({ directError: "worker_crashed", directState: { observation_id: "1", settings: rvcSaved, error: "last" } }, ["voice.input_errors.worker_crashed"]),
        "voice.input_error: voice.input_errors.worker_crashed (worker_crashed)");
    assert.equal(await last({ directState: { observation_id: "1", settings: rvcSaved, error: "state_error" } }),
        `voice.input_error: state_error · voice_ui.check_settings {"page":"config_page.side_menu_labels.rvc"}`);
    assert.equal(await last({ directError: "save_unconfirmed" }, ["voice_ui.errors.save_unconfirmed"]), "voice_ui.errors.save_unconfirmed (save_unconfirmed)");
    assert.equal(await last({}), undefined);
});

test("a save takes the settings the backend answered with, and an answer that is not settings leaves the save unconfirmed", async context => {
    let answer: unknown = null;
    const v = await directVoice(context, {}, { send: (endpoint, value) => endpoint === "/set/data/direct_voice_settings" ? Promise.resolve(answer ?? { status: 200, result: { settings: value } }) : true });
    v.open({ variant: "rvc" });
    inputNamed(v.draw(), "voice.vc_rvc_pitch").props.onChange({ target: { valueAsNumber: 5 } });
    v.draw();
    // The backend keeps the pitch it can use, and fills what it was not sent with the form's defaults.
    const { rvc_highpass: _left, ...answered } = rvcSaved;
    answer = { status: 200, result: { settings: { ...answered, rvc_pitch: 4 } } };
    await v.entry().save();
    v.draw();
    assert.equal(inputNamed(v.draw(), "voice.vc_rvc_pitch").props.value, 4);
    assert.equal(findIn(v.draw(), node => node.type === "input" && node.props.type === "checkbox").props.checked, true, "the worker's default high-pass");
    // An answer without settings: the defaults.
    inputNamed(v.draw(), "voice.vc_rvc_pitch").props.onChange({ target: { valueAsNumber: 6 } });
    v.draw();
    answer = { status: 200, result: { settings: null } };
    await v.entry().save();
    assert.equal(inputNamed(v.draw(), "voice.vc_rvc_pitch").props.value, 0);
    for (const result of ["saved", null]) {
        inputNamed(v.draw(), "voice.vc_rvc_pitch").props.onChange({ target: { valueAsNumber: 7 } });
        v.draw();
        v.errors.length = 0;
        answer = { status: 200, result };
        await v.entry().save();
        assert.deepEqual(v.errors.at(-1), "save_unconfirmed", String(result));
        v.entry().discard();
        v.draw();
    }
});

test("the form knows its changed settings, and saves only valid numbers while nothing runs", async context => {
    const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, mode: "passthrough" } } });
    v.open({ variant: "all" });
    choose(v.draw(), "voice.direct_mode", "converted");
    v.draw();
    assert.deepEqual(v.entry().changes, ["mode"]);
    assert.equal(v.entry().canSave, true);
    inputNamed(v.draw(), "voice.vc_rvc_pitch").props.onChange({ target: { valueAsNumber: 30 } });
    v.draw();
    assert.deepEqual(v.entry().changes, ["mode", "rvc_pitch"]);
    assert.equal(v.entry().canSave, false, "an invalid pitch");
    inputNamed(v.draw(), "voice.vc_rvc_pitch").props.onChange({ target: { valueAsNumber: 3 } });
    inputNamed(v.draw(), "voice.vc_rvc_threads").props.onChange({ target: { valueAsNumber: 2 } });
    v.draw();
    assert.deepEqual(v.entry().changes, ["mode", "rvc_pitch", "rvc_threads"]);
    assert.equal(v.entry().canSave, true);
    v.voice.directPending = { id: "start" };
    v.draw();
    assert.equal(v.entry().canSave, false, "not while the input starts");
});

test("fields that settings saved by an earlier version lack take the form's defaults", async context => {
    const v = await directVoice(context, { directState: { observation_id: "1", settings: {} } });
    let tree = v.open({ variant: undefined });
    assert.equal(selectNamed(tree, "voice.direct_mode").props.value, "passthrough", "the form that edits everything, by default");
    assert.ok(find(tree, node => node.type === "downloads"), "the conversion's engine is RVC, whose models the catalog offers");
    tree = v.open({ variant: "rvc" });
    const setup = findIn(tree, node => node.type === "setup" && node.props.title === "voice_ui.setup_rvc");
    assert.deepEqual(ofType(setup, "input").map(node => node.props.value), ["", "", ""]);
    assert.deepEqual(findIn(setup, node => node.type === "downloads").props.expected, { rvc: { model: "", index: "" } }, "nothing saved to replace");
    assert.equal(findIn(tree, node => node.type === "setup" && node.props.title === "voice_ui.setup_rvc").props.status,
        "voice_ui.runtime_unset · speech_servers.model_unset · voice_ui.mic_ready");
    // A Seed-VC conversion with nothing set: empty fields with their examples.
    const seed = await directVoice(context, { directState: { observation_id: "1", settings: { mode: "converted", engine: "seed-vc" } } });
    const seedSetup = findIn(seed.open({ variant: "all" }), node => node.type === "setup" && node.props.title === "voice_ui.setup_input");
    assert.deepEqual(ofType(seedSetup, "input").map(node => [node.props.value, node.props.placeholder]), [["", `voice_ui.example {"value":"/path/seed-vc-runtime"}`],
        ["", `voice_ui.example {"value":"/path/reference.wav"}`]]);
    assert.deepEqual(ofType(seedSetup, "label").map(node => [node.props.children].flat()[0]), ["voice.vc_runtime", "voice.vc_reference"]);
});

test("the form follows a change of the saved settings, and asks again when the voice connection changes", async context => {
    const v = await directVoice(context);
    v.open({ variant: "rvc" });
    v.voice.directState = { observation_id: "2", settings: { ...rvcSaved, rvc_pitch: 5 } };
    v.draw();
    assert.equal(inputNamed(v.draw(), "voice.vc_rvc_pitch").props.value, 5);
    v.sent.length = 0;
    v.hook.send = (endpoint: string, value?: unknown) => { v.sent.push(["new", endpoint, value]); return true; };
    v.draw();
    assert.deepEqual(v.sent, [["new", "/get/data/voice_settings", undefined], ["new", "/get/data/direct_voice_sources", undefined], ["new", "/get/data/direct_voice_state", undefined]]);
});

test("the RVC page shows RVC also while another conversion is saved, and checks the file types at the end of the names", async context => {
    const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, engine: "seed-vc", mode: "passthrough" } } });
    const setup = findIn(v.open({ variant: "rvc" }), node => node.type === "setup" && node.props.title === "voice_ui.setup_rvc");
    assert.deepEqual(ofType(setup, "label").map(node => [node.props.children].flat()[0]), ["voice.vc_rvc_runtime", "voice.vc_rvc_model", "voice.vc_rvc_index"]);
    assert.ok(find(setup, node => node.type === "downloads"));
    const check = async (saved: Record<string, unknown>) => {
        const page = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, ...saved } } });
        const tree = page.open({ variant: "rvc" });
        return [startReason(tree).reason, findIn(tree, node => node.type === "setup" && node.props.title === "voice_ui.setup_rvc").props.status];
    };
    assert.deepEqual(await check({ rvc_model: "voice.pth.bak" }), ["voice_ui.start_needs_setup", "voice_ui.runtime_set · speech_servers.model_unset · voice_ui.mic_ready"]);
    assert.deepEqual((await check({ rvc_index: "voice.index.old" }))[0], "voice_ui.start_needs_setup");
    // A Seed-VC conversion needs both its runtime and its reference voice, not blank.
    for (const saved of [{ runtime: " ", reference: "ref.wav" }, { runtime: "/seed", reference: " " }, { runtime: "", reference: "ref.wav" }, { runtime: "/seed", reference: "" }]) {
        const page = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, engine: "seed-vc", ...saved } } });
        assert.equal(startReason(page.open({ variant: "all" })).reason, "voice_ui.start_needs_setup", JSON.stringify(saved));
    }
});

test("input forwarding and a Seed-VC conversion say nothing about RVC's numbers, index or DirectML", async context => {
    const bad = { ...rvcSaved, rvc_pitch: 99, rvc_index_rate: 0.5, rvc_index: "" };
    const forwarding = await directVoice(context, { directState: { observation_id: "1", settings: bad } }, { directml: true });
    let tree = forwarding.open({ variant: "legacy" });
    assert.deepEqual(alerts(tree), []);
    assert.equal(find(tree, node => node.type === "lead"), null);
    const seed = await directVoice(context, { directState: { observation_id: "1", settings: { ...bad, engine: "seed-vc", runtime: "/seed", reference: "ref.wav" } } }, { directml: true });
    tree = seed.open({ variant: "all" });
    assert.deepEqual(alerts(tree), []);
    assert.equal(find(tree, node => node.type === "lead"), null);
    // Valid numbers: the threads field points to no error.
    const valid = await directVoice(context);
    assert.equal(inputNamed(valid.open({ variant: "rvc" }), "voice.vc_rvc_threads").props["aria-describedby"], undefined);
    // No notice of a moved conversion unless there is one.
    assert.deepEqual(ofType(valid.open({ variant: "rvc" }), "p").filter(node => node.props.role === "status").map(textOf), []);
});

test("while the input runs, the RVC selection and the DirectML runtime wait, and the catalog's Apply waits for edited paths", async context => {
    const busy = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, mode: "passthrough" }, pending: true } }, { directml: true });
    const tree = busy.open({ variant: "rvc" });
    assert.equal(buttonNamed(tree, "voice_ui.select_rvc").props.disabled, true);
    assert.deepEqual(ofType(tree, "runtime").map(node => [node.props.engine, node.props.disabled]), [["rvc", true], [rvcStartOptions.DIRECTML_RUNTIME, true]]);
    const edit = async (field: string, value: string) => {
        const v = await directVoice(context, { directState: { observation_id: "1", settings: { ...rvcSaved, rvc_index: "v.index" } } });
        v.open({ variant: "rvc" });
        const setup = () => findIn(v.draw(), node => node.type === "setup" && node.props.title === "voice_ui.setup_rvc");
        const index = ["rvc_runtime", "rvc_model", "rvc_index"].indexOf(field);
        ofType(setup(), "input")[index].props.onChange({ target: { value } });
        return findIn(setup(), node => node.type === "downloads").props.blocked;
    };
    assert.equal(await edit("rvc_model", "other.pth"), "edited");
    assert.equal(await edit("rvc_index", "other.index"), "edited");
    assert.equal(await edit("rvc_runtime", "/other"), false, "a runtime edit does not conflict with an Apply");
});
