import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { hooks, loadModule, find } from "../test/hookHarness.js";
import * as endpointPrivacy from "../common/endpointPrivacy.js";

const noop = () => {};
const api = values => new Proxy(values, { get: (object, name) => object[name] ?? noop });

async function fixture(context) {
    const runtime = hooks(), calls = [];
    const consent = await loadModule(new URL("./useTranscriptionConsent.js", import.meta.url), runtime);
    const states = {};
    const mainStore = { store: { backend_subprocess: {} } };
    for (const name of ["Translation", "TranscriptionSend", "TranscriptionReceive", "OcrCapture", "Foreground"]) {
        states[name] = { data: false, state: "ok" };
        mainStore[`useStore_${name}Status`] = () => ({
            [`current${name}Status`]: states[name],
            [`pending${name}Status`]: () => { states[name].state = "pending"; },
            [`update${name}Status`]: (value, options) => {
                const data = typeof value === "function" ? value(states[name]) : value;
                states[name] = { data, state: options?.set_state ?? "ok" };
            },
        });
    }
    const main = await loadModule(new URL("../main/useMainFunction.js", import.meta.url), runtime, {
        "@store": mainStore,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (...args) => { calls.push(args); return true; } }) },
    });
    const transcription = api({
        currentSelectedTranscriptionEngine: { data: null, state: "ok" },
        currentSelectableTranscriptionEngines: { data: ["Google", "SpeechCpp"] },
        setSelectedTranscriptionEngine: async value => {
            transcription.currentSelectedTranscriptionEngine = { data: null, state: "pending" };
            calls.push(["/set/data/selected_transcription_engine", value]);
            return true;
        },
    });
    const configs = { useTranscription: () => transcription, ocrStartErrorKey: () => null, ocrShouldRestoreSharedWindow: () => false };
    for (const name of ["Translation", "Others", "Ocr", "OcrSharedWindow", "AdvancedSettings"]) configs[`use${name}`] = () => api({});
    const common = {};
    for (const name of ["NotificationStatus", "Volume", "LLMConnection", "IsSoftwareUpdating"]) common[`use${name}`] = () => api({});
    const errors = await loadModule(new URL("../_useBackendErrorHandling.js", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: key => key, i18n: { exists: () => true } }) },
        "@logics_common": common, "@logics_configs": configs, "@logics_main": main,
        "./ui_configs": {}, "./configs/legacyModelConsent": {}, "./configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "./transcription/useTranscriptionConsent": consent,
        "./translation/useTranslationSetup": { useTranslationSetup: () => ({ open: noop }) },
    });
    const error = errors._useBackendErrorHandling().errorHandling_Backend;
    const { TranscriptionConsentController } = await loadModule(new URL("../../views/app/_app_controllers/TranscriptionConsentController.jsx", import.meta.url), runtime, {
        "@logics_configs": configs, "@logics_main": main,
        "@store": { useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: noop }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: noop }) },
        "../../../logics/transcription/useTranscriptionConsent": consent,
        "../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: noop }) },
    });
    const render = () => runtime.render(TranscriptionConsentController);
    const click = key => find(render(), node => node.type === "button" && node.props.children === `transcription_consent.${key}`).props.onClick();
    const acknowledge = value => { transcription.currentSelectedTranscriptionEngine = { data: value, state: "ok" }; render(); };
    const firstEnable = direction => {
        main.useMainFunction()[`toggleTranscription${direction}`]();
        error({ error_code: "TRANSCRIPTION_ENGINE_NOT_SELECTED", endpoint: `/set/enable/transcription_${direction === "Send" ? "send" : "receive"}`, data: false });
        render();
    };
    context.after(() => runtime.unmount());
    render();
    return { runtime, render, calls, states, transcription, configs, click, acknowledge, firstEnable, error, consent };
}

for (const direction of ["Send", "Receive"]) test(`${direction}: first enable opens chooser; Google saves then continues only the original enable`, async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    s.firstEnable(direction);
    assert.ok(find(s.render(), node => node.type === "dialog"));
    assert.equal(s.states[`Transcription${direction}`].data, false);
    assert.equal(s.states[`Transcription${direction}`].state, "ok");
    const enable = `/set/enable/transcription_${direction === "Send" ? "send" : "receive"}`;
    assert.equal(s.calls.filter(([path]) => path === enable).length, 1);
    await s.click("google");
    s.render();
    assert.deepEqual(s.calls.at(-1), ["/set/data/selected_transcription_engine", "Google"]);
    assert.equal(s.calls.filter(([path]) => path === enable).length, 1, "writing the selection is not an ack");
    s.acknowledge("Google");
    assert.equal(s.render(), null);
    assert.equal(s.calls.filter(([path]) => path === enable).length, 2);
    s.render();
    assert.equal(s.calls.filter(([path]) => path === enable).length, 2, "one continuation only");
});

test("Local (speech.cpp) saves the selection and continues the original enable without downloading", async context => {
    const s = await fixture(context);
    s.firstEnable("Receive");
    // The removed local Whisper is no longer offered (#288).
    const choices = [];
    find(s.render(), node => { if (node.type === "button") choices.push(node.props.children); return false; });
    assert.deepEqual(choices, ["transcription_consent.cancel", "transcription_consent.google", "transcription_consent.speechcpp"]);
    await s.click("speechcpp");
    assert.deepEqual(s.calls.at(-1), ["/set/data/selected_transcription_engine", "SpeechCpp"]);
    s.acknowledge("SpeechCpp");
    assert.equal(s.render(), null);
    assert.equal(s.calls.filter(([path]) => path === "/set/enable/transcription_receive").length, 2);
    // A missing speech.cpp model is reported by the switch; nothing is fetched from here.
    assert.ok(!s.calls.some(([path]) => path.startsWith("/run/")), "choosing the engine does not download");
});

for (const pending of [false, true]) test(`cancel leaves transcription off (selection pending: ${pending})`, async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    if (pending) await s.click("google");
    s.click("cancel");
    s.acknowledge("Google");
    assert.equal(s.render(), null);
    assert.equal(s.states.TranscriptionSend.data, false);
    assert.equal(s.calls.filter(([path]) => path.startsWith("/set/enable/")).length, 1);
});

test("Escape cancels and the initial focus target is Cancel", async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    const tree = s.render();
    assert.equal(find(tree, node => node.props?.autoFocus).props.children, "transcription_consent.cancel");
    let prevented = false;
    find(tree, node => node.type === "dialog").props.onCancel({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(s.render(), null);
    assert.equal(s.calls.filter(([path]) => path.startsWith("/set/enable/")).length, 1);
});

test("repeated choices and simultaneous enables do not multiply the continuation", async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    s.firstEnable("Receive");
    await s.click("google");
    await s.click("google");
    s.acknowledge("Google");
    assert.equal(s.calls.filter(([path]) => path === "/set/data/selected_transcription_engine").length, 1);
    assert.equal(s.calls.filter(([path]) => path === "/set/enable/transcription_send").length, 2);
    assert.equal(s.calls.filter(([path]) => path === "/set/enable/transcription_receive").length, 1);
});

test("failed save and unrelated selection updates never enable capture", async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    await s.click("google");
    s.acknowledge(null);
    assert.ok(find(s.render(), node => node.type === "dialog"));
    s.acknowledge("Google");
    assert.equal(s.calls.filter(([path]) => path.startsWith("/set/enable/")).length, 1);
});

test("an engine that cannot start points at its settings; unmount drops any continuation", async context => {
    const s = await fixture(context);
    s.error({ error_code: "TRANSCRIPTION_ENGINE_UNAVAILABLE", endpoint: "/set/enable/transcription_send", data: false });
    const buttons = [];
    find(s.render(), node => { if (node.type === "button") buttons.push(node.props.children); return false; });
    assert.deepEqual(buttons, ["transcription_consent.cancel", "transcription_consent.settings"]);
    s.runtime.unmount();
    assert.equal(s.consent.useTranscriptionConsent().request, null);
    assert.deepEqual(s.calls, []);
});

test("only enable errors can open the chooser", async context => {
    const s = await fixture(context);
    s.error({ error_code: "TRANSCRIPTION_ENGINE_NOT_SELECTED", endpoint: "/get/data/selected_transcription_engine", data: false });
    assert.equal(s.render(), null);
});

test("settings keep the selected engine and Google notice inside the radio row's accessible help", async context => {
    const s = await fixture(context);
    const { TranscriptionEngine_Box } = await loadModule(new URL("../../views/app/config_page/setting_section/setting_box/transcription/Transcription.jsx", import.meta.url), s.runtime, {
        "@logics_configs": s.configs, "@utils": {},
        "../advanced_settings/SpeechServers": {}, "./RealtimeASRSettings": {}, "./OldWhisperWeights": {},
        "../_components/credential_pair/CredentialPair": {},
        "../../../../../../logics/configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "../_templates/Templates": { RadioButtonContainer: "radio-options" }, "../_components": {},
        "../_components/description/Description": {}, "../_components/custom_model_link/CustomModelLink": {},
        "../_components/setup_section/SetupSection": {},
    });
    s.transcription.currentSelectedTranscriptionEngine = { data: "Google", state: "ok" };
    const tree = s.runtime.render(TranscriptionEngine_Box);
    assert.equal(tree.type, "radio-options", "help belongs inside the row, not after its divider");
    assert.equal(tree.props.checked_variable.data, "Google");
    // Google, the local speech.cpp engine and the cloud engines; the local Whisper is gone (#288).
    assert.deepEqual(tree.props.options.map(option => option.id), ["Google", "SpeechCpp"]);
    assert.ok(find(tree.props.desc, node => node.props?.children === "transcription_consent.google_notice"));
    assert.ok(find(tree.props.desc, node => node.props?.role === "status"));

    // Use the real row, label and radio group to verify their help relationship.
    const rowRuntime = hooks();
    const root = new URL("../../views/app/config_page/setting_section/setting_box/", import.meta.url);
    const { LabelComponent } = await loadModule(new URL("_components/label_component/LabelComponent.jsx", root), rowRuntime, {
        "../_atoms/_open_webpage_button/_OpenWebpageButton": { _OpenWebpageButton: "webpage" },
        "../description/Description": { Description: "description" },
    });
    const { RadioButton } = await loadModule(new URL("_components/radio_button/RadioButton.jsx", root), rowRuntime);
    const { RadioButtonContainer } = await loadModule(new URL("_templates/Templates.jsx", root), rowRuntime, {
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        "../_components": { LabelComponent, RadioButton }, "@common_components": { Checkbox: "checkbox" },
    });
    let row = rowRuntime.render(RadioButtonContainer, tree.props);
    row = rowRuntime.render(row.type, row.props);
    row = rowRuntime.render(row.type, row.props);
    assert.equal(row.type, "div");
    assert.equal(row.props["data-setting-id"], "select_transcription_engine");
    const label = find(row, node => node.type === LabelComponent);
    const control = find(row, node => node.type === RadioButton);
    const group = rowRuntime.render(control.type, control.props);
    const help = find(rowRuntime.render(label.type, label.props), node => node.props?.id === group.props["aria-describedby"]);
    assert.equal(group.props.role, "radiogroup");
    assert.ok(group.props["aria-describedby"]);
    assert.ok(find(help, node => node.props?.children === "transcription_consent.google_notice"));
    assert.ok(find(help, node => node.props?.role === "status"));

    s.transcription.currentSelectedTranscriptionEngine = { data: null, state: "ok" };
    const unselectedHelp = s.runtime.render(TranscriptionEngine_Box).props.desc;
    assert.ok(find(unselectedHelp, node => node.props?.role === "status"));
    assert.equal(find(unselectedHelp, node => node.props?.children === "transcription_consent.google_notice"), null);
});

for (const language of ["en", "ja"]) test(`${language}: choice and error text disclose Google and the separate local download`, async () => {
    const messages = yaml.load(await readFile(new URL(`../../../locales/${language}.yml`, import.meta.url), "utf8"));
    assert.match(messages.transcription_consent.google_notice, /Google/);
    assert.match(messages.transcription_consent.google_notice, language === "ja" ? /送られます/ : /sends/);
    assert.match(messages.transcription_consent.speechcpp_notice, /speech\.cpp/);
    assert.equal(messages.transcription_consent.whisper_notice, undefined);
    for (const code of ["ENGINE_NOT_SELECTED", "ENGINE_UNAVAILABLE"])
        assert.ok(messages.backend_errors[`TRANSCRIPTION_${code}`]);
    // Only the removed Whisper engine reported these.
    for (const code of ["MODEL_MISSING", "VRAM_MIC", "VRAM_SPEAKER"]) assert.equal(messages.backend_errors[`TRANSCRIPTION_${code}`], undefined);
});
