import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, stubGlobals } from "../../../logics/test/hookHarness.ts";

test("the selected font family is set as one CSS string, so non-identifier names still apply", async context => {
    const runtime = hooks(), properties = new Map();
    let font = "Yu Gothic UI";
    stubGlobals(context, { document: { documentElement: { style: {
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: name => properties.delete(name),
    } } } });
    context.onTestFinished(() => runtime.unmount());
    const { FontFamilyController } = await loadModule(new URL("./FontFamilyController.tsx", import.meta.url), runtime, {
        "@logics_configs": { useAppearance: () => ({ currentSelectedFontFamily: { data: font } }) },
    });
    for (const [name, css] of [
        ["Yu Gothic UI", '"Yu Gothic UI"'],
        // A word that starts with a digit, or "@", makes an unquoted list invalid.
        ["M PLUS 1p", '"M PLUS 1p"'],
        ["@MS Gothic", '"@MS Gothic"'],
        ['Font "Quoted" \\ Name', '"Font \\"Quoted\\" \\\\ Name"'],
    ]) {
        font = name;
        runtime.render(FontFamilyController);
        assert.equal(properties.get("--font_family"), css, name);
    }
    // No name keeps the stylesheet default instead of the text "undefined".
    font = undefined;
    runtime.render(FontFamilyController);
    assert.equal(properties.has("--font_family"), false);
});
