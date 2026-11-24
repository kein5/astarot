import assert from "node:assert/strict";
import * as usagePresetsModule from "../../../logics/configs/usagePresets.ts";
import { test } from "vitest";
import type { TFunction } from "i18next";
import { hooks, loadModule, find, unchecked, draw, treeNode } from "../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../logics/test/hookHarness.ts";
import { loadBridgeStore } from "../../../logics/test/bridgeHarness.ts";
import { chunkArray } from "../../../logics/utils.ts";
import * as routeState from "../../../logics/voice/routeState.ts";
import * as rvcStartOptions from "../../../logics/voice/rvcStartOptions.ts";
import { voiceActions, voiceSwitchStates } from "../../../logics/voice/voiceActions.ts";
import * as voiceErrorText from "../../../logics/voice/voiceErrorText.ts";
import * as featureLabel from "../../../logics/common/featureLabel.ts";
import * as switchBlocksModule from "../../../logics/main/switchBlocks.ts";
import * as sameLanguage from "../../../logics/main/sameLanguage.ts";
import * as translatorLabel from "../../../logics/main/translatorLabel.ts";
import * as translatorPlacement from "./sidebar_section/language_settings/translator_selector_open_button/translator_selector/translatorPlacement.ts";

type BridgeStore = Awaited<ReturnType<typeof loadBridgeStore>>;
type SwitchModule = typeof import("./sidebar_section/main_function_switch/MainFunctionSwitch.tsx");
type SwitchProps = Parameters<SwitchModule["SwitchContainer"]>[0];
interface SwitchSetup {
    blocks: Record<string, { reason: string; action: string | null }>;
    compact: boolean;
    prepared?: string[];
    presets?: string[] | null;
    // The switches the first-run setup leads to (#955), and those it was told are on.
    leads?: string[];
    settled?: string[];
}
// A part of the page drawn as React would call it.
type Part = (props?: unknown) => TreeNode;

const MAIN_FUNCTIONS = ["Translation", "TranscriptionSend", "TranscriptionReceive", "OcrCapture"] as const;
// The sources whose switch waits for the bundled ASR server, as useRealtimeASR keeps them (#1149).
const realtimeServerStarting: Partial<Record<"mic" | "speaker", boolean>> = {};

const icon = () => null;
const keydown = (control: TreeNode, key: string, repeat = false) => {
    let prevented = false;
    control.props.onKeyDown({ key, repeat, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
};
// Test data: a switch drawn with only the props its keys and clicks read.
const switchProps = (props: object) => unchecked<SwitchProps>(props);
// A control is drawn inside its tooltip, an element named "tooltip" that keeps the bubble's words
// in `title` (hookHarness). This is the control: the tooltip adds no role and takes no key.
const inTooltip = (tree: TreeNode): TreeNode => {
    assert.equal(tree.type, "tooltip");
    const control = treeNode(tree.props.children);
    assert.ok(control);
    return control;
};
// Test data: the engine's child process, only there: the switches check that one runs, nothing more.
const runningChild = () => unchecked<NonNullable<BridgeStore["stores"]["store"]["backend_subprocess"]>>({});
// Test data: a t of the test's own, which answers the key or records what it is asked.
const translate = (t: (key: string, options?: { page?: string }) => string) => unchecked<TFunction>(t);

const loadSwitches = async (b: BridgeStore, voice: object = {}, setup: SwitchSetup = { blocks: {}, compact: false }, starting = false) => {
    const requests: string[] = [];
    const main = await loadModule<typeof import("../../../logics/main/useMainFunction.ts")>(new URL("../../../logics/main/useMainFunction.ts", import.meta.url), b.runtime, {
        "@store": b.stores,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: (endpoint: string) => requests.push(endpoint) }) },
    });
    const switches = await loadModule<SwitchModule>(new URL("./sidebar_section/main_function_switch/MainFunctionSwitch.tsx", import.meta.url), b.runtime, {
        "@store": b.stores,
        "@logics_common": { useIsBackendReady: b.stores.useStore_IsBackendReady },
        "../../../../../logics/common/useNotificationStatus": { useNotificationStatus: () => ({ showNotification_Error() {} }) },
        "../../../../../logics/transcription/useRealtimeASR": { useRealtimeASR: () => ({ serverStarting: realtimeServerStarting }) },
        "../../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../../../../../logics/voice/voiceActions.ts": { voiceActions, voiceSwitchStates },
        "../../../../../logics/voice/routeState": routeState,
        "../../../../../logics/voice/rvcStartOptions": rvcStartOptions,
        "../../../../../logics/common/featureLabel.ts": featureLabel,
        "../../../../../logics/voice/voiceErrorText.ts": voiceErrorText,
        "../../../../../logics/main/switchBlocks": switchBlocksModule,
        "../../../../../logics/main/useSwitchBlocks": { useSwitchBlocks: () => ({ blocks: setup.blocks, prepare: (action: string) => setup.prepared?.push(action) }) },
        "../../../../../logics/setup/useSetupLeads": { useSetupLeads: () => ({ leads: setup.leads ?? [], settle: (id: string) => setup.settled?.push(id) }) },
        "../../startupContext": { useIsStartingUp: () => starting },
        "@logics_main": { ...main, useIsMainPageCompactMode: () => ({ currentIsMainPageCompactMode: { data: setup.compact } }) },
        "@logics_configs": { useUsagePresets: () => ({ currentUsagePresets: { data: "presets" in setup ? setup.presets : ["all"] } }) },
        "../../../../../logics/configs/usagePresets.ts": usagePresetsModule,
        "../../../../common_components/toggle_switch/ToggleSwitch": { ToggleSwitch: icon },
    });
    return { ...switches, ...main, requests };
};

for (const key of ["Enter", " "]) test(`holding ${JSON.stringify(key)} cannot restart a main function after its stop acknowledgement`, async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    const s = await loadSwitches(b);
    for (const [name, endpoint] of [["Translation", "translation"], ["TranscriptionSend", "transcription_send"],
        ["TranscriptionReceive", "transcription_receive"], ["OcrCapture", "ocr_capture"]] as const) {
        const atom = b.stores[`Atom_${name}Status`];
        b.runtime.store.set(atom, { data: true, state: "ok" });
        const render = () => {
            const main = s.useMainFunction();
            return inTooltip(b.runtime.render(s.SwitchContainer, switchProps({ SvgComponent: icon, currentState: main[`current${name}Status`],
                toggleFunction: main[`toggle${name}`] })));
        };
        const before = s.requests.length, control = render();
        keydown(control, key);
        // Even a second fresh event before React renders must use the synchronous pending guard.
        keydown(control, key);
        assert.deepEqual(s.requests.slice(before), [`/set/disable/${endpoint}`]);
        b.runtime.store.set(atom, { data: false, state: "ok" });
        keydown(render(), key, true);
        assert.deepEqual(s.requests.slice(before), [`/set/disable/${endpoint}`]);
        keydown(render(), key);
        assert.deepEqual(s.requests.slice(before), [`/set/disable/${endpoint}`, `/set/enable/${endpoint}`]);
    }
});

test("TTS and RVC ignore held keys but allow a fresh press to cancel their pending starts", async () => {
    const b = await loadBridgeStore(), sent: string[] = [];
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_generation: 1 }, ttsPending: { intent: true }, directOwner: "rvc",
        directPending: { intent: true }, directState: { observation_id: "one", pending: true },
        send: (endpoint: string) => sent.push(endpoint) };
    const s = await loadSwitches(b, voice);
    for (const id of ["tts", "rvc"]) {
        const item = find(b.runtime.render(s.MainFunctionSwitch), node => node.props.switch_id === id);
        assert.ok(item);
        const control = inTooltip(s.SwitchContainer(item.props)), before = sent.length;
        keydown(control, "Enter", true);
        keydown(control, " ", true);
        assert.equal(sent.length, before);
        keydown(control, "Enter");
        assert.equal(sent.at(-1), id === "tts" ? "/run/disable_tts" : "/run/stop_direct_voice");
    }
});

test("the TTS and RVC hotkeys press the switches with the state of the moment", async () => {
    const b = await loadBridgeStore(), sent: unknown[][] = [];
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice: Record<string, unknown> = { status: { tts_generation: 4 }, directState: {}, send: (...args: unknown[]) => sent.push(args) };
    const s = await loadSwitches(b, voice);
    b.runtime.render(s.MainFunctionSwitch);
    assert.ok(voiceActions.toggleTts);
    voiceActions.toggleTts();
    assert.deepEqual(sent.at(-1), ["/run/enable_tts", { generation: 4 }]);
    // The shortcut was registered before TTS came on; pressing it now turns TTS off.
    voice.status = { tts_generation: 5, tts_enabled: true };
    b.runtime.render(s.MainFunctionSwitch);
    voiceActions.toggleTts();
    assert.deepEqual(sent.at(-1), ["/run/disable_tts"]);
    voice.directOwner = "rvc";
    voice.directState = { observation_id: "one", requested: true };
    b.runtime.render(s.MainFunctionSwitch);
    assert.ok(voiceActions.toggleRvc);
    voiceActions.toggleRvc();
    assert.deepEqual(sent.at(-1), ["/run/stop_direct_voice"]);
});

test("disconnected main switches hide retained activity and reject clicks, keys and stale handlers", async () => {
    const b = await loadBridgeStore(), sent: string[] = [];
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_enabled: true, tts_generation: 1 }, directOwner: "rvc",
        directState: { observation_id: "one", requested: true }, send: (endpoint: string) => sent.push(endpoint) };
    const s = await loadSwitches(b, voice);
    for (const name of MAIN_FUNCTIONS)
        b.runtime.store.set(b.stores[`Atom_${name}Status`], { data: true, state: "ok" });
    const live = b.runtime.render(s.MainFunctionSwitch);
    const main = s.useMainFunction();
    b.stores.store.backend_subprocess = null;
    b.stores.store.backend_stopped = true;
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: false, state: "ok" });
    for (const item of live.props.children) item.props.toggleFunction();
    for (const name of MAIN_FUNCTIONS) {
        main[`set${name}`](true);
        assert.deepEqual(b.runtime.store.get(b.stores[`Atom_${name}Status`]), { data: true, state: "ok" });
    }
    const disconnected = b.runtime.render(s.MainFunctionSwitch);
    for (const item of disconnected.props.children) {
        const drawn = s.SwitchContainer(item.props);
        const control = inTooltip(drawn);
        assert.equal(control.props["aria-disabled"], true);
        assert.equal(control.props["aria-checked"], false);
        assert.equal(control.props["aria-busy"], false);
        assert.match(control.props["aria-label"], /main_page.backend_disconnected/);
        assert.doesNotMatch(control.props.className, /is_active/);
        // The rail says it once at its head (EngineReadout): no line under the switch, so no row
        // grows. The switch keeps the reason in its name (above) and in its tooltip.
        assert.equal(item.props.statusText, null);
        assert.equal(find(control, node => node.props.children === "main_page.backend_disconnected"), null);
        assert.equal(find(control, node => node.props.role === "status"), null);
        assert.equal(drawn.props.title, "main_page.backend_disconnected");
        control.props.onClick();
        keydown(control, "Enter");
        keydown(control, " ");
    }
    assert.deepEqual(s.requests, []);
    assert.deepEqual(sent, []);
});

test("#1149: a speech recognition switch that waits for the bundled server says the server is starting", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const s = await loadSwitches(b, { status: { tts_generation: 1 }, directState: { observation_id: "one" } });
    b.runtime.store.set(b.stores.Atom_TranscriptionSendStatus, { data: false, state: "pending" });
    b.runtime.store.set(b.stores.Atom_TranscriptionReceiveStatus, { data: false, state: "pending" });
    const shown = () => Object.fromEntries(b.runtime.render(s.MainFunctionSwitch).props.children
        .map((item: TreeNode) => [item.props.switch_id, item.props.statusText]));
    try {
        assert.equal(shown().transcription_send, null, "waiting, but not for the server");
        realtimeServerStarting.mic = true;
        assert.equal(shown().transcription_send, "main_page.speech_server_starting");
        assert.equal(shown().transcription_receive, null, "the game audio's switch waits for no server");
        // Once the switch has its answer, it waits no more.
        b.runtime.store.set(b.stores.Atom_TranscriptionSendStatus, { data: true, state: "ok" });
        assert.equal(shown().transcription_send, null);
    } finally {
        delete realtimeServerStarting.mic;
    }
});

test("while the engine starts, the switches are locked placeholders, not disconnected", async () => {
    const b = await loadBridgeStore(), sent: string[] = [];
    const voice = { status: { tts_generation: 1 }, directState: { observation_id: "one" }, send: (endpoint: string) => sent.push(endpoint) };
    const s = await loadSwitches(b, voice, undefined, true);
    const starting = b.runtime.render(s.MainFunctionSwitch);
    for (const item of starting.props.children) {
        assert.equal(item.props.statusText, null);
        const control = inTooltip(s.SwitchContainer(item.props));
        assert.equal(control.props["aria-disabled"], true);
        assert.equal(control.props["aria-checked"], false);
        assert.equal(control.props["aria-label"], item.props.switchLabel);
        assert.equal(find(control, node => node.props.children === "main_page.backend_disconnected"), null);
        // The toggle's state comes from the engine: a placeholder of the same size until then.
        const toggle = find(control, node => node.type === icon);
        assert.ok(toggle);
        assert.equal(toggle.props.skeleton, true);
        control.props.onClick();
    }
    assert.deepEqual(s.requests, []);
    assert.deepEqual(sent, []);
});

test("VR main-function actions still use the mirrored transport without owning a child", async () => {
    const b = await loadBridgeStore();
    b.stores.store.is_vr_panel = true;
    const s = await loadSwitches(b);
    const main = s.useMainFunction();
    main.toggleTranscriptionSend();
    main.setTranscriptionReceive(false);
    assert.deepEqual(s.requests, ["/set/enable/transcription_send", "/set/disable/transcription_receive"]);
});

test("main language and log div buttons activate only on fresh Enter or Space presses", async () => {
    const runtime = hooks(), actions: string[] = [];
    let opened: unknown = false;
    const language = {
        canChangeLanguageSettings: () => true, isLanguageSettingsBusy: false,
        currentSelectedPresetTabNumber: { data: "1" },
        currentSelectedYourLanguages: { data: { "1": { "1": { language: "Japanese", country: "Japan" } } } },
        // Two targets: both the remove and the add button are available (AddRemoveTargetLanguageButtons).
        currentSelectedTargetLanguages: { data: { "1": { "1": { language: "English", enable: true }, "2": { language: "Korean", enable: true }, "3": {} } } },
        currentTranslationEngines: { data: [{ id: "one", label: "One" }] },
        currentSelectedTranslationEngines: { data: { "1": "one" } },
        setSelectedPresetTabNumber: () => actions.push("preset"),
        setSelectedTranslationEngines: () => actions.push("engine"),
        swapSelectedLanguages: () => actions.push("swap"),
        addTargetLanguage: () => actions.push("add"), removeTargetLanguage: () => actions.push("remove"),
    };
    const imports = { "@logics_main": { useLanguageSettings: () => language }, "@utils": { chunkArray },
        "@store": { useStore_IsOpenedTranslatorSelector: () => ({ currentIsOpenedTranslatorSelector: { data: opened },
            updateIsOpenedTranslatorSelector: (value: unknown) => { opened = value; actions.push("open"); } }) },
        "./translator_selector/TranslatorSelector": {}, "@setting_box": { MessageLogUiScalingContainer: icon },
        "../../../../../../logics/main/sameLanguage.ts": sameLanguage,
        "../../../../../../logics/main/translatorLabel.ts": translatorLabel,
        "../../../../../../../logics/main/translatorLabel.ts": translatorLabel,
        "./translatorPlacement.ts": translatorPlacement,
        "react-dom": { createPortal: (node: unknown) => node } };
    const cases = [
        ["sidebar_section/language_settings/preset_tab_selector/PresetTabSelector.tsx", "PresetTabSelector", {}],
        ["sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton.tsx", "TranslatorSelectorOpenButton", {}],
        ["sidebar_section/language_settings/translator_selector_open_button/translator_selector/TranslatorSelector.tsx", "TranslatorSelector",
            { translation_engines: [{ id: "two", label: "Two", is_available: true }], selected_id: "one" }],
        ["sidebar_section/language_settings/language_swap_button/LanguageSwapButton.tsx", "LanguageSwapButton", {}],
        ["sidebar_section/language_settings/add_remove_target_language_buttons/AddRemoveTargetLanguageButtons.tsx", "AddRemoveTargetLanguageButtons", {}],
        ["main_section/message_container/message_log_settings_container/MessageLogSettingsContainer.tsx", "MessageLogSettingsContainer", {}],
    ] as const;
    // The drawn controls a key can press: role="button", through the parts each draws of its own.
    const controls = (tree: unknown): TreeNode[] => {
        const node = treeNode(tree);
        if (!node) return [];
        // A part the page draws of its own, drawn as React would.
        if (typeof node.type === "function") return controls(draw(node));
        return [node.props.role === "button" ? node : null,
            ...[node.props.children].flat(Infinity).flatMap(controls)].filter((control): control is TreeNode => Boolean(control));
    };
    for (const [path, name, props] of cases) {
        // Each case's module draws the part named in it with the case's props.
        const module = await loadModule<Record<string, Part>>(new URL(path, import.meta.url), runtime, imports);
        for (const key of ["Enter", " "]) {
            const render = () => controls(runtime.render(module[name], props));
            for (let index = 0; index < render().length; index++) {
                const before = actions.length;
                keydown(render()[index], key);
                const after = actions.length;
                const expanded = render()[index].props["aria-expanded"];
                keydown(render()[index], key, true);
                assert.equal(actions.length, after, `${name}: ${key}`);
                assert.equal(render()[index].props["aria-expanded"], expanded, `${name}: ${key}`);
                assert.ok(after > before || expanded !== undefined);
            }
        }
    }
});

test("a switch whose setup is missing is disabled, says why, and its icon leads to the setup", async () => {
    const b = await loadBridgeStore(), sent: string[] = [], prepared: string[] = [];
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_generation: 1 }, directState: {}, send: (endpoint: string) => sent.push(endpoint) };
    const setup: SwitchSetup = { compact: false, prepared, blocks: {
        translation: { reason: "translation_model", action: "translation" },
        ocr: { reason: "ocr_models", action: "ocr_models" },
        tts: { reason: "tts_source", action: "tts" },
        transcription_send: { reason: "translation_downloading", action: null },
    } };
    const s = await loadSwitches(b, voice, setup);
    const rows: TreeNode[] = b.runtime.render(s.MainFunctionSwitch).props.children;
    const at = (id: string) => rows.findIndex(node => node.props.switch_id === id);
    for (const id of ["translation", "ocr", "tts", "transcription_send"]) {
        const props = rows[at(id)].props;
        assert.equal(props.blockedReason, `main_page.switch_blocked.${setup.blocks[id].reason}`);
        const drawn = s.SwitchContainer(props);
        const control = inTooltip(drawn), before = s.requests.length + sent.length;
        assert.equal(control.props["aria-disabled"], true);
        // The reason is the tooltip, beside the rail; no title attribute is left on the switch.
        assert.equal(drawn.props.title, props.blockedReason);
        assert.equal(drawn.props.placement, "right");
        assert.equal(control.props.title, undefined);
        assert.equal(control.props["aria-describedby"], `main_switch_${id}_reason`);
        // Still in the tab order, so the reason can be heard; pressing does nothing.
        assert.equal(control.props.tabIndex, 0);
        control.props.onClick();
        control.props.onKeyDown({ key: "Enter", preventDefault() {} });
        assert.equal(s.requests.length + sent.length, before);
    }
    // No button is added under a switch: one row per feature, whatever is missing.
    assert.equal(rows.length, 6);
    // The way to the setup is the icon beside the switch; waiting sends it to the usual page.
    const iconButton = (id: string) => {
        const button = find(s.SwitchRow(rows[at(id)].props), node => node.type === "button");
        assert.ok(button);
        return button;
    };
    for (const id of ["translation", "ocr", "tts", "transcription_send"]) iconButton(id).props.onClick();
    assert.deepEqual(prepared, ["translation", "ocr_models", "tts", "transcription"]);
    assert.equal(iconButton("translation").props["aria-label"], "main_page.feature_settings.translation_model");
    assert.equal(iconButton("tts").props["aria-label"], "main_page.feature_settings.open_page");
    // Switches without a block keep working.
    const free = rows[at("transcription_receive")].props;
    assert.equal(free.blockedReason, null);
    assert.equal(inTooltip(s.SwitchContainer(free)).props["aria-disabled"], false);
});

test("a switch that is on stays usable when its setup goes missing, so it can be turned off", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    b.runtime.store.set(b.stores.Atom_OcrCaptureStatus, { data: true, state: "ok" });
    const s = await loadSwitches(b, { status: {}, directState: {} },
        { compact: false, blocks: { ocr: { reason: "ocr_models", action: "ocr" } } });
    const rows: TreeNode[] = b.runtime.render(s.MainFunctionSwitch).props.children;
    const index = rows.findIndex(node => node.props.switch_id === "ocr");
    assert.equal(rows[index].props.blockedReason, null);
    assert.equal(rows.length, 6);
    const before = s.requests.length;
    inTooltip(s.SwitchContainer(rows[index].props)).props.onClick();
    assert.deepEqual(s.requests.slice(before), ["/set/disable/ocr_capture"]);
});

test("in the icon rail a blocked switch names itself in its tooltip and has no button", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const s = await loadSwitches(b, { status: {}, directState: {} },
        { compact: true, blocks: { ocr: { reason: "ocr_models", action: "ocr" } } });
    const rows: TreeNode[] = b.runtime.render(s.MainFunctionSwitch).props.children;
    const found = rows.find(node => node.props.switch_id === "ocr");
    assert.ok(found);
    const props = found.props;
    // The rail has room for one target per feature: the icon stays part of the switch.
    const row = s.SwitchRow(props);
    assert.equal(row.type, s.SwitchContainer);
    assert.equal(find(s.SwitchContainer(row.props), node => node.type === "button"), null);
    assert.equal(s.SwitchContainer(props).props.title, "main_page.ocr: main_page.switch_blocked.ocr_models");
});

test("each feature's icon is a named button to its settings, the same while starting and once ready", async () => {
    const b = await loadBridgeStore(), prepared: string[] = [];
    b.stores.store.backend_subprocess = runningChild();
    const voice = { status: { tts_generation: 1 }, directState: { observation_id: "one" }, send() {} };
    const name = (type: unknown) => typeof type === "function" ? type.name : type;
    const shape = (rows: TreeNode[]) => rows.map(node => {
        const row = draw(node);
        return [name(row.type), row.props.children.map((child: TreeNode) => name(child.type))];
    });
    const starting = await loadSwitches(b, voice, { compact: false, prepared, blocks: {} }, true);
    const before = shape(b.runtime.render(starting.MainFunctionSwitch).props.children);
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const s = await loadSwitches(b, voice, { compact: false, prepared,
        blocks: { translation: { reason: "translation_unavailable", action: "translator" }, tts: { reason: "tts_source", action: "tts" } } });
    const rows: TreeNode[] = b.runtime.render(s.MainFunctionSwitch).props.children;
    // A block found after the start adds nothing to the rail: the rows keep their parts.
    assert.deepEqual(shape(rows), before);
    for (const node of rows) {
        const row = s.SwitchRow(node.props);
        const [tip, control] = row.props.children;
        const button = inTooltip(tip);
        assert.equal(button.type, "button");
        assert.equal(button.props.type, "button");
        // Its name is also its tooltip; the icon inside is not read.
        assert.ok(button.props["aria-label"]);
        assert.equal(tip.props.title, button.props["aria-label"]);
        assert.equal(button.props.title, undefined);
        // Beside the rail, level with the row, so the bubble does not cover the switch's name.
        assert.deepEqual([tip.props.placement, tip.props.beside], ["right", ".switch_row"]);
        assert.equal(button.props.children.props["aria-hidden"], "true");
        // The switch beside it keeps its own role and name.
        assert.equal(control.type, s.SwitchContainer);
        assert.equal(inTooltip(s.SwitchContainer(control.props)).props.role, "switch");
        button.props.onClick();
    }
    assert.deepEqual(prepared, ["translator", "transcription", "transcription", "ocr", "tts", "rvc"]);
    assert.equal(s.settingsLabel("translator", translate((key: string) => key)), "main_page.feature_settings.translator");
    const labels: unknown[][] = [];
    s.settingsLabel("ocr_models", translate((key: string, options?: { page?: string }) => { labels.push([key, options?.page]); return key; }));
    assert.deepEqual(labels, [["config_page.side_menu_labels.ocr", undefined], ["main_page.feature_settings.open_page", "config_page.side_menu_labels.ocr"]]);
});

test("while the engine is away no switch is blocked for a missing setup", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: false, state: "ok" });
    const s = await loadSwitches(b, { status: {}, directState: {} },
        { compact: false, blocks: { ocr: { reason: "ocr_models", action: "ocr" } } });
    const rows: TreeNode[] = b.runtime.render(s.MainFunctionSwitch).props.children;
    assert.equal(rows.some(node => node.type === "button"), false);
    const ocr = rows.find(node => node.props.switch_id === "ocr");
    assert.ok(ocr);
    assert.equal(ocr.props.blockedReason, null);
});

test("#554: the uses picked in settings choose the switches in sight; one that is on stays, and 「ほかの機能」 shows the rest", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_enabled: false, tts_generation: 1 }, directState: { observation_id: "one" }, send() {} };
    const s = await loadSwitches(b, voice, { compact: false, blocks: {}, presets: ["basic"] });
    const draw = (): TreeNode[] => b.runtime.render(s.MainFunctionSwitch).props.children;
    const ids = (rows: TreeNode[]) => rows.filter(node => node.props.switch_id).map(node => node.props.switch_id);
    let rows = draw();
    assert.deepEqual(ids(rows), ["translation", "transcription_send", "transcription_receive"]);
    let more = rows.at(-1);
    assert.ok(more);
    assert.equal(more.type, s.MoreFeaturesButton);
    assert.equal(more.props.count, 3);
    assert.equal(more.props.expanded, false);
    // Chat reading turned on elsewhere (a hotkey, the VR panel) is in sight, so it can be turned off.
    b.runtime.store.set(b.stores.Atom_OcrCaptureStatus, { data: true, state: "ok" });
    rows = draw();
    assert.deepEqual(ids(rows), ["translation", "transcription_send", "transcription_receive", "ocr"]);
    const last = rows.at(-1);
    assert.ok(last);
    assert.equal(last.props.count, 2);
    // 「ほかの機能」 shows every switch in its usual order; it saves nothing.
    last.props.onToggle();
    rows = draw();
    assert.deepEqual(ids(rows), ["translation", "transcription_send", "transcription_receive", "ocr", "tts", "rvc"]);
    more = rows.at(-1);
    assert.ok(more);
    assert.equal(more.props.expanded, true);
    const tip = b.runtime.render(s.MoreFeaturesButton, more.props);
    const button = inTooltip(tip);
    assert.equal(button.props["aria-expanded"], true);
    assert.equal(button.props["aria-label"], "main_page.more_features_hide");
    // What the button does is its tooltip and, kept in the page, its accessible description.
    assert.equal(tip.props.title, "main_page.more_features_hide: main_page.more_features_hint");
    const hint = find(button, node => node.props.id === button.props["aria-describedby"]);
    assert.ok(hint);
    assert.deepEqual([hint.props.hidden, hint.props.children], [true, "main_page.more_features_hint"]);
});

test("#955: a switch the first-run setup leads to stands out and stays in sight until it is turned on", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_enabled: false, tts_generation: 1 }, directState: { observation_id: "one" }, send() {} };
    const setup: SwitchSetup = { compact: false, blocks: {}, presets: ["basic"], leads: ["tts", "translation"], settled: [] };
    const s = await loadSwitches(b, voice, setup);
    const draw = (): TreeNode[] => b.runtime.render(s.MainFunctionSwitch).props.children;
    const row = (rows: TreeNode[], id: string) => {
        const node = rows.find(item => item.props.switch_id === id);
        assert.ok(node);
        return node;
    };
    let rows = draw();
    // Text to speech is not among the uses picked, yet it is in sight while led; 「ほかの機能」 keeps the rest.
    assert.deepEqual(rows.filter(node => node.props.switch_id).map(node => node.props.switch_id),
        ["translation", "transcription_send", "transcription_receive", "tts"]);
    assert.equal(rows.at(-1)?.props.count, 2);
    // The led switches stand out, the others do not; nothing is turned on and nothing is settled yet.
    assert.deepEqual(["translation", "transcription_send", "tts"].map(id => row(rows, id).props.lead), [true, false, true]);
    assert.equal(s.SwitchRow(row(rows, "tts").props).props["data-lead"], true);
    assert.equal(s.SwitchRow(row(rows, "transcription_send").props).props["data-lead"], undefined);
    assert.deepEqual([s.requests, setup.settled], [[], []]);
    // The row draws the frame; its switch does not draw a second one. In the icon rail, the switch does.
    assert.equal(inTooltip(s.SwitchContainer({ ...row(rows, "tts").props, inRow: true })).props["data-lead"], undefined);
    assert.equal(inTooltip(s.SwitchContainer(row(rows, "tts").props)).props["data-lead"], true);
    // Turned on: it no longer stands out, and the lead is settled.
    b.runtime.store.set(b.stores.Atom_TranslationStatus, { data: true, state: "ok" });
    rows = draw();
    assert.equal(row(rows, "translation").props.lead, false);
    assert.deepEqual(setup.settled, ["translation"]);
});

test("#554: every switch is in sight while the uses are not known, and with everything picked", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = runningChild();
    const voice = { status: { tts_generation: 1 }, directState: { observation_id: "one" }, send() {} };
    for (const presets of [null, ["all"], ["basic", "nonverbal", "voice_changer"]]) {
        const s = await loadSwitches(b, voice, { compact: false, blocks: {}, presets });
        const rows: TreeNode[] = b.runtime.render(s.MainFunctionSwitch).props.children;
        assert.deepEqual(rows.map(node => node.props.switch_id), ["translation", "transcription_send", "transcription_receive", "ocr", "tts", "rvc"], JSON.stringify(presets));
    }
});
