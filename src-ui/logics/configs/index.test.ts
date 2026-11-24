import assert from "node:assert/strict";
import { test } from "vitest";
import { fieldOf, hooks, loadModule } from "../test/hookHarness.ts";
import { loadSettingsList } from "../test/settingsHarness.ts";

// The settings module (index.ts) gives the pages one hook per category of the settings list
// (ui_config_setter.ts): useDevice for "Device", and so on.
test("the settings module gives one hook per category of the list, each made for its own category", async () => {
    const made: string[] = [];
    const index = await loadModule<typeof import("./index.ts")>(new URL("./index.ts", import.meta.url), hooks(), {
        "./config_page_setter/ui_config_setter": {
            createCategoryHook: (category: string) => { made.push(category); return () => category; },
            useSettingValue: () => null,
        },
        "./config_page_setter/hotkeys/useHotkeys": {}, "./useOcrSharedWindow": {}, "./useExperimentalFeature.ts": {},
        "./config_page_setter/_aux/useSettingBoxScrollPosition": {}, "./config_page_setter/_aux/useConfigSearch": {},
        "./config_page_setter/useSettingsLogics": {},
    });
    const { list } = await loadSettingsList();
    const categories = [...new Set(list.SETTINGS_ARRAY.map(setting => setting.Category))];
    assert.deepEqual([...made].sort(), [...categories].sort());
    for (const category of categories) {
        const hook = fieldOf(index, `use${category}`);
        assert.equal(typeof hook, "function", `use${category}`);
        assert.equal(typeof hook === "function" ? hook() : null, category, `use${category} is the hook of ${category}`);
    }
});
