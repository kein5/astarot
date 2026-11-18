import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../../../../../logics/test/hookHarness.js";

async function settings() {
    const runtime = hooks(), closed = [];
    const { LanguageSettings } = await loadModule(new URL("./LanguageSettings.jsx", import.meta.url), runtime, {
        "@store": { useStore_IsOpenedTranslatorSelector: () => ({ updateIsOpenedTranslatorSelector: value => closed.push(value) }) },
        "@logics_main": { useMainFunction: () => ({}) },
        "./preset_tab_selector/PresetTabSelector": { PresetTabSelector: "presets" },
        "./language_selector_open_button/LanguageSelectorOpenButton": { LanguageSelectorOpenButton: "language" },
        "./language_swap_button/LanguageSwapButton": { LanguageSwapButton: "swap" },
        "./translator_selector_open_button/TranslatorSelectorOpenButton": { TranslatorSelectorOpenButton: "translator" },
        "./add_remove_target_language_buttons/AddRemoveTargetLanguageButtons": { AddRemoveTargetLanguageButtons: "add-remove" },
    });
    const container = runtime.render(LanguageSettings);
    return { leave: event => container.props.onMouseLeave(event), closed };
}

// The rail's scroll container: 240px wide at x=0, of which 232px are content and 8px scrollbar.
const inside = {};
const rail = { clientLeft: 0, clientWidth: 232, getBoundingClientRect: () => ({ left: 0 }), contains: node => node === inside };

test("the translator list stays open when the pointer goes to the rail's scrollbar", async () => {
    const s = await settings();
    s.leave({ currentTarget: inside, relatedTarget: rail, clientX: 236 });
    assert.deepEqual(s.closed, []);
});

test("the translator list closes when the pointer leaves the language settings anywhere else", async () => {
    const s = await settings();
    s.leave({ currentTarget: inside, relatedTarget: rail, clientX: 120 });
    s.leave({ currentTarget: inside, relatedTarget: { getBoundingClientRect: () => ({ left: 0 }), contains: () => false }, clientX: 300 });
    s.leave({ currentTarget: inside, relatedTarget: null, clientX: 0 });
    assert.deepEqual(s.closed, [false, false, false]);
});
