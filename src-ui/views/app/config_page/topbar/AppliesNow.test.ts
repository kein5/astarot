import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, kitStandIns, loadModule, find } from "../../../../logics/test/hookHarness.ts";
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
    // Back is the kit's Button at its regular size, 4rem high.
    const tsx = readFileSync(new URL("./Topbar.tsx", import.meta.url), "utf8");
    assert.match(tsx, /<Button className=\{styles\.back\} data-settings-back=""/);
    const kit = readFileSync(new URL("../../../kit/Button.css.ts", import.meta.url), "utf8");
    assert.match(kit, /base: \{[^}]*minHeight: "4rem",/);
    assert.match(kit, /defaultVariants: \{ tone: "plain", size: "regular" \}/);
    assert.doesNotMatch(styleOf(css, "back"), /minHeight|padding|fontSize/, "the bar gives back only its place");
    assert.equal(rem(styleOf(css, "stop"), "minHeight"), 4);
});

// Go back is the kit's plain Button: named by its words, which hide with the narrow bar, and it
// closes the settings.
test("Go back is the kit's button and closes the settings", async () => {
    const runtime = hooks(), opened: boolean[] = [];
    const { Topbar } = await loadModule<typeof import("./Topbar.tsx")>(new URL("./Topbar.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "@logics_common": { useIsOpenedConfigPage: () => ({ setIsOpenedConfigPage: (open: boolean) => { opened.push(open); } }) },
        "@store": { useStore_SelectedConfigTabId: () => ({ currentSelectedConfigTabId: { data: "translation" } }) },
        "../../others/stop_actions/StopActions": { StopActions: "stop-actions" },
    });
    const tree = runtime.render(Topbar);
    runtime.unmount();
    const back = find(tree, node => node.type === kitStandIns.Button);
    assert.ok(back);
    assert.deepEqual([back.props.className, back.props["data-settings-back"], back.props["aria-label"], back.props.tone, back.props.size],
        ["back", "", "common.go_back_button_label", undefined, undefined]);
    const words = find(back, node => node.props?.className === "back_label");
    assert.deepEqual([words?.props["aria-hidden"], words?.props.children], ["true", "common.go_back_button_label"]);
    back.props.onClick();
    assert.deepEqual(opened, [false]);
});
