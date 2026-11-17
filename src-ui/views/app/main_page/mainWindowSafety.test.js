import assert from "node:assert/strict";
import { test } from "node:test";
import { hooks, loadModule, find } from "../../../logics/test/hookHarness.js";
import { loadBridgeStore } from "../../../logics/test/bridgeHarness.js";
import { chunkArray } from "../../../logics/utils.ts";
import * as routeState from "../../../logics/voice/routeState.ts";
import * as rvcStartOptions from "../../../logics/voice/rvcStartOptions.ts";
import { voiceActions, voiceSwitchStates } from "../../../logics/voice/voiceActions.ts";
import * as voiceErrorText from "../../../logics/voice/voiceErrorText.ts";
import * as featureLabel from "../../../logics/common/featureLabel.ts";
import * as switchBlocksModule from "../../../logics/main/switchBlocks.ts";
import * as sameLanguage from "../../../logics/main/sameLanguage.ts";

const icon = () => null;
const keydown = (control, key, repeat = false) => {
    let prevented = false;
    control.props.onKeyDown({ key, repeat, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
};
const loadSwitches = async (b, voice = {}, setup = { blocks: {}, compact: false }, starting = false) => {
    const requests = [];
    const main = await loadModule(new URL("../../../logics/main/useMainFunction.js", import.meta.url), b.runtime, {
        "@store": b.stores,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: endpoint => requests.push(endpoint) }) },
    });
    const switches = await loadModule(new URL("./sidebar_section/main_function_switch/MainFunctionSwitch.jsx", import.meta.url), b.runtime, {
        "@store": b.stores,
        "@logics_common": { useIsBackendReady: b.stores.useStore_IsBackendReady },
        "../../../../../logics/common/useNotificationStatus": { useNotificationStatus: () => ({ showNotification_Error() {} }) },
        "../../../../../logics/voice/useVoice": { useVoice: () => voice },
        "../../../../../logics/voice/voiceActions.ts": { voiceActions, voiceSwitchStates },
        "../../../../../logics/voice/routeState": routeState,
        "../../../../../logics/voice/rvcStartOptions": rvcStartOptions,
        "../../../../../logics/common/featureLabel.ts": featureLabel,
        "../../../../../logics/voice/voiceErrorText.ts": voiceErrorText,
        "../../../../../logics/main/switchBlocks": switchBlocksModule,
        "../../../../../logics/main/useSwitchBlocks": { useSwitchBlocks: () => ({ blocks: setup.blocks, prepare: action => setup.prepared?.push(action) }) },
        "../../startupContext": { useIsStartingUp: () => starting },
        "@logics_main": { ...main, useIsMainPageCompactMode: () => ({ currentIsMainPageCompactMode: { data: setup.compact } }) },
        "../../../../common_components/toggle_switch/ToggleSwitch": { ToggleSwitch: icon },
    });
    return { ...switches, ...main, requests };
};

for (const key of ["Enter", " "]) test(`holding ${JSON.stringify(key)} cannot restart a main function after its stop acknowledgement`, async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = {};
    const s = await loadSwitches(b);
    for (const [name, endpoint] of [["Translation", "translation"], ["TranscriptionSend", "transcription_send"],
        ["TranscriptionReceive", "transcription_receive"], ["OcrCapture", "ocr_capture"]]) {
        const atom = b.stores[`Atom_${name}Status`];
        b.runtime.store.set(atom, { data: true, state: "ok" });
        const render = () => {
            const main = s.useMainFunction();
            return b.runtime.render(s.SwitchContainer, { SvgComponent: icon, currentState: main[`current${name}Status`],
                toggleFunction: main[`toggle${name}`] });
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
    const b = await loadBridgeStore(), sent = [];
    b.stores.store.backend_subprocess = {};
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_generation: 1 }, ttsPending: { intent: true }, directOwner: "rvc",
        directPending: { intent: true }, directState: { observation_id: "one", pending: true },
        send: endpoint => sent.push(endpoint) };
    const s = await loadSwitches(b, voice);
    for (const id of ["tts", "rvc"]) {
        const item = find(b.runtime.render(s.MainFunctionSwitch), node => node.props.switch_id === id);
        const control = s.SwitchContainer(item.props), before = sent.length;
        keydown(control, "Enter", true);
        keydown(control, " ", true);
        assert.equal(sent.length, before);
        keydown(control, "Enter");
        assert.equal(sent.at(-1), id === "tts" ? "/run/disable_tts" : "/run/stop_direct_voice");
    }
});

test("the TTS and RVC hotkeys press the switches with the state of the moment", async () => {
    const b = await loadBridgeStore(), sent = [];
    b.stores.store.backend_subprocess = {};
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_generation: 4 }, directState: {}, send: (...args) => sent.push(args) };
    const s = await loadSwitches(b, voice);
    b.runtime.render(s.MainFunctionSwitch);
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
    voiceActions.toggleRvc();
    assert.deepEqual(sent.at(-1), ["/run/stop_direct_voice"]);
});

test("disconnected main switches hide retained activity and reject clicks, keys and stale handlers", async () => {
    const b = await loadBridgeStore(), sent = [];
    b.stores.store.backend_subprocess = {};
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_enabled: true, tts_generation: 1 }, directOwner: "rvc",
        directState: { observation_id: "one", requested: true }, send: endpoint => sent.push(endpoint) };
    const s = await loadSwitches(b, voice);
    for (const name of ["Translation", "TranscriptionSend", "TranscriptionReceive", "OcrCapture"])
        b.runtime.store.set(b.stores[`Atom_${name}Status`], { data: true, state: "ok" });
    const live = b.runtime.render(s.MainFunctionSwitch);
    const main = s.useMainFunction();
    b.stores.store.backend_subprocess = null;
    b.stores.store.backend_stopped = true;
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: false, state: "ok" });
    for (const item of live.props.children) item.props.toggleFunction();
    for (const name of ["Translation", "TranscriptionSend", "TranscriptionReceive", "OcrCapture"]) {
        main[`set${name}`](true);
        assert.deepEqual(b.runtime.store.get(b.stores[`Atom_${name}Status`]), { data: true, state: "ok" });
    }
    const disconnected = b.runtime.render(s.MainFunctionSwitch);
    for (const item of disconnected.props.children) {
        const control = s.SwitchContainer(item.props);
        assert.equal(control.props["aria-disabled"], true);
        assert.equal(control.props["aria-checked"], false);
        assert.equal(control.props["aria-busy"], false);
        assert.match(control.props["aria-label"], /main_page.backend_disconnected/);
        assert.doesNotMatch(control.props.className, /is_active/);
        assert.ok(find(control, node => node.props.children === "main_page.backend_disconnected"));
        control.props.onClick();
        keydown(control, "Enter");
        keydown(control, " ");
    }
    assert.deepEqual(s.requests, []);
    assert.deepEqual(sent, []);
});

test("while the engine starts, the switches are locked placeholders, not disconnected", async () => {
    const b = await loadBridgeStore(), sent = [];
    const voice = { status: { tts_generation: 1 }, directState: { observation_id: "one" }, send: endpoint => sent.push(endpoint) };
    const s = await loadSwitches(b, voice, undefined, true);
    const starting = b.runtime.render(s.MainFunctionSwitch);
    for (const item of starting.props.children) {
        assert.equal(item.props.statusText, null);
        const control = s.SwitchContainer(item.props);
        assert.equal(control.props["aria-disabled"], true);
        assert.equal(control.props["aria-checked"], false);
        assert.equal(control.props["aria-label"], item.props.switchLabel);
        assert.equal(find(control, node => node.props.children === "main_page.backend_disconnected"), null);
        // The toggle's state comes from the engine: a placeholder of the same size until then.
        assert.equal(find(control, node => node.type === icon).props.skeleton, true);
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
    const runtime = hooks(), actions = [];
    let opened = false;
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
            updateIsOpenedTranslatorSelector: value => { opened = value; actions.push("open"); } }) },
        "./translator_selector/TranslatorSelector": {}, "@setting_box": { MessageLogUiScalingContainer: icon },
        "../../../../../../logics/main/sameLanguage.ts": sameLanguage };
    const cases = [
        ["sidebar_section/language_settings/preset_tab_selector/PresetTabSelector.jsx", "PresetTabSelector", {}],
        ["sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton.jsx", "TranslatorSelectorOpenButton", {}],
        ["sidebar_section/language_settings/translator_selector_open_button/translator_selector/TranslatorSelector.jsx", "TranslatorSelector",
            { translation_engines: [{ id: "two", label: "Two", is_available: true }], selected_id: "one" }],
        ["sidebar_section/language_settings/language_swap_button/LanguageSwapButton.jsx", "LanguageSwapButton", {}],
        ["sidebar_section/language_settings/add_remove_target_language_buttons/AddRemoveTargetLanguageButtons.jsx", "AddRemoveTargetLanguageButtons", {}],
        ["main_section/message_container/message_log_settings_container/MessageLogSettingsContainer.jsx", "MessageLogSettingsContainer", {}],
    ];
    const controls = tree => {
        if (!tree || typeof tree !== "object") return [];
        if (typeof tree.type === "function") return controls(tree.type(tree.props));
        return [tree.props.role === "button" ? tree : null,
            ...[tree.props.children].flat(Infinity).flatMap(controls)].filter(Boolean);
    };
    for (const [path, name, props] of cases) {
        const module = await loadModule(new URL(path, import.meta.url), runtime, imports);
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
    const b = await loadBridgeStore(), sent = [], prepared = [];
    b.stores.store.backend_subprocess = {};
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const voice = { status: { tts_generation: 1 }, directState: {}, send: endpoint => sent.push(endpoint) };
    const setup = { compact: false, prepared, blocks: {
        translation: { reason: "translation_model", action: "translation" },
        ocr: { reason: "ocr_models", action: "ocr_models" },
        tts: { reason: "tts_source", action: "tts" },
        transcription_send: { reason: "translation_downloading", action: null },
    } };
    const s = await loadSwitches(b, voice, setup);
    const rows = b.runtime.render(s.MainFunctionSwitch).props.children;
    const at = id => rows.findIndex(node => node.props.switch_id === id);
    for (const id of ["translation", "ocr", "tts", "transcription_send"]) {
        const props = rows[at(id)].props;
        assert.equal(props.blockedReason, `main_page.switch_blocked.${setup.blocks[id].reason}`);
        const control = s.SwitchContainer(props), before = s.requests.length + sent.length;
        assert.equal(control.props["aria-disabled"], true);
        assert.equal(control.props.title, props.blockedReason);
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
    const iconButton = id => find(s.SwitchRow(rows[at(id)].props), node => node.type === "button");
    for (const id of ["translation", "ocr", "tts", "transcription_send"]) iconButton(id).props.onClick();
    assert.deepEqual(prepared, ["translation", "ocr_models", "tts", "transcription"]);
    assert.equal(iconButton("translation").props["aria-label"], "main_page.feature_settings.translation_model");
    assert.equal(iconButton("tts").props["aria-label"], "main_page.feature_settings.open_page");
    // Switches without a block keep working.
    const free = rows[at("transcription_receive")].props;
    assert.equal(free.blockedReason, null);
    assert.equal(s.SwitchContainer(free).props["aria-disabled"], false);
});

test("a switch that is on stays usable when its setup goes missing, so it can be turned off", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = {};
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    b.runtime.store.set(b.stores.Atom_OcrCaptureStatus, { data: true, state: "ok" });
    const s = await loadSwitches(b, { status: {}, directState: {} },
        { compact: false, blocks: { ocr: { reason: "ocr_models", action: "ocr" } } });
    const rows = b.runtime.render(s.MainFunctionSwitch).props.children;
    const index = rows.findIndex(node => node.props.switch_id === "ocr");
    assert.equal(rows[index].props.blockedReason, null);
    assert.equal(rows.length, 6);
    const before = s.requests.length;
    s.SwitchContainer(rows[index].props).props.onClick();
    assert.deepEqual(s.requests.slice(before), ["/set/disable/ocr_capture"]);
});

test("in the icon rail a blocked switch names itself in its tooltip and has no button", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = {};
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const s = await loadSwitches(b, { status: {}, directState: {} },
        { compact: true, blocks: { ocr: { reason: "ocr_models", action: "ocr" } } });
    const rows = b.runtime.render(s.MainFunctionSwitch).props.children;
    const props = rows.find(node => node.props.switch_id === "ocr").props;
    // The rail has room for one target per feature: the icon stays part of the switch.
    const row = s.SwitchRow(props);
    assert.equal(row.type, s.SwitchContainer);
    assert.equal(find(s.SwitchContainer(row.props), node => node.type === "button"), null);
    assert.equal(s.SwitchContainer(props).props.title, "main_page.ocr: main_page.switch_blocked.ocr_models");
});

test("each feature's icon is a named button to its settings, the same while starting and once ready", async () => {
    const b = await loadBridgeStore(), prepared = [];
    b.stores.store.backend_subprocess = {};
    const voice = { status: { tts_generation: 1 }, directState: { observation_id: "one" }, send() {} };
    const name = type => typeof type === "function" ? type.name : type;
    const shape = rows => rows.map(node => {
        const row = node.type(node.props);
        return [name(row.type), row.props.children.map(child => name(child.type))];
    });
    const starting = await loadSwitches(b, voice, { compact: false, prepared, blocks: {} }, true);
    const before = shape(b.runtime.render(starting.MainFunctionSwitch).props.children);
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: true, state: "ok" });
    const s = await loadSwitches(b, voice, { compact: false, prepared,
        blocks: { translation: { reason: "translation_unavailable", action: "translator" }, tts: { reason: "tts_source", action: "tts" } } });
    const rows = b.runtime.render(s.MainFunctionSwitch).props.children;
    // A block found after the start adds nothing to the rail: the rows keep their parts.
    assert.deepEqual(shape(rows), before);
    for (const node of rows) {
        const row = s.SwitchRow(node.props);
        const [button, control] = row.props.children;
        assert.equal(button.type, "button");
        assert.equal(button.props.type, "button");
        // Named and titled alike; the icon inside is not read.
        assert.ok(button.props["aria-label"]);
        assert.equal(button.props.title, button.props["aria-label"]);
        assert.equal(button.props.children.props["aria-hidden"], "true");
        // The switch beside it keeps its own role and name.
        assert.equal(control.type, s.SwitchContainer);
        assert.equal(s.SwitchContainer(control.props).props.role, "switch");
        button.props.onClick();
    }
    assert.deepEqual(prepared, ["translator", "transcription", "transcription", "ocr", "tts", "rvc"]);
    assert.equal(s.settingsLabel("translator", key => key), "main_page.feature_settings.translator");
    const labels = [];
    s.settingsLabel("ocr_models", (key, options) => { labels.push([key, options?.page]); return key; });
    assert.deepEqual(labels, [["config_page.side_menu_labels.ocr", undefined], ["main_page.feature_settings.open_page", "config_page.side_menu_labels.ocr"]]);
});

test("while the engine is away no switch is blocked for a missing setup", async () => {
    const b = await loadBridgeStore();
    b.stores.store.backend_subprocess = {};
    b.runtime.store.set(b.stores.Atom_IsBackendReady, { data: false, state: "ok" });
    const s = await loadSwitches(b, { status: {}, directState: {} },
        { compact: false, blocks: { ocr: { reason: "ocr_models", action: "ocr" } } });
    const rows = b.runtime.render(s.MainFunctionSwitch).props.children;
    assert.equal(rows.some(node => node.type === "button"), false);
    assert.equal(rows.find(node => node.props.switch_id === "ocr").props.blockedReason, null);
});
