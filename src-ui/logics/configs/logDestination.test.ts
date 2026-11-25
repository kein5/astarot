import assert from "node:assert/strict";
import { test } from "vitest";
import { findIn, hooks, kitStandIns, loadModule, nodesIn } from "../test/hookHarness.ts";
import { localeAt, readLocale } from "../test/locales.ts";
import { createInitializationValidators } from "../common/initializationFields.ts";
import {
    isAbsolutePath,
    LOG_DIRECTORY_ERROR_CODES,
    logDirectoryErrorKey,
    normalizeLogDirectoryState,
    validateLogDirectoryInput,
} from "./logDestination.ts";
import type { PickFolderResult } from "./logDestination.ts";
import * as fieldErrors from "./fieldErrors.ts";
import * as fieldChecks from "./fieldChecks.ts";

test("isAbsolutePath recognizes Unix, Windows drive, and UNC paths and rejects relative paths", () => {
    for (const valid of ["/tmp/logs", "/", "C:\\Users\\user\\logs", "D:/logs", "\\\\server\\share\\logs"]) {
        assert.equal(isAbsolutePath(valid), true, valid);
    }
    for (const invalid of ["", "logs", "./logs", "../logs", "relative/path", "C:relative"]) {
        assert.equal(isAbsolutePath(invalid), false, invalid);
    }
});

test("validateLogDirectoryInput trims valid absolute paths and rejects empty or relative input", () => {
    assert.deepEqual(validateLogDirectoryInput("  /var/tmp/logs  "), { ok: true, path: "/var/tmp/logs" });
    assert.deepEqual(validateLogDirectoryInput("C:\\Logs\\Chat"), { ok: true, path: "C:\\Logs\\Chat" });
    assert.deepEqual(validateLogDirectoryInput("   "), { ok: false, error_code: "log_directory_invalid" });
    assert.deepEqual(validateLogDirectoryInput("relative/logs"), { ok: false, error_code: "log_directory_not_absolute" });
});

test("every log directory error code has non-empty English and Japanese inline validation messages", () => {
    for (const lang of ["en", "ja"] as const) {
        const strings = readLocale(lang);
        for (const code of LOG_DIRECTORY_ERROR_CODES) {
            const text = localeAt(strings, logDirectoryErrorKey(code));
            assert.equal(typeof text, "string", `${lang}: ${code}`);
            assert.ok(String(text).trim().length > 10, `${lang}: ${code} should state both problem and remedy`);
        }
    }
    assert.equal(logDirectoryErrorKey("unexpected_code"), "config_page.others.auto_export_message_logs.errors.log_directory_invalid");
});

test("normalizeLogDirectoryState and initializationFields accept path_logs with null or string error_code", () => {
    assert.deepEqual(normalizeLogDirectoryState({ path: "/tmp/logs", error_code: null }), { path: "/tmp/logs", error_code: null });
    assert.deepEqual(normalizeLogDirectoryState({ path: "/tmp/logs", error_code: "log_directory_missing" }), { path: "/tmp/logs", error_code: "log_directory_missing" });
    assert.equal(normalizeLogDirectoryState({ path: "/tmp/logs", error_code: 42 }), null);
    assert.equal(normalizeLogDirectoryState("bad"), null);

    const validators = createInitializationValidators([
        { base_endpoint_name: "path_config", logics_template_id: "get_only", default_value: "" },
        { base_endpoint_name: "path_logs", logics_template_id: "get_set", default_value: { path: "", error_code: null } },
    ]);
    assert.equal(validators["/get/data/path_config"]("/state/config.json"), true);
    assert.equal(validators["/get/data/path_config"](null), false);
    assert.equal(validators["/get/data/path_logs"]({ path: "/state/logs", error_code: null }), true);
    assert.equal(validators["/get/data/path_logs"]({ path: "/state/logs", error_code: "log_directory_missing" }), true);
    assert.equal(validators["/get/data/path_logs"]({ path: 123, error_code: null }), false);
    assert.equal(validators["/get/data/path_logs"](null), false);
});

async function mountDestinationRows(options: {
    pathConfig?: string;
    pathLogs?: { path: string; error_code: string | null };
    setPathLogs?: (value: unknown) => Promise<unknown>;
    pickResult?: PickFolderResult;
} = {}) {
    const sent: unknown[] = [];
    const opened: string[] = [];
    const fieldHookCalls: unknown[] = [];
    let currentLogs = { state: "ok", data: options.pathLogs ?? { path: "/state/logs", error_code: null } };
    const currentConfig = { state: "ok", data: options.pathConfig ?? "/state/config.json" };
    const setPathLogs = async (value: unknown) => {
        sent.push(value);
        if (options.setPathLogs) return options.setPathLogs(value);
        if (value === null) {
            currentLogs = { state: "ok", data: { path: "/state/logs", error_code: null } };
            return { status: 200, result: currentLogs.data };
        }
        currentLogs = { state: "ok", data: { path: String(value), error_code: null } };
        return { status: 200, result: currentLogs.data };
    };
    const runtime = hooks();
    const advancedPath = "../../views/app/config_page/setting_section/setting_box/advanced_settings/AdvancedSettings.tsx";
    const module = await loadModule<typeof import("../../views/app/config_page/setting_section/setting_box/advanced_settings/AdvancedSettings.tsx")>(
        new URL(advancedPath, import.meta.url),
        runtime,
        {
            "../../../../../../logics/configs/fieldErrors.ts": fieldErrors,
            "../../../../../../logics/configs/fieldChecks.ts": fieldChecks,
            "@logics_common": {
                useCopyToClipboard: () => ({ copyToClipboard() {} }),
                useOpenFolder: () => ({
                    openFolder_MessageLogs: () => opened.push("logs"),
                    openFolder_ConfigFile: () => opened.push("config"),
                }),
                useNotificationStatus: () => ({ showNotification_Success() {} }),
            },
            "@logics_configs": {
                useAdvancedSettings: () => ({ currentPathLogs: currentLogs, setPathLogs, currentPathConfig: currentConfig }),
                useOthers: () => ({}),
                useSaveButtonLogic: (arg: unknown) => {
                    fieldHookCalls.push(arg);
                    return { variable: null, onChangeFunction() {}, saveFunction() {} };
                },
            },
            "../../../../../../logics/configs/networkPortInput": { parsePortInput: () => null, PORT_INPUT_LIMITS: {} },
            "../../../../../../logics/configs/rvcBlockChoices": { rvcBlockChoiceId: () => "0", rvcBlockChoices: () => ({}) },
            "../../../../../../logics/configs/obsBrowserSourceUrl": { buildObsBrowserSourceUrl: () => ({ url: "", shown: "" }), buildWebsocketUrl: () => ({ url: "", shown: "" }) },
            "../../../../../../logics/configs/logDestination": {
                logDirectoryErrorKey,
                validateLogDirectoryInput,
                pickLogDirectory: async () => options.pickResult ?? { ok: true, path: null },
            },
            "../../../../../../logics/voice/useSettingsDraft": { useSettingsDraft: () => ({}) },
            "../../../../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close() {} }) },
            "../../../../../../logics/configs/telemetryToggle": { shownTelemetry: (v: unknown) => v, telemetryUnanswered: () => false, toggleTelemetryOrAnswer() {} },
            "../shared_items/SharedItems": { AutoExportMessageLogsContainer: "log-toggle" },
            "../_components/description/Description": { Description: "description" },
            "../_components/telemetry/TelemetryContents": { TelemetryContents: "telemetry" },
            "./GpuCheck.tsx": { GpuCheck: "gpu-check" },
            "../_templates/Templates": {
                SwitchContainer: "switch",
                ActionButtonContainer: "action-row",
                DropdownMenuContainer: "dropdown",
                EntryWithSaveButtonContainer: "entry",
                ColorEntryWithSaveButtonContainer: "color",
            },
            "../_components": { ActionButton: "action-button", LabelComponent: "label-component", SectionLabelComponent: "section-label" },
            "../_components/_atoms/_entry/_Entry": { _Entry: "entry-input" },
            "../_components/hint/Hint": { HintDescriptions: "hints" },
        },
    );
    return {
        sent,
        opened,
        fieldHookCalls,
        renderLog: () => runtime.render(module.LogDestinationContainer),
        renderConfig: () => runtime.render(module.OpenConfigFolderContainer),
    };
}

test("OpenConfigFolderContainer shows the read-only config path and keeps the open-folder action", async () => {
    const env = await mountDestinationRows({ pathConfig: "/home/tester/.config/astarot/config.json" });
    const tree = env.renderConfig();
    assert.equal(tree.type, "action-row");
    assert.equal(tree.props.desc, "/home/tester/.config/astarot/config.json");
    assert.equal(tree.props.keep_desc, true);
    tree.props.onclickFunction();
    assert.deepEqual(env.opened, ["config"]);
});

test("LogDestinationContainer auto-saves valid paths, blocks invalid syntax client-side, and shows backend 400 errors inline", async () => {
    const env = await mountDestinationRows({
        setPathLogs: async value => {
            if (value === "/missing/dir") {
                return { status: 400, result: { path: "/state/logs", error_code: "log_directory_missing" } };
            }
            return { status: 200, result: { path: value === null ? "/state/logs" : String(value), error_code: null } };
        },
    });

    let tree = env.renderLog();
    assert.equal(env.fieldHookCalls.length, 0, "the row saves by itself, not through the field hook (#1111)");
    assert.equal(findIn(tree, node => node.type === "entry-input").props.ui_variable, "/state/logs");

    // Relative path: blocked client-side without sending /set/data/path_logs.
    findIn(tree, node => node.type === "entry-input").props.onChange({ target: { value: "relative/logs" } });
    tree = env.renderLog();
    await findIn(tree, node => node.type === "entry-input").props.onEnterPressed();
    tree = env.renderLog();
    assert.deepEqual(env.sent, [], "relative path is never sent to the backend");
    const alert = findIn(tree, node => node.props?.role === "alert");
    assert.equal(alert.props.children, "config_page.others.auto_export_message_logs.errors.log_directory_not_absolute");
    assert.equal(findIn(tree, node => node.type === "entry-input").props["aria-invalid"], true);

    // Escape reverts the invalid draft and clears the inline error.
    findIn(tree, node => node.type === "entry-input").props.onKeyDown({ key: "Escape" });
    tree = env.renderLog();
    assert.equal(findIn(tree, node => node.type === "entry-input").props.ui_variable, "/state/logs");
    assert.equal(nodesIn(tree).filter(node => node.props?.role === "alert").length, 0);

    // Missing absolute path: backend returns 400, inline error appears beside the input, draft stays for fixing.
    findIn(tree, node => node.type === "entry-input").props.onChange({ target: { value: "/missing/dir" } });
    tree = env.renderLog();
    await findIn(tree, node => node.type === "entry-input").props.onBlur({ relatedTarget: null });
    tree = env.renderLog();
    assert.deepEqual(env.sent, ["/missing/dir"]);
    assert.equal(findIn(tree, node => node.props?.role === "alert").props.children, "config_page.others.auto_export_message_logs.errors.log_directory_missing");
    assert.equal(findIn(tree, node => node.type === "entry-input").props.ui_variable, "/missing/dir");

    // Reset button sends null and clears the error.
    const buttons = nodesIn(tree).filter(node => node.type === kitStandIns.Button);
    const resetButton = buttons.find(node => node.props.children === "config_page.others.auto_export_message_logs.reset_folder");
    assert.ok(resetButton);
    // The kit's plain buttons; pressing one does not save the field as its focus leaves.
    assert.deepEqual(buttons.map(node => [node.props.tone, node.props["data-skip-blur-commit"]]), [[undefined, "true"], [undefined, "true"]]);
    await resetButton.props.onClick();
    tree = env.renderLog();
    assert.deepEqual(env.sent, ["/missing/dir", null]);
    assert.equal(nodesIn(tree).filter(node => node.props?.role === "alert").length, 0);
});

test("LogDestinationContainer chooses a folder via native picker and surfaces picker failures inline", async () => {
    const okEnv = await mountDestinationRows({ pickResult: { ok: true, path: "/picked/logs" } });
    let tree = okEnv.renderLog();
    const chooseBtn = nodesIn(tree).find(node => node.type === kitStandIns.Button && node.props.children === "config_page.others.auto_export_message_logs.choose_folder");
    assert.ok(chooseBtn);
    await chooseBtn.props.onClick();
    tree = okEnv.renderLog();
    assert.deepEqual(okEnv.sent, ["/picked/logs"]);
    assert.equal(nodesIn(tree).filter(node => node.props?.role === "alert").length, 0);

    const failEnv = await mountDestinationRows({ pickResult: { ok: false, error_code: "folder_picker_unavailable" } });
    tree = failEnv.renderLog();
    const failBtn = nodesIn(tree).find(node => node.type === kitStandIns.Button && node.props.children === "config_page.others.auto_export_message_logs.choose_folder");
    assert.ok(failBtn);
    await failBtn.props.onClick();
    tree = failEnv.renderLog();
    assert.deepEqual(failEnv.sent, []);
    assert.equal(findIn(tree, node => node.props?.role === "alert").props.children, "config_page.others.auto_export_message_logs.errors.folder_picker_unavailable");
});

test("LogDestinationContainer surfaces a startup fallback error returned by /get/data/path_logs", async () => {
    const env = await mountDestinationRows({ pathLogs: { path: "/state/logs", error_code: "log_directory_missing" } });
    const tree = env.renderLog();
    assert.equal(findIn(tree, node => node.props?.role === "alert").props.children, "config_page.others.auto_export_message_logs.errors.log_directory_missing");
});

test("a path is absolute only from its start, and a UNC path needs a host and a share", () => {
    for (const invalid of ["logs/C:/chat", "x C:\\logs", "logs\\\\server\\share", "\\\\server", "\\\\server\\"]) {
        assert.equal(isAbsolutePath(invalid), false, invalid);
    }
    assert.equal(isAbsolutePath("\\\\server\\s"), true);
});

test("the backend's log folder answer is read only as an object with a path and an error code or null", () => {
    assert.deepEqual(normalizeLogDirectoryState({ path: "/logs", error_code: null }), { path: "/logs", error_code: null });
    assert.deepEqual(normalizeLogDirectoryState({ path: "/logs", error_code: "log_directory_missing", extra: 1 }), { path: "/logs", error_code: "log_directory_missing" });
    for (const value of [null, undefined, "/logs", 3, [], Object.assign(["/logs"], { path: "/logs", error_code: null }),
        Object.assign(() => {}, { path: "/logs", error_code: null }), { path: 1, error_code: null }, { path: "/logs", error_code: 1 }, { path: "/logs" }]) {
        assert.equal(normalizeLogDirectoryState(value), null, String(typeof value === "function" ? "a function" : JSON.stringify(value)));
    }
});

test("the folder picker starts at the current folder, reads a chosen folder, and says when it cannot open", async () => {
    const asked: [string, unknown][] = [];
    let answer: () => unknown = () => "/chosen";
    const { pickLogDirectory } = await loadModule<typeof import("./logDestination.ts")>(new URL("./logDestination.ts", import.meta.url), hooks(), {
        "@tauri-apps/api/core": { invoke: async (command: string, args: unknown) => { asked.push([command, args]); return answer(); } },
    });
    assert.deepEqual(await pickLogDirectory("/now", "Pick"), { ok: true, path: "/chosen" });
    assert.deepEqual(asked, [["pick_folder", { initialPath: "/now", title: "Pick" }]]);
    for (const initial of ["  ", "", null]) {
        asked.length = 0;
        await pickLogDirectory(initial, "Pick");
        assert.deepEqual(asked, [["pick_folder", { initialPath: null, title: "Pick" }]], JSON.stringify(initial));
    }
    for (const chosen of [null, "   ", 7]) {
        answer = () => chosen;
        assert.deepEqual(await pickLogDirectory(null, "Pick"), { ok: true, path: null }, `nothing chosen: ${JSON.stringify(chosen)}`);
    }
    answer = () => { throw new Error("no dialog"); };
    assert.deepEqual(await pickLogDirectory(null, "Pick"), { ok: false, error_code: "folder_picker_unavailable" });
});
