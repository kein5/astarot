import assert from "node:assert/strict";
import { test } from "vitest";
import { drawWith, hooks, loadModule, nodesIn } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";
import * as networkPortInput from "../../../../../../logics/configs/networkPortInput.ts";
import * as obsBrowserSourceUrl from "../../../../../../logics/configs/obsBrowserSourceUrl.ts";

// #614: the advanced settings show their rows' general descriptions as hints. What is read before
// acting stays on screen: the addresses in use and what the usage data sends.

// Settings as the page reads them: every current value is there, every action does nothing.
const settings = () => new Proxy({}, { get: (_, key) => String(key).startsWith("current") ? { state: "ok", data: null } : () => {} });

// The page with its own containers drawn, down to the rows (the templates, kept as names).
async function rows() {
    const runtime = hooks();
    const module = await loadModule<typeof import("./AdvancedSettings.tsx")>(new URL("./AdvancedSettings.tsx", import.meta.url), runtime, {
        "@logics_common": { useCopyToClipboard: () => ({ copyToClipboard() {} }), useOpenFolder: settings, useNotificationStatus: () => ({ showNotification_Success() {} }) },
        "@logics_configs": { useAdvancedSettings: settings, useOthers: settings,
            useSaveButtonLogic: (options: { variable: unknown }) => ({ variable: options.variable, onChangeFunction() {}, saveFunction() {} }) },
        "../../../../../../logics/configs/networkPortInput": networkPortInput,
        "../../../../../../logics/configs/obsBrowserSourceUrl": obsBrowserSourceUrl,
        "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: (saved: unknown) => ({ draft: saved, setDraft() {}, saving: false, dirty: false, submit() {}, navigationDialog: null }) },
        "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close() {} }) },
        "../../../../../../logics/configs/telemetryToggle": { shownTelemetry: (value: unknown) => value, telemetryUnanswered: () => false, toggleTelemetryOrAnswer() {} },
        "../shared_items/SharedItems": { AutoExportMessageLogsContainer: "log-row" },
        "../_components/description/Description": { Description: "description" },
        "../_components/telemetry/TelemetryContents": { TelemetryContents: "telemetry-contents" },
        "./GpuCheck.tsx": { GpuCheck: "gpu-check" },
        "../_templates/Templates": { CheckboxContainer: "row", ActionButtonContainer: "row", EntryWithSaveButtonContainer: "row", ColorEntryWithSaveButtonContainer: "row" },
        "../_components": { SectionLabelComponent: "section-label" },
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

test("the page shows descriptions as hints, and keeps the addresses in use and what the usage data sends on screen", async () => {
    const { page, rows: all } = await rows();
    assert.equal(page.type, "hints", "the whole page is inside HintDescriptions");
    const kept = all.filter(row => row.props.keep_desc === true).map(row => row.props.label);
    assert.deepEqual(kept, [key("telemetry.label"), key("websocket_url.label"), key("obs_browser_source_url.label")]);
    // The two addresses are the values in use, not words about the setting.
    const address = (label: string) => all.find(row => row.props.label === key(label))?.props.desc;
    assert.match(address("websocket_url.label"), /^ws:\/\//);
    assert.match(address("obs_browser_source_url.label"), /^http:\/\//);
});

test("the general descriptions are left to become hints: the rows that carry one do not keep it", async () => {
    const { rows: all } = await rows();
    const hinted = all.filter(row => typeof row.props.desc === "string" && row.props.keep_desc !== true).map(row => row.props.label);
    assert.deepEqual(hinted, [
        key("osc_query.label"),
        key("websocket_host.label"), key("websocket_tls_cert_file.label"), key("websocket_tls_key_file.label"), key("websocket_token.label"),
        key("enable_obs_browser_source.label"),
        key("obs_browser_source_max_messages.label"), key("obs_browser_source_display_duration.label"),
        key("obs_browser_source_fadeout_duration.label"), key("obs_browser_source_font_size.label"),
        key("obs_browser_source_font_outline_thickness.label"),
        key("rvc_block_ms.label"),
    ]);
});

test("the OSC heading says what the destination is, and the notes that are not rows stay as they were", async () => {
    const { ofType } = await rows();
    const described = ofType("section-label").filter(node => node.props.desc !== undefined);
    assert.deepEqual(described.map(node => [node.props.label, node.props.desc]),
        [[key("section_label_osc"), "config_page.vrchat.osc_pointer.desc"]], "only the OSC heading has a description");
    // The note under the OBS address is drawn by itself and unfolded, with or without hints.
    assert.deepEqual(ofType("description").map(note => [note.props.text, note.props.fold]), [[key("obs_browser_source_url.desc"), false]]);
    // The GPU check and the usage data's contents are parts of their own.
    assert.equal(ofType("gpu-check").length, 1);
    assert.equal(ofType("telemetry-contents").length, 1);
});
