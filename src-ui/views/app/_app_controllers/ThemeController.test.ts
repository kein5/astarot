import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, stubGlobals } from "../../../logics/test/hookHarness.ts";
import * as themes from "../../../logics/theme/themes.ts";

// The theme in use (#965) is set over variables.css on <html>; the default theme takes every
// override away, so the stylesheet's values apply again.
test("the theme in use sets its tokens on the page, and the default theme takes them away", async context => {
    const runtime = hooks(), properties = new Map<string, string>();
    let theme: unknown = { preset: "forest", custom: { base: "#261633", accent: "#a47af5" } };
    stubGlobals(context, { document: { documentElement: { style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
    } } } });
    context.onTestFinished(() => runtime.unmount());
    const { ThemeController } = await loadModule<typeof import("./ThemeController.tsx")>(new URL("./ThemeController.tsx", import.meta.url), runtime, {
        "@logics_configs": { useAppearance: () => ({ currentTheme: { data: theme } }) },
        "../../../logics/theme/themes.ts": themes,
    });
    runtime.render(ThemeController);
    const forest = themes.deriveTokens(themes.PRESETS.find(preset => preset.id === "forest")?.colors ?? themes.PRESETS[0].colors);
    assert.equal(properties.get("--vox_canvas"), forest["--vox_canvas"]);
    assert.equal(properties.get("--primary_600_color"), forest["--primary_600_color"]);
    assert.equal(properties.size, themes.THEME_TOKENS.length);
    // The user's own colours.
    theme = { preset: "custom", custom: { base: "#10272b", accent: "#3fc8c2" } };
    runtime.render(ThemeController);
    assert.equal(properties.get("--vox_canvas"), themes.deriveTokens({ base: "#10272b", accent: "#3fc8c2" })["--vox_canvas"]);
    // Back to the default, a preset this version does not know, and no setting: the stylesheet.
    for (const next of [{ preset: "dark_plum", custom: { base: "#10272b", accent: "#3fc8c2" } }, { preset: "a_newer_preset", custom: { base: "#10272b", accent: "#3fc8c2" } }, undefined]) {
        theme = { preset: "midnight", custom: { base: "#10272b", accent: "#3fc8c2" } };
        runtime.render(ThemeController);
        assert.ok(properties.size > 0);
        theme = next;
        runtime.render(ThemeController);
        assert.equal(properties.size, 0, JSON.stringify(next));
    }
});
