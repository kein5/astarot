import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { eventTarget, find, findIn, hooks, loadModule, nodesIn, stubGlobals, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { HookRuntime, TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as draftRebase from "../../../../../../logics/voice/draftRebase.ts";
import * as voiceErrorText from "../../../../../../logics/voice/voiceErrorText.ts";
import { changedPaths } from "../../../../../../logics/voice/saveBar.ts";
import type { SaveBarEntry } from "../../../../../../logics/voice/saveBar.ts";

// The TTS page's voice form (VoiceSettings.tsx) drawn with the real settings draft, which makes the
// save bar's entry: the names of the changed settings, whether they can be saved, and what a save
// writes. The voice hook is a stand-in that holds the settings, the playback state and the devices
// the test gives and records what the page sends; the shared parts are stand-ins that keep their
// props, and the engines' and generation options' checks are stand-ins the test controls.

// Keys a test takes out of the locale, as missing translations.
const missingKeys = new Set<string>();
const t = (key: string, variables?: Record<string, unknown>) => {
    const { defaultValue, ...values } = variables ?? {};
    if (key.includes("absent") || missingKeys.has(key)) return String(defaultValue ?? key);
    return Object.keys(values).length ? `${key} ${JSON.stringify(values)}` : key;
};
type Settings = Record<string, unknown>;
const saved: Settings = { mode: "off", mic_mode: "off", target_slot: "1", direct_policy: "suppress", output_device: "", routing: "external", monitor: "off" };
// The installed engines the label names: COEIROINK, and VOICEVOX, which reads an audio query.
const TTS_ENGINES = { coeiroink: { name: "COEIROINK", url: "coeiroink_url" }, voicevox: { name: "VOICEVOX", url: "voicevox_url" } };

interface Voice { settings: Settings | null; status: Settings; devices: { devices?: { id: string; label: string }[]; error?: string | null }; error: string | null }


// The pages a test opened, closed together when it ends.
const pagesByTest = new WeakMap<TestContext, HookRuntime[]>();
function closeWithTest(context: TestContext, runtime: HookRuntime) {
    const pages = pagesByTest.get(context);
    if (pages) { pages.push(runtime); return; }
    const opened = [runtime];
    pagesByTest.set(context, opened);
    context.onTestFinished(() => { for (const page of opened) page.unmount(); });
}

async function voicePage(context: TestContext, given: Partial<Voice> = {}, options: { hints?: boolean; known?: string[] } = {}) {
    const runtime = hooks(), sent: unknown[][] = [], entries = new Map<string, SaveBarEntry>();
    // Every page of the test is closed before the stand-in window goes: the settings draft guards
    // leaving a page with edits through it.
    closeWithTest(context, runtime);
    stubGlobals(context, { window: eventTarget() });
    const voice: Voice = { settings: saved, status: {}, devices: { devices: [{ id: "speakers", label: "Speakers" }, { id: "vrct.virtual", label: "Virtual" }] },
        error: null, ...given };
    const hook = { send: (endpoint: string, value?: unknown): unknown => {
        sent.push(value === undefined ? [endpoint] : [endpoint, value]);
        return endpoint === "/set/data/voice_settings" ? Promise.resolve({ status: 200, result: { ...voice.settings, ...(value as object) } }) : true;
    }, updateError: () => {} };
    // The kit's Button and TextField as the elements they stand for, with the props the page gives
    // them: a field marked wrong carries `invalid`, which the kit turns into aria-invalid.
    const ui = { "../../../../../kit/index.ts": { Button: "button", TextField: "input" }, "@useI18n": { useI18n: () => ({ t, i18n: { exists: (name: string) => (options.known ?? []).includes(name) } }) } };
    const { useSettingsDraft } = await loadModule<typeof import("../../../../../../logics/voice/useSettingsDraft.tsx")>(new URL("../../../../../../logics/voice/useSettingsDraft.tsx", import.meta.url), runtime, {
        ...ui, "./draftRebase": draftRebase,
        "./saveBar": { changedPaths, setSaveBarEntry: (id: string, entry: SaveBarEntry | null) => { if (entry) entries.set(id, entry); else entries.delete(id); } },
    });
    // The forms save by themselves (#1111): the tests read the form drawn last where they read the
    // save bar's entry, and save it as focus leaving it does.
    let last: { value: ReturnType<typeof useSettingsDraft<Settings>>; saved: unknown; canSave: unknown } | undefined;
    const drafts = { useSettingsDraft: (...args: Parameters<typeof useSettingsDraft<Settings>>) => {
        const value = useSettingsDraft(...args);
        last = { value, saved: args[0], canSave: args[3]?.canSave };
        return value;
    } };
    const module = await loadModule<typeof import("./VoiceSettings.tsx")>(new URL("./VoiceSettings.tsx", import.meta.url), runtime, { ...ui,
        "../../../../../../logics/voice/useVoice": { useVoice: () => ({ ...voice, ...hook }) },
        "../../../../../../logics/voice/useSettingsDraft": drafts,
        "../tts/GenerationOptions": { GenerationOptions: "generation-options", validGenerationOptions: (draft: Settings) => draft.seed !== "bad" },
        "../tts/TtsEngine": { TtsEngine: "engine", TTS_ENGINES, AUDIO_QUERY_ENGINES: ["voicevox"],
            validCoeiroinkOptions: (draft: Settings) => draft.coeiroink_speed !== "bad", validAudioQueryOptions: (draft: Settings) => draft.voicevox_speed !== "bad" },
        "../device/VoiceRouteSettings": { VoiceRouteSummary: "route-summary" },
        "../tts/VirtualMicEntry": { VirtualMicEntry: "virtual-mic" },
        "./StopVoiceButton": { StopVoiceButton: "stop-voice" },
        "../../../../../../logics/voice/voiceErrorText.ts": voiceErrorText,
        "../_components/section_label_component/SectionLabelComponent": { SectionLabelComponent: "heading" },
        "./StatusLine": { StatusLine: "status" },
        "../_components/env_readout/EnvReadout": { EnvReadout: "readout" },
        "../_components/description/Description": { Description: "description" },
        "../_components/form_row/FormRow": { FormRow: "row" },
        "../_components/advanced_section/AdvancedSection": { AdvancedSection: "advanced" },
        "../_components/hint/Hint": { Hint: "hint", useHintDescriptions: () => options.hints ?? false },
    });
    const draw = () => runtime.render(module.VoiceSettings);
    // The first drawing makes the draft from the saved settings; the second shows it.
    const open = () => { draw(); return draw(); };
    const drawDevice = (title = "Output") => runtime.render(module.TtsOutputDeviceSettings, { title });
    const entry = () => {
        assert.ok(last, "the form");
        const { value, saved: savedNow, canSave } = last;
        const before: Record<string, unknown> = savedNow && typeof savedNow === "object" ? { ...savedNow } : {};
        const draft: Record<string, unknown> = value.draft && typeof value.draft === "object" ? { ...value.draft } : {};
        return { changes: [...new Set([...Object.keys(before), ...Object.keys(draft)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(draft[key])),
            canSave: typeof canSave === "function" ? !!canSave(value.draft) : canSave !== false,
            save: async () => { value.commit(); await Promise.resolve(); }, discard: () => value.discard() };
    };
    return { runtime, voice, hook, sent, draw, open, drawDevice, entry };
}

// The words a part of the tree shows.
const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};
const ofType = (tree: unknown, type: string) => nodesIn(tree).filter(node => node.type === type);
const selectNamed = (tree: unknown, name: string) => findIn(tree, node => node.type === "select" && node.props["aria-label"] === name, `the list ${name}`);
const optionsOf = (select: TreeNode) => ofType(select, "option").map(option => [option.props.value, textOf(option), option.props.disabled]);
const choose = (tree: unknown, name: string, value: string) => selectNamed(tree, name).props.onChange({ target: { value } });
const fieldsetNamed = (tree: unknown, name: string) => findIn(tree, node => node.type === "fieldset" && node.props["aria-label"] === name, `the group ${name}`);

test("until the settings arrive the page says it is loading, or that it failed, and asks again", async context => {
    const v = await voicePage(context, { settings: null });
    let tree = v.open();
    assert.deepEqual(v.sent, [["/get/data/voice_settings"], ["/get/data/voice_output_devices"]]);
    assert.deepEqual(ofType(tree, "p").map(node => [node.props.role, textOf(node)]), [["status", "voice.loading"]]);
    findIn(tree, node => node.type === "button" && textOf(node) === "voice.retry").props.onClick();
    assert.deepEqual(v.sent.at(-1), ["/get/data/voice_settings"]);
    v.voice.error = "VOICE_SETTINGS_INVALID";
    tree = v.draw();
    assert.equal(textOf(findIn(tree, node => node.type === "p")), "voice.error");
    v.draw();
    assert.equal(v.sent.length, 3, "drawn again, nothing is asked twice");
});

test("the status line says whether speech plays and how much waits, beside the stop button", async context => {
    const v = await voicePage(context, { status: { active: true, queued: 3 } });
    let tree = v.open();
    assert.deepEqual([tree.type, tree.props["aria-label"], tree.props["data-setting-id"]], ["section", "voice.title", "tts_settings"]);
    assert.deepEqual([findIn(tree, node => node.type === "heading").props.label, findIn(tree, node => node.type === "heading").props.desc],
        ["config_page.tts.tts_settings.label", "voice_ui.tts_description"]);
    let line = findIn(tree, node => node.type === "status");
    assert.deepEqual([line.props.tone, textOf(line), line.props.actions.type], ["active", "voice.playing · voice.queued: 3", "stop-voice"]);
    v.voice.status = {};
    tree = v.draw();
    line = findIn(tree, node => node.type === "status");
    assert.deepEqual([line.props.tone, textOf(line)], ["idle", "voice.idle · voice.queued: 0"]);
});

test("what is read aloud, into which slot, and to which output device", async context => {
    const v = await voicePage(context, { settings: { ...saved, output_device: "gone" } });
    let tree = v.open();
    assert.deepEqual(optionsOf(selectNamed(tree, "voice.mode")), [["off", "voice.off", undefined], ["original", "voice.original", undefined], ["translated", "voice.translated", undefined]]);
    const slot = () => selectNamed(v.draw(), "voice.target_slot");
    assert.deepEqual([slot().props.disabled, ofType(slot(), "option").map(textOf)], [true, ["1", "2", "3"]], "the slot is for translated speech only");
    choose(tree, "voice.mode", "translated");
    assert.equal(slot().props.disabled, false);
    choose(v.draw(), "voice.mode", "off");
    choose(v.draw(), "voice.mic_mode", "translated");
    assert.equal(slot().props.disabled, false, "or the microphone's translated speech");
    choose(v.draw(), "voice.target_slot", "3");
    assert.equal(slot().props.value, "3");
    tree = v.draw();
    const output = selectNamed(tree, "voice.output_device");
    assert.deepEqual([output.props.value, output.props.disabled], ["gone", false]);
    assert.deepEqual(optionsOf(output), [["", "voice.select_output", undefined], ["gone", "voice.disconnected: gone", undefined], ["speakers", "Speakers", undefined],
        ["vrct.virtual", "Virtual", undefined]]);
    const row = findIn(tree, node => node.type === "row" && node.props.label === "voice.output_device").props;
    assert.equal(row.description, "voice_ui.output_hint");
    v.sent.length = 0;
    row.actions.props.onClick();
    assert.deepEqual(v.sent.at(-1), ["/get/data/voice_output_devices"]);
    assert.equal(textOf(row.actions), "voice.refresh");
    choose(tree, "voice.output_device", "speakers");
    assert.deepEqual(optionsOf(selectNamed(v.draw(), "voice.output_device")).map(option => option[0]), ["", "speakers", "vrct.virtual"]);
    // The managed microphone plays to its own device: nothing to choose.
    const managed = await voicePage(context, { settings: { ...saved, routing: "managed" } });
    assert.equal(selectNamed(managed.open(), "voice.output_device").props.disabled, true);
    assert.ok(find(tree, node => node.type === "virtual-mic"));
});

test("each language has its speech.cpp server and voice, and Japanese can come from an installed engine instead", async context => {
    // The core always names each language's server: bundled on a new install, external for settings saved before.
    const v = await voicePage(context, { settings: { ...saved, japanese_server: "bundled", japanese_voice: "none", multilingual_server: "external", multilingual_url: "http://x",
        multilingual_voice: "Ana" } });
    let tree = v.open();
    const group = (role: string) => fieldsetNamed(v.draw(), `speech_servers.${role} · voice.title`);
    assert.equal(textOf(findIn(group("japanese"), node => node.type === "legend")), "speech_servers.japanese");
    const engine = findIn(group("japanese"), node => node.type === "engine").props;
    assert.equal(engine.saved, v.voice.settings);
    const server = selectNamed(group("japanese"), "speech_servers.japanese_selection");
    assert.deepEqual([server.props.value, optionsOf(server)], ["bundled", [["external", "speech_servers.external", undefined], ["bundled", "speech_servers.bundled", undefined]]]);
    const inputs = (role: string) => ofType(group(role), "input").map(node => [node.props.value, node.props.placeholder, node.props.maxLength]);
    // An address is in the monospaced font, a voice's name is not (#476).
    const mono = (role: string) => ofType(group(role), "input").map(node => node.props.mono);
    // The bundled server needs no address; a voice of "none" is an empty field.
    assert.deepEqual(inputs("japanese"), [["", "voice_ui.voice_unset", 128]]);
    assert.deepEqual(inputs("multilingual"), [["http://x", `voice_ui.example {"value":"http://127.0.0.1:8080"}`, 512], ["Ana", "voice_ui.voice_unset", 128]]);
    assert.deepEqual([mono("japanese"), mono("multilingual")], [[false], [true, false]]);
    assert.deepEqual(ofType(group("multilingual"), "label").map(node => [node.props.children].flat()[0]),
        ["speech_servers.multilingual_selection", "voice.multilingual_url", "voice.multilingual_voice"]);
    assert.equal(selectNamed(group("multilingual"), "speech_servers.multilingual_selection").props.value, "external");
    assert.equal(find(group("multilingual"), node => node.type === "engine"), null, "an installed engine reads Japanese only");
    ofType(group("japanese"), "input")[0].props.onChange({ target: { value: "Kei" } });
    assert.deepEqual(inputs("japanese"), [["Kei", "voice_ui.voice_unset", 128]]);
    ofType(group("japanese"), "input")[0].props.onChange({ target: { value: "" } });
    assert.deepEqual(inputs("japanese"), [["", "voice_ui.voice_unset", 128]]);
    v.draw();
    assert.deepEqual(v.entry().changes, [], "a cleared voice is saved as none again");
    choose(group("japanese"), "speech_servers.japanese_selection", "external");
    assert.equal(inputs("japanese").length, 2, "an external server needs its address");
    ofType(group("japanese"), "input")[0].props.onChange({ target: { value: "" } });
    assert.deepEqual(inputs("japanese")[0], ["", `voice_ui.example {"value":"http://127.0.0.1:8080"}`, 512], "an empty address stays empty");
    // An installed engine reads Japanese: speech.cpp's fields and its generation options go.
    engine.setDraft((draft: Settings) => ({ ...draft, japanese_engine: "coeiroink" }));
    tree = v.draw();
    assert.deepEqual(ofType(group("japanese"), "input"), []);
    assert.equal(find(group("japanese"), node => node.type === "select"), null);
    assert.deepEqual(ofType(tree, "generation-options").map(node => node.props.role), ["multilingual"]);
    engine.setDraft((draft: Settings) => ({ ...draft, japanese_engine: "speechcpp" }));
    assert.deepEqual(ofType(v.draw(), "generation-options").map(node => node.props.role), ["japanese", "multilingual"]);
});

test("the advanced fold's line says whether the monitor and the microphone's speech are on", async context => {
    const status = async (settings: Settings) => {
        const v = await voicePage(context, { settings: { ...saved, ...settings } });
        return findIn(v.open(), node => node.type === "advanced").props.status;
    };
    const line = (monitor: string, mic: string) => `config_page.advanced_status.tts ${JSON.stringify({ monitor: `config_page.advanced_status.${monitor}`, mic: `config_page.advanced_status.${mic}` })}`;
    assert.equal(await status({}), line("off", "off"));
    assert.equal(await status({ monitor: "on", mic_mode: "original" }), line("on", "on"));
    assert.equal(await status({ mic_mode: "translated" }), line("off", "on"));
});

test("the monitor plays to a device of the user's choice, never the virtual microphone's or the output's own, at a volume", async context => {
    const v = await voicePage(context, { settings: { ...saved, output_device: "speakers", monitor_device: "unplugged" },
        devices: { devices: [{ id: "speakers", label: "Speakers" }, { id: "headset", label: "Headset" }, { id: "earbuds", label: "Earbuds" }, { id: "vrct.virtual", label: "Virtual" }] } });
    v.open();
    const monitor = () => findIn(v.draw(), node => node.type === "fieldset" && node.props["data-setting-id"] === "tts_monitor");
    assert.equal(monitor().props["aria-label"], "voice_ui.monitor_heading");
    assert.deepEqual(ofType(monitor(), "description").map(node => node.props.text), ["voice.monitor_hint"]);
    assert.equal(find(monitor(), node => node.type === "hint"), null);
    assert.deepEqual(optionsOf(selectNamed(monitor(), "voice.monitor")), [["off", "voice.monitor_off", undefined], ["on", "voice.monitor_on", undefined]]);
    const device = () => selectNamed(monitor(), "voice.monitor_device");
    assert.deepEqual([device().props.disabled, device().props.value], [true, "unplugged"]);
    assert.deepEqual(optionsOf(device()), [["", "voice.monitor_default", undefined], ["unplugged", "voice.disconnected: unplugged", undefined], ["headset", "Headset", undefined],
        ["earbuds", "Earbuds", undefined]]);
    const volume = () => findIn(monitor(), node => node.type === "input" && node.props.type === "range");
    assert.deepEqual([volume().props.min, volume().props.max, volume().props.step, volume().props["aria-label"], volume().props.value, volume().props.style, volume().props.disabled],
        ["0", "100", "5", "voice.monitor_volume", "100", { "--range-fill": "100%" }, true]);
    assert.equal(textOf(findIn(monitor(), node => node.type === "label" && find(node, inner => inner.props?.type === "range") !== null)), "voice.monitor_volume: 100%");
    choose(monitor(), "voice.monitor", "on");
    assert.deepEqual([device().props.disabled, volume().props.disabled], [false, false]);
    volume().props.onChange({ target: { value: 60 } });
    assert.deepEqual([volume().props.value, volume().props.style], ["60", { "--range-fill": "60%" }]);
    choose(monitor(), "voice.monitor_device", "headset");
    assert.deepEqual(optionsOf(device()).map(option => option[0]), ["", "headset", "earbuds"]);
    choose(monitor(), "voice.monitor_device", "");
    assert.equal(device().props.value, "");
    // With the managed microphone the output device is not the monitor's to avoid.
    const managed = await voicePage(context, { settings: { ...saved, routing: "managed", output_device: "speakers" } });
    assert.deepEqual(optionsOf(selectNamed(managed.open(), "voice.monitor_device")).map(option => option[0]), ["", "speakers"]);
    // A monitor error, in its words or the general one.
    v.voice.status = { monitor_error: "device_lost" };
    assert.deepEqual(ofType(monitor(), "readout").map(node => [node.props.tone, textOf(node)]), [["failed", "voice.monitor_errors.device_lost"]]);
    v.voice.status = { monitor_error: "absent_reason" };
    assert.deepEqual(ofType(monitor(), "readout").map(node => textOf(node)), ["voice.monitor_error"]);
});

test("on a page that keeps descriptions out of sight, what the monitor plays is its heading's hint", async context => {
    const v = await voicePage(context, {}, { hints: true });
    const monitor = findIn(v.open(), node => node.type === "fieldset" && node.props["data-setting-id"] === "tts_monitor");
    const host = findIn(monitor, node => node.props?.["data-hint-host"] === true);
    assert.equal(textOf(host), "voice_ui.monitor_heading");
    assert.deepEqual([findIn(host, node => node.type === "hint").props.text, findIn(host, node => node.type === "hint").props.focusable], ["voice.monitor_hint", true]);
    assert.equal(find(monitor, node => node.type === "description"), null);
    const plain = await voicePage(context);
    assert.equal(find(plain.open(), node => node.props?.["data-hint-host"] !== undefined), null);
});

test("each speech.cpp language has its generation options, whose error is said once under the form", async context => {
    const v = await voicePage(context, { settings: { ...saved, seed: "bad" } });
    const tree = v.open();
    const groups = ofType(tree, "fieldset").filter(node => String(node.props["aria-label"]).endsWith("voice_ui.generation_heading"));
    assert.deepEqual(groups.map(node => [node.props["aria-label"], textOf(findIn(node, inner => inner.type === "legend"))]), [
        ["speech_servers.japanese · voice_ui.generation_heading", "speech_servers.japanese · voice_ui.generation_heading"],
        ["speech_servers.multilingual · voice_ui.generation_heading", "speech_servers.multilingual · voice_ui.generation_heading"]]);
    const alert = findIn(tree, node => node.type === "p" && node.props.role === "alert");
    assert.equal(textOf(alert), "voice_ui.invalid_options");
    for (const options of ofType(tree, "generation-options")) assert.equal(options.props.errorId, alert.props.id);
    const options = ofType(tree, "generation-options")[0].props;
    assert.equal(options.draft.seed, "bad");
    options.field("seed", "1");
    assert.equal(find(v.draw(), node => node.type === "p" && node.props.role === "alert"), null);
});

test("the microphone's captions can be read aloud, which decides whether the voice is suppressed or mixed, and the conversion rules out mixing", async context => {
    const v = await voicePage(context, { settings: { ...saved, direct_policy: "mix" } });
    let tree = v.open();
    const row = findIn(tree, node => node.type === "row" && node.props.label === "voice.mic_mode").props;
    assert.equal(row.description, "voice.mic_hint");
    assert.deepEqual(optionsOf(selectNamed(tree, "voice.mic_mode")).map(option => option[0]), ["off", "original", "translated"]);
    const policy = () => selectNamed(v.draw(), "voice.direct_policy");
    assert.deepEqual([policy().props.disabled, policy().props.value], [true, "mix"]);
    assert.deepEqual(optionsOf(policy()), [["suppress", "voice.direct_suppress", undefined], ["mix", "voice.direct_mix", false]]);
    choose(v.draw(), "voice.mic_mode", "original");
    assert.equal(policy().props.disabled, false);
    const conversion = () => selectNamed(v.draw(), "voice.conversion");
    assert.deepEqual([conversion().props.value, optionsOf(conversion()).map(option => option.slice(0, 2))], ["off", [["off", "voice.conversion_off"], ["on", "voice.conversion_on"]]]);
    assert.equal(findIn(v.draw(), node => node.type === "row" && node.props.label === "voice.conversion").props.description, "voice.conversion_hint");
    choose(v.draw(), "voice.conversion", "on");
    assert.deepEqual([conversion().props.value, policy().props.value, optionsOf(policy())[1][2]], ["on", "suppress", true], "mixing goes with the conversion on");
    choose(v.draw(), "voice.conversion", "off");
    choose(v.draw(), "voice.direct_policy", "mix");
    assert.equal(policy().props.value, "mix");
    // Turning the conversion off leaves the choice as it is.
    choose(v.draw(), "voice.conversion", "on");
    choose(v.draw(), "voice.direct_policy", "mix");
    choose(v.draw(), "voice.conversion", "off");
    assert.equal(policy().props.value, "mix");
    // Suppressing stays as it is when the conversion is turned on.
    choose(v.draw(), "voice.direct_policy", "suppress");
    choose(v.draw(), "voice.conversion", "on");
    assert.equal(policy().props.value, "suppress");
    tree = v.draw();
    // Settings saved before these fields existed show their defaults.
    const old = await voicePage(context, { settings: { mode: "off", target_slot: "1", output_device: "", routing: "external" } });
    const shown = old.open();
    assert.deepEqual(["voice.mic_mode", "voice.direct_policy", "voice.conversion", "voice.monitor"].map(name => selectNamed(shown, name).props.value),
        ["off", "suppress", "off", "off"]);
    assert.ok(tree);
});

test("the form saves only valid settings, and writes only what changed", async context => {
    const v = await voicePage(context);
    v.open();
    assert.equal(v.entry().canSave, true);
    const engine = () => findIn(v.draw(), node => node.type === "engine").props;
    for (const field of ["seed", "coeiroink_speed", "voicevox_speed"]) {
        engine().setDraft((draft: Settings) => ({ ...draft, [field]: "bad" }));
        v.draw();
        assert.equal(v.entry().canSave, false, field);
        engine().setDraft((draft: Settings) => ({ ...draft, [field]: 1 }));
        v.draw();
        assert.equal(v.entry().canSave, true, field);
        v.entry().discard();
    }
    let tree = v.draw();
    choose(tree, "voice.mode", "original");
    tree = v.draw();
    let prevented = 0;
    findIn(tree, node => node.type === "form").props.onSubmit({ preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1);
    assert.deepEqual(v.sent.at(-1), ["/set/data/voice_settings", { mode: "original" }]);
    // Enter in a form with nothing changed, or with an invalid field, writes nothing.
    const writes = () => v.sent.filter(call => call[0] === "/set/data/voice_settings").length;
    const fresh = await voicePage(context);
    tree = fresh.open();
    findIn(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(fresh.sent.some(call => call[0] === "/set/data/voice_settings"), false);
    findIn(tree, node => node.type === "engine").props.setDraft((draft: Settings) => ({ ...draft, seed: "bad", mode: "translated" }));
    findIn(fresh.draw(), node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(fresh.sent.some(call => call[0] === "/set/data/voice_settings"), false);
    assert.equal(writes(), 1);
});

test("what failed last is said under the form: the page's error, the playback's or the devices'", async context => {
    const alert = async (given: Partial<Voice>, known: string[] = []) => {
        const v = await voicePage(context, given, { known });
        return ofType(v.open(), "p").filter(node => node.props.role === "alert").map(textOf);
    };
    assert.deepEqual(await alert({ error: "busy", status: { last_error: "later" } }, ["voice_ui.errors.busy"]), ["voice.error: voice_ui.errors.busy (busy)"]);
    assert.deepEqual(await alert({ status: { last_error: "tts_failed" }, devices: { error: "later" } }, ["voice.input_errors.tts_failed"]),
        ["voice.error: voice.input_errors.tts_failed (tts_failed)"]);
    assert.deepEqual(await alert({ devices: { error: "no devices" } }), [`voice.error: no devices · voice_ui.check_settings {"page":"config_page.tts.tts_settings.label"}`]);
    assert.deepEqual(await alert({}), []);
});

test("the output device alone, for other pages, edits the same voice settings", async context => {
    const v = await voicePage(context, { settings: null });
    const draw = () => { v.drawDevice("VRChat output"); return v.drawDevice("VRChat output"); };
    let tree = draw();
    assert.deepEqual([tree.props["aria-label"], tree.props["data-setting-id"], findIn(tree, node => node.type === "heading").props.label],
        ["VRChat output", "tts_output_device", "VRChat output"]);
    assert.deepEqual(ofType(tree, "p").map(node => [node.props.role, textOf(node)]), [["status", "voice.loading"]]);
    assert.deepEqual(v.sent, [["/get/data/voice_settings"], ["/get/data/voice_output_devices"]]);
    v.voice.error = "failed";
    assert.equal(textOf(findIn(v.drawDevice("VRChat output"), node => node.type === "p")), "voice.error");
    v.voice.error = null;
    v.voice.settings = { ...saved, output_device: "gone" };
    tree = draw();
    const output = selectNamed(tree, "voice.output_device");
    assert.deepEqual([output.props.value, output.props.disabled, optionsOf(output).map(option => option.slice(0, 2))],
        ["gone", false, [["", "voice.select_output"], ["gone", "voice.disconnected: gone"], ["speakers", "Speakers"], ["vrct.virtual", "Virtual"]]]);
    const row = findIn(tree, node => node.type === "row").props;
    assert.deepEqual([row.label, row.description, textOf(row.actions)], ["voice.output_device", "voice_ui.output_hint", "voice.refresh"]);
    v.sent.length = 0;
    row.actions.props.onClick();
    assert.deepEqual(v.sent, [["/get/data/voice_output_devices"]]);
    assert.ok(find(tree, node => node.type === "virtual-mic"));
    output.props.onChange({ target: { value: "speakers" } });
    tree = v.drawDevice("VRChat output");
    assert.equal(selectNamed(tree, "voice.output_device").props.value, "speakers");
    assert.deepEqual(optionsOf(selectNamed(tree, "voice.output_device")).map(option => option[0]), ["", "speakers", "vrct.virtual"], "found again: not disconnected");
    assert.deepEqual(v.entry().changes, ["output_device"]);
    assert.equal(v.entry().canSave, true);
    await v.entry().save();
    assert.deepEqual(v.sent.at(-1), ["/set/data/voice_settings", { output_device: "speakers" }]);
    v.voice.settings = { ...saved, routing: "managed" };
    assert.equal(selectNamed(draw(), "voice.output_device").props.disabled, true);
});

test("the output device alone names a setting the locale lacks by its field, asks again on a new connection, and lists nothing before the devices", async context => {
    missingKeys.add("voice.output_device");
    context.onTestFinished(() => missingKeys.clear());
    const v = await voicePage(context, { devices: {} });
    v.drawDevice();
    let tree = v.drawDevice();
    assert.deepEqual(optionsOf(selectNamed(tree, "voice.output_device")).map(option => option[0]), [""]);
    selectNamed(tree, "voice.output_device").props.onChange({ target: { value: "headset" } });
    tree = v.drawDevice();
    assert.deepEqual(optionsOf(selectNamed(tree, "voice.output_device")).map(option => option.slice(0, 2)), [["", "voice.select_output"], ["headset", "voice.disconnected: headset"]]);
    assert.deepEqual(v.entry().changes, ["output_device"]);
    v.sent.length = 0;
    v.hook.send = (endpoint: string) => { v.sent.push(["new", endpoint]); return true; };
    v.drawDevice();
    assert.deepEqual(v.sent, [["new", "/get/data/voice_settings"], ["new", "/get/data/voice_output_devices"]]);
});

test("each list's visible words are its name, and the conversion turned on without a saved choice changes nothing else", async context => {
    const v = await voicePage(context, { settings: { mode: "off", target_slot: "1", output_device: "", routing: "external" } });
    const tree = v.open();
    for (const name of ["voice.mode", "voice.target_slot", "voice.monitor", "voice.monitor_device", "voice.direct_policy"]) {
        const label = findIn(tree, node => node.type === "label" && find(node, inner => inner.type === "select" && inner.props["aria-label"] === name) !== null, name);
        assert.equal([label.props.children].flat()[0], name);
    }
    choose(tree, "voice.conversion", "on");
    v.draw();
    assert.deepEqual(v.entry().changes, ["conversion"]);
    // Turned on over a mix, the voice is suppressed, and the save writes that.
    const mixed = await voicePage(context, { settings: { ...saved, direct_policy: "mix" } });
    choose(mixed.open(), "voice.conversion", "on");
    mixed.draw();
    await mixed.entry().save();
    assert.deepEqual(mixed.sent.at(-1), ["/set/data/voice_settings", { direct_policy: "suppress", conversion: "on" }]);
});

test("a save writes the changed settings, and a new connection asks for the settings again", async context => {
    const v = await voicePage(context);
    v.open();
    choose(v.draw(), "voice.monitor", "on");
    v.draw();
    await v.entry().save();
    assert.deepEqual(v.sent.at(-1), ["/set/data/voice_settings", { monitor: "on" }]);
    v.sent.length = 0;
    v.hook.send = (endpoint: string) => { v.sent.push(["new", endpoint]); return true; };
    v.draw();
    assert.deepEqual(v.sent, [["new", "/get/data/voice_settings"], ["new", "/get/data/voice_output_devices"]]);
});
