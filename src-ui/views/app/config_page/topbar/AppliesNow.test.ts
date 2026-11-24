import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../logics/test/hookHarness.ts";
import { readLocale, localeAt } from "../../../../logics/test/locales.ts";
import { styleOf } from "../../../../logics/test/styleSource.ts";

const t = (key: string) => key;
async function render(tab: string) {
    const runtime = hooks();
    const { AppliesNow } = await loadModule<typeof import("./Topbar.tsx")>(new URL("./Topbar.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) }, "@logics_common": {},
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: tab } }) },
        "../../others/stop_actions/StopActions": {},
    });
    const tree = runtime.render(AppliesNow);
    runtime.unmount();
    return tree;
}

// #1111, decided 5: every setting saves by itself, so every settings page says that its changes
// apply at once where the save bar was, and nothing in the top bar saves or discards.
test("every settings page says that its changes apply at once; About says nothing", async () => {
    for (const tab of ["translation", "tts", "advanced_settings", "appearance", "vr", "hotkeys"]) {
        const tree = await render(tab);
        assert.equal(find(tree, node => node.props?.className === "applies_now")?.props.children, "voice_ui.applies_now", tab);
        assert.equal(find(tree, node => node.type === "button"), null, `${tab}: nothing to save or discard`);
    }
    // The about page holds no settings, so it says nothing.
    assert.equal(await render("about_vrct"), null);
});

test("the wording exists in English and Japanese", () => {
    for (const language of ["en", "ja"]) assert.equal(typeof localeAt(readLocale(language), "voice_ui.applies_now"), "string");
});

// #912: the words are as high as search, stop and back beside them (4rem), so the row under the
// header does not move from one page to the next.
test("the words are 4rem high, as the other parts of the header row", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("./Topbar.css.ts", import.meta.url), "utf8");
    const rem = (text: string, property: string) => Number(new RegExp(`${property}: "([\\d.]+)rem"`).exec(text)?.[1]);
    assert.equal(rem(styleOf(css, "applies_now"), "minHeight"), 4);
    assert.equal(rem(styleOf(css, "back"), "minHeight"), 4);
    assert.equal(rem(styleOf(css, "stop"), "minHeight"), 4);
});
