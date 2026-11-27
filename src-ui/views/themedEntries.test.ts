import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, stubGlobals } from "../logics/test/hookHarness.ts";

// Every window that follows the theme puts the theme the shell gave it in place before its first
// render (#1259): the main window, the settings window and the VR panel through their Appearance
// setting (startWithSavedTheme), the tray panel and Quick Chat on their root (applyStartupTheme).
// The VR panel's page has its own test (vr/index.test.ts).

const Stand = () => null;
const entries: { name: string; url: URL; theme: string; dependencies: Record<string, unknown> }[] = [
    { name: "the main window", url: new URL("./app/index.tsx", import.meta.url), theme: "../../logics/theme/startWithSavedTheme.ts",
        dependencies: { "@root/locales/config.ts": {}, "./_index_css/root.css": {}, "@tauri-apps/api/window": { getCurrentWindow: () => ({}) },
            "@store": { store: {} }, "./App": { App: Stand } } },
    { name: "the settings window", url: new URL("./settings_window/index.tsx", import.meta.url), theme: "../../logics/theme/startWithSavedTheme.ts",
        dependencies: { "@root/locales/config.ts": {}, "../app/_index_css/root.css": {}, "@tauri-apps/api/window": { getCurrentWindow: () => ({}) },
            "@store": { store: {} }, "./SettingsWindowApp": { SettingsWindowApp: Stand } } },
    { name: "the tray panel", url: new URL("./companion_panel/index.tsx", import.meta.url), theme: "../../logics/theme/startupTheme.ts",
        dependencies: { "../../../locales/config": {}, "../app/_index_css/root.css": {}, "./CompanionPanel.tsx": { CompanionPanel: Stand } } },
    { name: "Quick Chat", url: new URL("./quick_chat/index.tsx", import.meta.url), theme: "../../logics/theme/startupTheme.ts",
        dependencies: { "../../../locales/config": {}, "../app/_index_css/root.css": {}, "./QuickChat": { QuickChat: Stand } } },
];

for (const entry of entries) test(`${entry.name} puts the shell's theme in place before its first render`, async context => {
    const steps: string[] = [];
    stubGlobals(context, { document: { getElementById: (id: string) => (id === "root" ? { id } : null) } });
    const record = () => { steps.push("theme"); };
    await loadModule(entry.url, hooks(), {
        ...entry.dependencies,
        "react-dom/client": { createRoot: () => ({ render: () => { steps.push("render"); } }) },
        [entry.theme]: { startWithSavedTheme: record, applyStartupTheme: record },
    });
    assert.deepEqual(steps, ["theme", "render"]);
});
