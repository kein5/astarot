import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../../../../../logics/test/hookHarness.ts";

// The translator list opens as a floating popover beside the rail (#1095) and handles
// outside presses, Escape and focus-out itself, so LanguageSettings does not close it
// when the pointer crosses out of the rail toward the popover.
test("LanguageSettings does not attach a mouseleave handler that would close the translator popover", async () => {
    const runtime = hooks();
    const { LanguageSettings } = await loadModule<typeof import("./LanguageSettings.tsx")>(new URL("./LanguageSettings.tsx", import.meta.url), runtime, {
        "@logics_main": { useMainFunction: () => ({}) },
        "./preset_tab_selector/PresetTabSelector": { PresetTabSelector: "presets" },
        "./language_selector_open_button/LanguageSelectorOpenButton": { LanguageSelectorOpenButton: "language" },
        "./language_swap_button/LanguageSwapButton": { LanguageSwapButton: "swap" },
        "./translator_selector_open_button/TranslatorSelectorOpenButton": { TranslatorSelectorOpenButton: "translator" },
        "./add_remove_target_language_buttons/AddRemoveTargetLanguageButtons": { AddRemoveTargetLanguageButtons: "add-remove" },
    });
    const container = runtime.render(LanguageSettings);
    assert.equal(container.props.onMouseLeave, undefined);
    runtime.unmount();
});
