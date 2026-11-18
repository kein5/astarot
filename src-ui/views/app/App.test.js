import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../logics/test/hookHarness.js";
import * as startupPhase from "../../logics/common/startupPhase.ts";

const named = name => Object.defineProperty(() => null, "name", { value: name });
const parts = Object.fromEntries(["ConfigPage", "MainPage", "ModalController", "TranscriptionConsentController",
    "TranslationSetupController", "OcrSetupController", "SwitchBlocksController", "TelemetryNoticeController", "FirstRunSetupController", "VirtualMicGuideController", "WindowGeometryController", "WindowTitleBar",
    "UpdatingComponent", "StartupFailedDialog", "StartupAnnouncer", "UiLanguageController"].map(name => [name, named(name)]));

const load = async phase => {
    const runtime = hooks();
    const { App } = await loadModule(new URL("./App.tsx", import.meta.url), runtime, {
        "./_app_controllers/TranscriptionConsentController": { TranscriptionConsentController: parts.TranscriptionConsentController },
        "./_app_controllers/TranslationSetupController": { TranslationSetupController: parts.TranslationSetupController },
        "./_app_controllers/TelemetryNoticeController": { TelemetryNoticeController: parts.TelemetryNoticeController },
        "./_app_controllers/OcrSetupController": { OcrSetupController: parts.OcrSetupController },
        "./_app_controllers/VirtualMicGuideController": { VirtualMicGuideController: parts.VirtualMicGuideController },
        "./_app_controllers/FirstRunSetupController": { FirstRunSetupController: parts.FirstRunSetupController },
        "./_app_controllers/SwitchBlocksController": { SwitchBlocksController: parts.SwitchBlocksController },
        "./_app_controllers": { UiLanguageController: parts.UiLanguageController },
        "./_app_controllers/QuickChatController": {}, "./_app_controllers/CaptionOverlayController": {}, "./_app_controllers/CompanionController": {}, "./_app_controllers/IoFlowController": {},
        "./main_page/MainPage": { MainPage: parts.MainPage }, "./config_page/ConfigPage": { ConfigPage: parts.ConfigPage },
        "./others": { WindowTitleBar: parts.WindowTitleBar, UpdatingComponent: parts.UpdatingComponent, ModalController: parts.ModalController },
        "@logics_common": { WindowGeometryController: parts.WindowGeometryController,
            useIsSoftwareUpdating: () => ({ currentIsSoftwareUpdating: { data: false } }) },
        "@useI18n": { useI18n: () => ({ i18n: { language: "en" } }) },
        "../../logics/common/useBackendStartup": { useBackendStartup: () => ({ phase }) },
        "../../logics/common/startupPhase": startupPhase,
        "./others/startup/StartupFailedDialog": { StartupFailedDialog: parts.StartupFailedDialog },
        "./others/startup/StartupAnnouncer": { StartupAnnouncer: parts.StartupAnnouncer },
    });
    const tree = runtime.render(App);
    const contents = find(tree, node => node.type?.name === "Contents");
    const inner = contents.type(contents.props);
    const has = (node, part) => !!find(node, child => child.type === part);
    return { tree, contents, inner, has };
};

test("from the first frame the main page and title bar are drawn, locked until the engine is ready", async () => {
    for (const [phase, locked, announcer, dialog] of [
        ["starting", true, true, false], ["failed", true, false, true], ["ready", false, false, false], ["stopped", false, false, false],
    ]) {
        const { tree, contents, inner, has } = await load(phase);
        assert.equal(contents.props.locked, locked, phase);
        assert.equal(has(tree, parts.StartupAnnouncer), announcer, phase);
        assert.equal(has(tree, parts.StartupFailedDialog), dialog, phase);
        assert.ok(has(inner, parts.WindowTitleBar), "the title bar keeps closing and moving the window");
        const page = find(inner, node => node.type === parts.MainPage);
        assert.equal(page.props.locked, locked);
        // The settings page and the dialogs that act on the engine's settings wait for them.
        for (const part of [parts.ConfigPage, parts.ModalController, parts.TranscriptionConsentController,
            parts.TranslationSetupController, parts.OcrSetupController, parts.TelemetryNoticeController,
            parts.FirstRunSetupController, parts.VirtualMicGuideController, parts.SwitchBlocksController]) assert.equal(has(inner, part), !locked, `${phase}: ${part.name}`);
        assert.equal(find(inner, node => node.type === parts.WindowGeometryController).props.saveGeometry, !locked);
        assert.equal(find(tree, node => node.type === parts.UiLanguageController).props.waitForEngine, true);
    }
});
