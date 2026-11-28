import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule, find, unchecked, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";
import { styleOf } from "../../../../../../logics/test/styleSource.ts";

type OpenButtonModule = typeof import("./LanguageSelectorOpenButton.tsx");
type OpenButtonProps = Parameters<OpenButtonModule["LanguageSelectorOpenButton"]>[0];

const slots = { 1: { "1": { language: "Japanese", country: "Japan", enable: true }, "2": { language: "English", country: "United States", enable: false } } };

async function field(selector_key: OpenButtonProps["selector_key"], is_turned_on = false) {
    const runtime = hooks();
    const { LanguageSelectorOpenButton } = await loadModule<OpenButtonModule>(new URL("./LanguageSelectorOpenButton.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "../../../../../../logics/common/languageNames.ts": { createLanguageNames: () => ({ name: (slot: { language: string }) => ({ language: slot.language, country: "" }) }) },
        "@store": { useStore_IsOpenedLanguageSelector: () => ({ updateIsOpenedLanguageSelector: () => {},
            currentIsOpenedLanguageSelector: { data: { your_language: false, target_language: false, target_key: "1" } } }) },
        "@logics_main": {
            useIsMainPageCompactMode: () => ({ closeOverlay: () => {} }),
            useLanguageSettings: () => ({ currentSelectedPresetTabNumber: { data: 1 },
                currentSelectedYourLanguages: { data: slots }, currentSelectedTargetLanguages: { data: slots } }),
        },
    });
    // On purpose: a tag name stands in for the icon component the type asks for; the test reads
    // only the button.
    const tree = runtime.render(LanguageSelectorOpenButton, { TurnedOnSvgComponent: unchecked<OpenButtonProps["TurnedOnSvgComponent"]>("svg"),
        is_turned_on, selector_key, target_key: "1" });
    // The kit's plain Button at the compact size (decided on 2026-11-25, H-05).
    const button = find(tree, node => node.type === kitStandIns.Button);
    assert.ok(button);
    const description = find(tree, node => node.props?.id !== undefined && node.props.id === button.props["aria-describedby"]);
    // The tooltip around the field: an element named "tooltip" that keeps the bubble's words (hookHarness).
    const tip = find(tree, node => node.type === "tooltip");
    // The mark that the side is on, drawn by the tag that stands in for the icon.
    const mark = find(tree, node => node.type === "svg");
    return { button, description, tip, mark };
}

// The swap button no longer says that the pair is translated both ways (#569): each language
// field says what its language is for, in both directions, as its tooltip and its description.
test("each language field is described by what its language is for, in both directions (#569)", async () => {
    for (const [selector_key, hint] of [["your_language", "main_page.your_language_hint"], ["target_language", "main_page.target_language_hint"]] as const) {
        const { button, description, tip } = await field(selector_key);
        // The tooltip opens beside the rail, on the pointer and on keyboard focus; no title attribute is left.
        assert.ok(tip, selector_key);
        assert.deepEqual([tip.props.title, tip.props.placement], [hint, "right"], selector_key);
        assert.ok(find(tip, node => node.type === kitStandIns.Button), "the tooltip is the field's");
        assert.equal(button.props.size, "compact", selector_key);
        assert.equal(button.props.title, undefined, selector_key);
        assert.ok(description, `${selector_key}: aria-describedby points at an element`);
        assert.equal(description.props.children, hint, selector_key);
        assert.equal(description.props.className, "visually_hidden", "the description takes no room in the rail");
        assert.match(button.props["aria-label"], /^main_page\.(your|target)_language: Japanese$/, "the name stays the role and the language");
    }
});

// #1364: the mark that the side is on (the mic for yours, the speaker for theirs) is always drawn
// and only hidden while the side is off, so its place is kept: the role beside it does not move
// when the switch turns on.
test("the mark that a language's side is on keeps its place while it is hidden (#1364)", async () => {
    for (const selector_key of ["your_language", "target_language"] as const) {
        assert.equal((await field(selector_key, false)).mark?.props.className, "category_svg", selector_key);
        assert.equal((await field(selector_key, true)).mark?.props.className, "category_svg is_turned_on", selector_key);
    }
    const mark = styleOf(readFileSync(new URL("./LanguageSelectorOpenButton.css.ts", import.meta.url), "utf8"), "category_svg");
    assert.match(mark, /display: "block",/);
    assert.match(mark, /visibility: "hidden",/);
    assert.match(mark, /\[`&\.\$\{is_turned_on\}`\]: \{ visibility: "visible" \}/);
    assert.doesNotMatch(mark, /display: "none"/);
});
