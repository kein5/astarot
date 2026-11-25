import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { findIn, hooks, kitStandIns, loadModule } from "../../../../../../logics/test/hookHarness.ts";

// The bar over the language selection: Go back, then the title. Go back is the kit's plain Button
// (the hand-built inventory's "Language selection" row); the bar gives it only its place.
test("Go back is the kit's plain button and closes the language selection", async () => {
    const runtime = hooks(), updates: unknown[] = [];
    const module = await loadModule<typeof import("./LanguageSelectorTopBar.tsx")>(new URL("./LanguageSelectorTopBar.tsx", import.meta.url), runtime, {
        "@store": { useStore_IsOpenedLanguageSelector: () => ({ updateIsOpenedLanguageSelector: (value: unknown) => { updates.push(value); } }) },
    });
    const tree = runtime.render(module.LanguageSelectorTopBar, { title: "main_page.language_selector.title_your_language" });
    const back = findIn(tree, node => node.type === kitStandIns.Button, "Go back");
    // The kit's defaults: plain, regular (4rem), type="button".
    assert.deepEqual([back.props.tone, back.props.size, back.props.type, back.props.className, back.props.children],
        [undefined, undefined, undefined, "go_back_button_wrapper", "common.go_back_button_label"]);
    assert.equal(findIn(tree, node => node.type === "p").props.children, "main_page.language_selector.title_your_language");
    assert.deepEqual(updates, []);
    back.props.onClick();
    assert.deepEqual(updates, [{ your_language: false, target_language: false, target_key: "1" }]);
});

test("the bar places Go back and keeps the title clear of it; the button's look is the kit's", () => {
    const css = readFileSync(new URL("./LanguageSelectorTopBar.css.ts", import.meta.url), "utf8");
    const rule = css.slice(css.indexOf("export const go_back_button_wrapper"));
    assert.match(rule, /^export const go_back_button_wrapper = style\(\{\s*position: "absolute",\s*left: "1\.6rem",\s*\}\);\s*$/);
    assert.match(css, /paddingInline: "11rem",/);
});
