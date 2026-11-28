import assert from "node:assert/strict";
import { test } from "vitest";
import { drawWith, hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as networkPortInput from "../../../../../../logics/configs/networkPortInput.ts";
import * as rvcBlockChoices from "../../../../../../logics/configs/rvcBlockChoices.ts";
import * as obsBrowserSourceUrl from "../../../../../../logics/configs/obsBrowserSourceUrl.ts";
import * as logDestination from "../../../../../../logics/configs/logDestination.ts";
import { localeAt, readLocale } from "../../../../../../logics/test/locales.ts";
import * as fieldErrors from "../../../../../../logics/configs/fieldErrors.ts";
import * as fieldChecks from "../../../../../../logics/configs/fieldChecks.ts";

// #614: the advanced settings show their rows' general descriptions as hints. What is read before
// acting stays on screen: the addresses in use, and the sentence that says what the usage data sends.

// Settings as the page reads them: every current value is there (null unless the test gives one),
// every action does nothing.
const settingsWith = (values: Record<string, unknown>) => () => new Proxy({}, { get: (_, key) =>
    String(key).startsWith("current") ? { state: "ok", data: values[String(key)] ?? null } : () => {} });

// The page with its own containers drawn, down to the rows (the templates, kept as names).
async function rows(values: Record<string, unknown> = {}) {
    const settings = settingsWith(values);
    const runtime = hooks();
    const module = await loadModule<typeof import("./AdvancedSettings.tsx")>(new URL("./AdvancedSettings.tsx", import.meta.url), runtime, {
        "@logics_common": { useCopyToClipboard: () => ({ copyToClipboard() {} }), useOpenFolder: settings, useNotificationStatus: () => ({ showNotification_Success() {} }) },
        "@logics_configs": { useAdvancedSettings: settings, useOthers: settings,
            useSaveButtonLogic: (options: { variable: unknown }) => ({ variable: options.variable, onChangeFunction() {}, saveFunction() {} }) },
        "../../../../../../logics/configs/networkPortInput": networkPortInput,
        "../../../../../../logics/configs/rvcBlockChoices": rvcBlockChoices,
        "../../../../../../logics/configs/obsBrowserSourceUrl": obsBrowserSourceUrl,
        "../../../../../../logics/configs/logDestination": logDestination,
        "../../../../../../logics/configs/fieldErrors.ts": fieldErrors,
        "../../../../../../logics/configs/fieldChecks.ts": fieldChecks,
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: (saved: unknown) => ({ draft: saved, setDraft() {}, saving: false, dirty: false, submit() {}, navigationDialog: null }) },
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close() {} }) },
        "../../../../../../logics/configs/telemetryToggle": { shownTelemetry: (value: unknown) => value, telemetryUnanswered: () => false, toggleTelemetryOrAnswer() {} },
        "../shared_items/SharedItems": { AutoExportMessageLogsContainer: "log-row" },
        "../_components/description/Description": { Description: "description" },
        "../_components/telemetry/TelemetryContents": { TelemetryContents: "telemetry-contents" },
        "./GpuCheck.tsx": { GpuCheck: "gpu-check" },
        "../_templates/Templates": { SwitchContainer: "row", ActionButtonContainer: "row", DropdownMenuContainer: "row", EntryWithSaveButtonContainer: "row", ColorEntryWithSaveButtonContainer: "row" },
        "../_components": { ActionButton: "action-button", LabelComponent: "label-component", SectionLabelComponent: "section-label" },
        "../_components/_atoms/_entry/_Entry": { _Entry: "entry" },
        "../_components/path_field/PathField": { PathPickButton: "path-pick" },
        "../_components/hint/Hint": { HintDescriptions: "hints" },
    });
    // The page's containers are its own components: each is drawn from scratch, then those inside it.
    const drawn = (tree: TreeNode): TreeNode[] => [tree, ...nodesIn(tree).filter(node => typeof node.type === "function")
        .flatMap(node => { runtime.remount(); return drawn(drawWith(runtime, node)); })];
    const page = runtime.render(module.AdvancedSettings);
    const trees = drawn(page);
    // Every node of a kind, in all the trees drawn.
    const ofType = (type: string) => trees.flatMap(tree => nodesIn(tree).filter(node => node.type === type));
    return { page, ofType, rows: ofType("row") };
}
const key = (name: string) => `config_page.advanced_settings.${name}`;

test("the page shows descriptions as hints, and keeps the addresses, config path, and usage data lead on screen", async () => {
    const { page, rows: all } = await rows({ currentPathConfig: "/home/user/.config/astarot/config.json" });
    assert.equal(page.type, "hints", "the whole page is inside HintDescriptions");
    const kept = all.filter(row => row.props.keep_desc === true).map(row => row.props.label);
    assert.deepEqual(kept, [key("open_config_filepath.label"), key("websocket_url.label"), key("obs_browser_source_url.label")]);
    assert.equal(all.find(row => row.props.label === key("open_config_filepath.label"))?.props.desc, "/home/user/.config/astarot/config.json");
    // What the usage data sends: one sentence on screen (the row's lead), the rest as the hint.
    const telemetry = all.find(row => row.props.label === key("telemetry.label"))?.props;
    assert.deepEqual([telemetry?.lead, telemetry?.desc, telemetry?.keep_desc], [key("telemetry.lead"), key("telemetry.desc"), undefined]);
    assert.deepEqual(all.filter(row => row.props.lead !== undefined).map(row => row.props.label), [key("telemetry.label")], "no other row has a lead");
    // The two addresses are the values in use, not words about the setting.
    const address = (label: string) => all.find(row => row.props.label === key(label))?.props.desc;
    assert.match(address("websocket_url.label"), /^ws:\/\//);
    assert.match(address("obs_browser_source_url.label"), /^http:\/\//);
});

test("the general descriptions are left to become hints: the rows that carry one do not keep it", async () => {
    const { rows: all } = await rows();
    const hinted = all.filter(row => typeof row.props.desc === "string" && row.props.keep_desc !== true).map(row => row.props.label);
    assert.deepEqual(hinted, [
        key("telemetry.label"),
        key("osc_query.label"),
        key("websocket_host.label"), key("websocket_tls_cert_file.label"), key("websocket_tls_key_file.label"), key("websocket_token.label"),
        key("enable_obs_browser_source.label"),
        key("obs_browser_source_max_messages.label"), key("obs_browser_source_display_duration.label"),
        key("obs_browser_source_fadeout_duration.label"), key("obs_browser_source_font_size.label"),
        key("obs_browser_source_font_outline_thickness.label"),
        key("rvc_block_ms.label"),
    ]);
});

test("the OSC and GPU check headings carry what their sections are as hints; the usage data's contents stay", async () => {
    const { ofType } = await rows();
    const described = ofType("section-label").filter(node => node.props.desc !== undefined);
    assert.deepEqual(described.map(node => [node.props.label, node.props.desc]), [
        // What the check is for, how it measures, what its result holds and what to know before
        // pressing, one to a line.
        [key("section_label_gpu_check"), [key("gpu_check.desc"), key("gpu_check.what"), key("gpu_check.privacy"), key("gpu_check.before")].join("\n")],
        [key("section_label_osc"), "config_page.vrchat.osc_pointer.desc"],
    ], "no other heading has a description");
    // The GPU check and the usage data's contents are parts of their own.
    assert.equal(ofType("gpu-check").length, 1);
    assert.equal(ofType("telemetry-contents").length, 1);
});

test("the note that the OBS address changed is said only while the OBS browser source is on", async () => {
    const note = (found: Awaited<ReturnType<typeof rows>>) => found.ofType("description").map(node => [node.props.text, node.props.fold]);
    assert.deepEqual(note(await rows()), [], "not while the setting has not arrived");
    assert.deepEqual(note(await rows({ currentEnableObsBrowserSource: false })), []);
    // Drawn by itself and unfolded, so the page's hints do not reach it.
    assert.deepEqual(note(await rows({ currentEnableObsBrowserSource: true })), [[key("obs_browser_source_url.desc"), false]]);
});

test("the address and destination rows are named by what they are; their buttons say what pressing does", async () => {
    const { rows: all, ofType } = await rows();
    const actions = all.filter(row => row.props.action_label !== undefined).map(row => [row.props.label, row.props.action_label]);
    assert.deepEqual(actions, [
        [key("open_config_filepath.label"), key("open_config_filepath.open_folder")],
        [key("websocket_url.label"), key("websocket_url.copy")],
        [key("obs_browser_source_url.label"), key("obs_browser_source_url.copy")],
    ]);
    assert.deepEqual(
        ofType("action-button").map(node => [node.props.label, node.props.action_label]),
        [["config_page.others.auto_export_message_logs.destination_label", "config_page.others.auto_export_message_logs.open_folder"]],
    );
    for (const language of ["en", "ja"]) {
        const strings = readLocale(language);
        for (const name of ["websocket_url", "obs_browser_source_url"]) {
            const label = localeAt(strings, `${key(name)}.label`), action = localeAt(strings, `${key(name)}.copy`);
            assert.ok(typeof label === "string" && typeof action === "string");
            assert.doesNotMatch(label, /[（(]/, `${language}: the name carries no instruction`);
            assert.ok(action.includes(label), `${language}: the button names what it copies`);
        }
        for (const [labelKey, actionKey] of [
            ["config_page.others.auto_export_message_logs.destination_label", "config_page.others.auto_export_message_logs.open_folder"],
            [key("open_config_filepath.label"), key("open_config_filepath.open_folder")],
        ]) {
            const label = localeAt(strings, labelKey), action = localeAt(strings, actionKey);
            assert.ok(typeof label === "string" && typeof action === "string");
            assert.notEqual(label, action, `${language}: the destination row name is distinct from its open-folder action`);
        }
    }
});
