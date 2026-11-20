import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find } from "../../../../../logics/test/hookHarness.ts";

type SelectorModule = typeof import("./LanguageSelector.tsx");
type SelectorProps = Parameters<SelectorModule["LanguageSelector"]>[0];

async function selector(props: Partial<SelectorProps>) {
    const runtime = hooks();
    const { LanguageSelector } = await loadModule<SelectorModule>(new URL("./LanguageSelector.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "@logics_main": { useLanguageSettings: () => ({ currentSelectableLanguageList: { data: [] } }) },
        "../../../../../logics/common/languageNames.ts": {
            createLanguageNames: () => ({ search: () => [], name: () => ({ label: "" }) }),
            isLanguagePickKey: () => false,
        },
        "./language_selector_top_bar/LanguageSelectorTopBar": { LanguageSelectorTopBar: "top-bar" },
        "@common_components": { Empty: "empty", EmptyDescription: "empty-description" },
    });
    return runtime.render(LanguageSelector, { title: "main_page.language_selector.title_your_language", onClickFunction: () => {}, ...props });
}

// What the language is for, in both directions (#569), is in sight while it is chosen and
// describes the search field, which has the focus when the list opens.
test("the language list shows what the language is for and the search field is described by it (#569)", async () => {
    const tree = await selector({ hint: "main_page.your_language_hint" });
    const search = find(tree, node => node.type === "input");
    const hint = find(tree, node => node.type === "p" && node.props.children === "main_page.your_language_hint");
    assert.ok(hint, "the hint is a visible line");
    assert.equal(hint.props.className, "hint");
    assert.ok(hint.props.id);
    assert.ok(search);
    assert.equal(search.props["aria-describedby"], hint.props.id);
});

test("without a hint the search field has no description", async () => {
    const tree = await selector({});
    const search = find(tree, node => node.type === "input");
    assert.ok(search);
    assert.equal(search.props["aria-describedby"], undefined);
    assert.equal(find(tree, node => node.type === "p" && node.props.className === "hint"), null);
});

test("the language search field is named as shadcn/ui's Input", async () => {
    const tree = await selector({});
    const input = find(tree, node => node.type === "input");
    assert.ok(input);
    assert.equal(input.props["data-slot"], "input");
});

test("a search that finds no language says so in shadcn/ui's Empty, as a status", async () => {
    // The mocked names find nothing, whatever is typed.
    const tree = await selector({});
    const empty = find(tree, node => node.type === "empty");
    assert.ok(empty);
    assert.equal(empty.props.role, "status");
    const description = find(empty, node => node.type === "empty-description");
    assert.ok(description);
    assert.equal(description.props.children, "main_page.language_selector.no_results");
});
