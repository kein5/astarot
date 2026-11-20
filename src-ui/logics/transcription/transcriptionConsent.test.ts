import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, find, findIn, drawWith } from "../test/hookHarness.ts";
import type { TreeNode } from "../test/hookHarness.ts";
import { localeAt, readLocale, textAt } from "../test/locales.ts";
import * as endpointPrivacy from "../common/endpointPrivacy.ts";
import type { BackendErrorReport } from "../_useBackendErrorHandling.ts";
import type { RadioGroup, RadioOption } from "../../views/app/config_page/setting_section/setting_box/_components/radio_button/RadioButton.tsx";

const noop = () => {};
const api = <T extends object>(values: T) => new Proxy(values, { get: (object, name) => Reflect.get(object, name) ?? noop });
// A function given to an atom's update in place of its value.
const isUpdate = (value: unknown): value is (previous: unknown) => unknown => typeof value === "function";

interface SwitchState {
    data: unknown;
    state: string;
}
interface Transcription {
    currentSelectedTranscriptionEngine: { data: string | null; state: string };
    currentSelectableTranscriptionEngines: { data: string[] };
    setSelectedTranscriptionEngine: (value: string) => Promise<boolean>;
}
type Call = [string, ...unknown[]];
type Direction = "Send" | "Receive";

async function fixture(context: TestContext) {
    const runtime = hooks(), calls: Call[] = [];
    const consent = await loadModule<typeof import("./useTranscriptionConsent.ts")>(new URL("./useTranscriptionConsent.ts", import.meta.url), runtime);
    const states: Record<string, SwitchState> = {};
    const mainStore: Record<string, unknown> = { store: { backend_subprocess: {} } };
    for (const name of ["Translation", "TranscriptionSend", "TranscriptionReceive", "OcrCapture", "Foreground"]) {
        states[name] = { data: false, state: "ok" };
        mainStore[`useStore_${name}Status`] = () => ({
            [`current${name}Status`]: states[name],
            [`pending${name}Status`]: () => { states[name].state = "pending"; },
            [`update${name}Status`]: (value: unknown, options?: { set_state?: string }) => {
                const data = isUpdate(value) ? value(states[name]) : value;
                states[name] = { data, state: options?.set_state ?? "ok" };
            },
        });
    }
    const main = await loadModule<typeof import("../main/useMainFunction.ts")>(new URL("../main/useMainFunction.ts", import.meta.url), runtime, {
        "@store": mainStore,
        "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: async (...args: Call) => { calls.push(args); return true; } }) },
    });
    const transcription: Transcription = api({
        currentSelectedTranscriptionEngine: { data: null, state: "ok" },
        currentSelectableTranscriptionEngines: { data: ["SpeechCpp"] },
        setSelectedTranscriptionEngine: async (value: string) => {
            transcription.currentSelectedTranscriptionEngine = { data: null, state: "pending" };
            calls.push(["/set/data/selected_transcription_engine", value]);
            return true;
        },
    });
    const configs: Record<string, unknown> = { useTranscription: () => transcription, ocrStartErrorKey: () => null, ocrShouldRestoreSharedWindow: () => false };
    for (const name of ["Translation", "Others", "Ocr", "OcrSharedWindow", "AdvancedSettings"]) configs[`use${name}`] = () => api({});
    const common: Record<string, unknown> = {};
    for (const name of ["NotificationStatus", "Volume", "LLMConnection", "IsSoftwareUpdating"]) common[`use${name}`] = () => api({});
    const errors = await loadModule<typeof import("../_useBackendErrorHandling.ts")>(new URL("../_useBackendErrorHandling.ts", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { exists: () => true } }) },
        "@logics_common": common, "@logics_configs": configs, "@logics_main": main,
        "./ui_configs": {}, "./configs/legacyModelConsent": {}, "./configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: [] },
        "./transcription/useTranscriptionConsent": consent,
        "./translation/useTranslationSetup": { useTranslationSetup: () => ({ open: noop }) },
        "./ocr/useOcrSetup": { useOcrSetup: () => ({ show: noop }) },
    });
    const errorHandling = errors._useBackendErrorHandling().errorHandling_Backend;
    // A 400 answer as the tests report it: no message and no result, as before.
    const error = (report: Pick<BackendErrorReport, "error_code" | "endpoint" | "data">) =>
        errorHandling({ message: undefined, result: undefined, ...report });
    const { TranscriptionConsentController } = await loadModule<typeof import("../../views/app/_app_controllers/TranscriptionConsentController.tsx")>(new URL("../../views/app/_app_controllers/TranscriptionConsentController.tsx", import.meta.url), runtime, {
        "@logics_configs": configs, "@logics_main": main,
        "@store": { useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => calls.push(["open_config_page", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => calls.push(["config_tab", value]) }) },
        "../../../logics/transcription/useTranscriptionConsent": consent,
        "../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: noop }) },
    });
    const render = () => runtime.render(TranscriptionConsentController);
    const click = (key: string) => findIn(render(), node => node.type === "button" && node.props.children === `transcription_consent.${key}`).props.onClick();
    const acknowledge = (value: string | null) => { transcription.currentSelectedTranscriptionEngine = { data: value, state: "ok" }; render(); };
    const firstEnable = (direction: Direction) => {
        main.useMainFunction()[`toggleTranscription${direction}`]();
        error({ error_code: "TRANSCRIPTION_ENGINE_NOT_SELECTED", endpoint: `/set/enable/transcription_${direction === "Send" ? "send" : "receive"}`, data: false });
        render();
    };
    context.onTestFinished(() => runtime.unmount());
    render();
    return { runtime, render, calls, states, transcription, configs, click, acknowledge, firstEnable, error, consent };
}

for (const direction of ["Send", "Receive"] as const) test(`${direction}: first enable opens chooser; a choice saves then continues only the original enable`, async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    s.firstEnable(direction);
    assert.ok(find(s.render(), node => node.type === "dialog"));
    assert.equal(s.states[`Transcription${direction}`].data, false);
    assert.equal(s.states[`Transcription${direction}`].state, "ok");
    const enable = `/set/enable/transcription_${direction === "Send" ? "send" : "receive"}`;
    assert.equal(s.calls.filter(([path]) => path === enable).length, 1);
    await s.click("speechcpp");
    s.render();
    assert.deepEqual(s.calls.at(-1), ["/set/data/selected_transcription_engine", "SpeechCpp"]);
    assert.equal(s.calls.filter(([path]) => path === enable).length, 1, "writing the selection is not an ack");
    s.acknowledge("SpeechCpp");
    assert.equal(s.render(), null);
    assert.equal(s.calls.filter(([path]) => path === enable).length, 2);
    s.render();
    assert.equal(s.calls.filter(([path]) => path === enable).length, 2, "one continuation only");
});

test("Local (speech.cpp) saves the selection and continues the original enable without downloading", async context => {
    const s = await fixture(context);
    s.firstEnable("Receive");
    // The removed local Whisper (#288) and the retired Google web speech engine are not offered;
    // a cloud engine is chosen in the settings once its key is registered.
    const choices: unknown[] = [];
    find(s.render(), node => { if (node.type === "button") choices.push(node.props.children); return false; });
    assert.deepEqual(choices, ["transcription_consent.cancel", "transcription_consent.settings", "transcription_consent.speechcpp"]);
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
    if (pending) await s.click("speechcpp");
    s.click("cancel");
    s.acknowledge("SpeechCpp");
    assert.equal(s.render(), null);
    assert.equal(s.states.TranscriptionSend.data, false);
    assert.equal(s.calls.filter(([path]) => path.startsWith("/set/enable/")).length, 1);
});

test("Escape cancels and the initial focus target is Cancel", async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    const tree = s.render();
    assert.equal(findIn(tree, node => node.props?.autoFocus).props.children, "transcription_consent.cancel");
    let prevented = false;
    findIn(tree, node => node.type === "dialog").props.onCancel({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(s.render(), null);
    assert.equal(s.calls.filter(([path]) => path.startsWith("/set/enable/")).length, 1);
});

test("repeated choices and simultaneous enables do not multiply the continuation", async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    s.firstEnable("Receive");
    await s.click("speechcpp");
    await s.click("speechcpp");
    s.acknowledge("SpeechCpp");
    assert.equal(s.calls.filter(([path]) => path === "/set/data/selected_transcription_engine").length, 1);
    assert.equal(s.calls.filter(([path]) => path === "/set/enable/transcription_send").length, 2);
    assert.equal(s.calls.filter(([path]) => path === "/set/enable/transcription_receive").length, 1);
});

test("failed save and unrelated selection updates never enable capture", async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    await s.click("speechcpp");
    s.acknowledge(null);
    assert.ok(find(s.render(), node => node.type === "dialog"));
    s.acknowledge("SpeechCpp");
    assert.equal(s.calls.filter(([path]) => path.startsWith("/set/enable/")).length, 1);
});

test("an engine that cannot start points at its settings; unmount drops any continuation", async context => {
    const s = await fixture(context);
    s.error({ error_code: "TRANSCRIPTION_ENGINE_UNAVAILABLE", endpoint: "/set/enable/transcription_send", data: false });
    const buttons: unknown[] = [];
    find(s.render(), node => { if (node.type === "button") buttons.push(node.props.children); return false; });
    assert.deepEqual(buttons, ["transcription_consent.cancel", "transcription_consent.settings"]);
    s.runtime.unmount();
    assert.equal(s.consent.useTranscriptionConsent().request, null);
    assert.deepEqual(s.calls, []);
});

test("the chooser leads to the engine settings for a cloud engine without enabling anything", async context => {
    const s = await fixture(context);
    s.firstEnable("Send");
    s.click("settings");
    assert.equal(s.render(), null);
    assert.deepEqual(s.calls.slice(-2), [["config_tab", "transcription"], ["open_config_page", true]]);
    assert.equal(s.calls.filter(([path]) => path === "/set/data/selected_transcription_engine").length, 0);
    assert.equal(s.calls.filter(([path]) => path === "/set/enable/transcription_send").length, 1);
    assert.equal(s.states.TranscriptionSend.data, false);
});

test("only enable errors can open the chooser", async context => {
    const s = await fixture(context);
    s.error({ error_code: "TRANSCRIPTION_ENGINE_NOT_SELECTED", endpoint: "/get/data/selected_transcription_engine", data: false });
    assert.equal(s.render(), null);
});

test("settings keep the selected engine in sight under the radio row's label and in its accessible help", async context => {
    const s = await fixture(context);
    const engines = [{ id: "Groq_Whisper", base: "GroqWhisper", key: "groq_whisper" },
        { id: "Custom_Whisper", base: "CustomWhisper", key: "custom_whisper", has_url: true, own: true }];
    // A runtime of its own: the row's ids come from useId, whose slots the chooser's hooks would fill.
    const boxRuntime = hooks();
    const { TranscriptionEngine_Box } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/transcription/Transcription.tsx")>(new URL("../../views/app/config_page/setting_section/setting_box/transcription/Transcription.tsx", import.meta.url), boxRuntime, {
        "@logics_configs": s.configs, "@utils": {},
        "@useI18n": { useI18n: () => ({ t: (key: string, options?: unknown) => options ? `${key}:${JSON.stringify(options)}` : key }) },
        "../advanced_settings/SpeechServers": {}, "./RealtimeASRSettings": {},
        "../_components/credential_pair/CredentialPair": {},
        "../../../../../../logics/configs/cloudTranscription": { CLOUD_TRANSCRIPTION_ENGINES: engines },
        "../../../../../../logics/common/endpointPrivacy": endpointPrivacy,
        "../_templates/Templates": { RadioButtonContainer: "radio-options" }, "../_components": {},
        "../_components/description/Description": {}, "../_components/custom_model_link/CustomModelLink": {},
        "../_components/setup_section/SetupSection": {}, "../_components/advanced_section/AdvancedSection": {},
        "../_components/hint/Hint": {},
    });
    s.transcription.currentSelectedTranscriptionEngine = { data: "SpeechCpp", state: "ok" };
    const tree = boxRuntime.render(TranscriptionEngine_Box);
    assert.equal(tree.type, "radio-options", "help belongs inside the row, not after its divider");
    assert.equal(tree.props.checked_variable.data, "SpeechCpp");
    // One choice under the two systems' names (#414): speech.cpp on your PC, then the APIs. The
    // local Whisper (#288) and the retired Google web speech engine are gone. An API engine is
    // offered but cannot be chosen until the backend has accepted its key.
    assert.deepEqual(tree.props.groups.map((group: RadioGroup<RadioOption>) => [group.id, group.label, group.options.map(option => [option.id, !!option.disabled])]), [
        ["speechcpp", "config_page.transcription.speechcpp_section.label", [["SpeechCpp", false]]],
        ["api", "config_page.transcription.cloud_section.label", [["Groq_Whisper", true], ["Custom_Whisper", true]]],
    ]);
    assert.equal(tree.props.options, undefined, "the groups are the only list of options");
    // The engine in use is a value, not a description: the row's note, which stays in sight where
    // the description is a hint (#614), and part of the choice's description.
    assert.equal(tree.props.desc, "config_page.transcription.select_transcription_engine.desc");
    assert.ok(find(tree.props.note, node => node.props?.role === "status"));
    assert.equal(tree.props["aria-describedby"], tree.props.note_id);
    s.transcription.currentSelectableTranscriptionEngines = { data: ["SpeechCpp", "Custom_Whisper"] };
    const keyed = boxRuntime.render(TranscriptionEngine_Box).props.groups[1].options;
    assert.deepEqual(keyed.map((option: RadioOption) => [option.id, !!option.disabled]), [["Groq_Whisper", true], ["Custom_Whisper", false]]);
    s.transcription.currentSelectableTranscriptionEngines = { data: ["SpeechCpp"] };

    // Use the real row, label and radio group to verify their help relationship.
    const rowRuntime = hooks();
    const root = new URL("../../views/app/config_page/setting_section/setting_box/", import.meta.url);
    const { LabelComponent } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/label_component/LabelComponent.tsx")>(new URL("_components/label_component/LabelComponent.tsx", root), rowRuntime, {
        "../_atoms/_open_webpage_button/_OpenWebpageButton": { _OpenWebpageButton: "webpage" },
        "../description/Description": { Description: "description" },
        "../hint/Hint": { Hint: "hint", useHintDescriptions: () => false },
    });
    const { RadioButton } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_components/radio_button/RadioButton.tsx")>(new URL("_components/radio_button/RadioButton.tsx", root), rowRuntime, {
        "../hint/Hint": { Hint: "hint", useHintDescriptions: () => false },
    });
    const { RadioButtonContainer } = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/_templates/Templates.tsx")>(new URL("_templates/Templates.tsx", root), rowRuntime, {
        "@store": { useStore_IsBreakPoint: () => ({ currentIsBreakPoint: { data: false } }) },
        "../_components": { LabelComponent, RadioButton }, "@common_components": { Checkbox: "checkbox" },
    });
    let row: TreeNode = rowRuntime.render(RadioButtonContainer, tree.props);
    row = drawWith(rowRuntime, row);
    row = drawWith(rowRuntime, row);
    assert.equal(row.type, "div");
    assert.equal(row.props["data-setting-id"], "select_transcription_engine");
    const label = findIn(row, node => node.type === LabelComponent);
    const control = findIn(row, node => node.type === RadioButton);
    const group = drawWith(rowRuntime, control);
    const drawnLabel = drawWith(rowRuntime, label);
    const described = group.props["aria-describedby"].split(" ");
    const help = find(drawnLabel, node => node.props?.id === label.props.note_id);
    // The row's name and help are on the group around both systems; each system is a
    // radiogroup named by the label shown above its options.
    assert.equal(group.props.role, "group");
    assert.equal(group.props["aria-labelledby"], label.props.label_id);
    assert.deepEqual(described, [label.props.note_id, label.props.description_id]);
    assert.ok(find(help, node => node.props?.role === "status"));
    const systems: TreeNode[] = [];
    find(group, node => { if (node.props?.role === "radiogroup") systems.push(node); return false; });
    assert.deepEqual(systems.map(node => find(group, other => other.props?.id === node.props["aria-labelledby"])?.props.children),
        ["config_page.transcription.speechcpp_section.label", "config_page.transcription.cloud_section.label"]);
    const radios: { value?: string; name?: string; checked?: boolean; disabled?: boolean }[] = [];
    find(group, node => { if (node.type === "input") radios.push(node.props); return false; });
    // One native set: the arrow keys move through both systems and Tab stops once.
    assert.deepEqual(radios.map(radio => [radio.value, radio.name, radio.checked, radio.disabled]), [
        ["SpeechCpp", "select_transcription_engine", true, false],
        ["Groq_Whisper", "select_transcription_engine", false, true],
        ["Custom_Whisper", "select_transcription_engine", false, true],
    ]);

    // The engine in use is named in the screen's words, not by its id.
    s.transcription.currentSelectedTranscriptionEngine = { data: "Custom_Whisper", state: "ok" };
    const named = findIn(boxRuntime.render(TranscriptionEngine_Box).props.note, node => node.props?.role === "status");
    assert.match(JSON.stringify(named.props.children), /config_page\.transcription\.select_transcription_engine\.engines\.custom_whisper/);
    // A selection the backend no longer offers (a saved Google loads as none) shows as unselected.
    s.transcription.currentSelectedTranscriptionEngine = { data: null, state: "ok" };
    const unselectedHelp = boxRuntime.render(TranscriptionEngine_Box).props.note;
    assert.ok(find(unselectedHelp, node => node.props?.role === "status" && JSON.stringify(node.props.children).includes("transcription_consent.selected")));
});

for (const language of ["en", "ja"]) test(`${language}: choice and error text disclose where audio goes and the separate local download`, async () => {
    const messages = readLocale(language);
    // The retired Google web speech engine left no text behind.
    assert.equal(localeAt(messages, "transcription_consent.google_notice"), undefined);
    assert.equal(localeAt(messages, "transcription_consent.google"), undefined);
    assert.doesNotMatch(textAt(messages, "config_page.transcription.select_transcription_engine.desc"), /Google/);
    assert.match(textAt(messages, "transcription_consent.cloud_notice"), /API/);
    assert.match(textAt(messages, "transcription_consent.cloud_notice"), language === "ja" ? /送られます/ : /sent/);
    assert.match(textAt(messages, "transcription_consent.speechcpp_notice"), /speech\.cpp/);
    assert.equal(localeAt(messages, "transcription_consent.whisper_notice"), undefined);
    for (const code of ["ENGINE_NOT_SELECTED", "ENGINE_UNAVAILABLE"])
        assert.ok(localeAt(messages, `backend_errors.TRANSCRIPTION_${code}`));
    // Only the removed Whisper engine reported these.
    for (const code of ["MODEL_MISSING", "VRAM_MIC", "VRAM_SPEAKER"]) assert.equal(localeAt(messages, `backend_errors.TRANSCRIPTION_${code}`), undefined);
});
