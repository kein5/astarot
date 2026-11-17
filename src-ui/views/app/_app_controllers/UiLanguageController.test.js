import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../../../logics/test/hookHarness.js";

const setup = async () => {
    const runtime = hooks(), changes = [];
    const state = { language: "en", ready: false };
    const { UiLanguageController } = await loadModule(new URL("./UiLanguageController.jsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ i18n: { changeLanguage: language => changes.push(language) } }) },
        "@logics_configs": { useAppearance: () => ({ currentUiLanguage: { data: state.language } }) },
        "@logics_common": { useIsBackendReady: () => ({ currentIsBackendReady: { data: state.ready } }) },
    });
    return { runtime, changes, state, UiLanguageController };
};

test("the main window keeps the provisional language until the engine sends the saved one", async () => {
    const { runtime, changes, state, UiLanguageController } = await setup();
    // The setting's built-in "en" must not replace the system language while starting.
    runtime.render(UiLanguageController, { waitForEngine: true });
    assert.deepEqual(changes, []);
    state.language = "ja"; state.ready = true;
    runtime.render(UiLanguageController, { waitForEngine: true });
    assert.deepEqual(changes, ["ja"]);
    state.language = "en";
    runtime.render(UiLanguageController, { waitForEngine: true });
    assert.deepEqual(changes, ["ja", "en"]);
});

test("other windows apply the setting as it is", async () => {
    const { runtime, changes, UiLanguageController } = await setup();
    runtime.render(UiLanguageController);
    assert.deepEqual(changes, ["en"]);
});
