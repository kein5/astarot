import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { drawWith, hooks, kitStandIns, loadModule, find, findIn, nodesIn } from "../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../logics/test/hookHarness.ts";

type SelectorModule = typeof import("./LanguageSelector.tsx");
type SelectorProps = Parameters<SelectorModule["LanguageSelector"]>[0];

type Language = { language: string; country: string };

// The names find `found` whatever is typed, unless a test gives none, and keep each query they are
// asked. Enter is the key that picks.
async function open(props: Partial<SelectorProps>, found: Language[] = []) {
    const runtime = hooks(), queries: string[] = [];
    const { LanguageSelector } = await loadModule<SelectorModule>(new URL("./LanguageSelector.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "@logics_main": { useLanguageSettings: () => ({ currentSelectableLanguageList: { data: [] } }) },
        "../../../../../logics/common/languageNames.ts": {
            createLanguageNames: () => ({ search: (_: unknown, query: string) => { queries.push(query); return found; },
                name: (entry: Language) => ({ label: `${entry.language} (${entry.country})` }) }),
            isLanguagePickKey: (event: { key: string }) => event.key === "Enter",
        },
        "./language_selector_top_bar/LanguageSelectorTopBar": { LanguageSelectorTopBar: "top-bar" },
        "@common_components": { Empty: "empty", EmptyDescription: "empty-description" },
    });
    const render = () => runtime.render(LanguageSelector, { title: "main_page.language_selector.title_your_language", onClickFunction: () => {}, ...props });
    return { render, queries };
}
const selector = async (props: Partial<SelectorProps>, found: Language[] = []) => (await open(props, found)).render();

// The filter: the kit's TextField (D-36: the selection stays hand-built, its look is the kit's).
const filterIn = (tree: TreeNode) => find(tree, node => node.type === kitStandIns.TextField);

// What the language is for, in both directions (#569), is in sight while it is chosen and
// describes the search field, which has the focus when the list opens.
test("the language list shows what the language is for and the search field is described by it (#569)", async () => {
    const tree = await selector({ hint: "main_page.your_language_hint" });
    const search = filterIn(tree);
    const hint = find(tree, node => node.type === "p" && node.props.children === "main_page.your_language_hint");
    assert.ok(hint, "the hint is a visible line");
    assert.equal(hint.props.className, "hint");
    assert.ok(hint.props.id);
    assert.ok(search);
    assert.equal(search.props["aria-describedby"], hint.props.id);
});

test("without a hint the search field has no description", async () => {
    const tree = await selector({});
    const search = filterIn(tree);
    assert.ok(search);
    assert.equal(search.props["aria-describedby"], undefined);
    assert.equal(find(tree, node => node.type === "p" && node.props.className === "hint"), null);
});

test("the language search field is the kit's TextField, a search field named by its placeholder's words", async () => {
    const tree = await selector({});
    const input = filterIn(tree);
    assert.ok(input);
    // The kit's field is shadcn/ui's Input (data-slot="input"); the row gives it only its width.
    assert.deepEqual([input.props.type, input.props["aria-label"], input.props.placeholder, input.props.className, input.props.value],
        ["search", "main_page.language_selector.filter", "main_page.language_selector.filter", undefined, ""]);
    assert.equal(findIn(tree, node => node.props?.className === "filter" && node.props.children?.type === kitStandIns.TextField).type, "div");
    // The field takes the focus when the list opens, without scrolling the page.
    assert.ok(input.props.ref);
});

test("what is typed in the filter is kept in it and narrows the list", async () => {
    const { render, queries } = await open({});
    const input = filterIn(render());
    assert.ok(input);
    assert.deepEqual(queries, [""]);
    input.props.onChange({ target: { value: "ja" } });
    assert.equal(filterIn(render())?.props.value, "ja");
    assert.deepEqual(queries, ["", "ja"]);
});

test("Enter in the filter picks the first language found, and a language button picks its own", async () => {
    const picked: Language[] = [];
    const found = [{ language: "Japanese", country: "Japan" }, { language: "English", country: "United States" }];
    const tree = await selector({ onClickFunction: language => { picked.push(language); } }, found);
    const input = filterIn(tree);
    assert.ok(input);
    let prevented = 0;
    input.props.onKeyDown({ key: "a", preventDefault: () => { prevented++; } });
    assert.deepEqual([picked, prevented], [[], 0]);
    input.props.onKeyDown({ key: "Enter", preventDefault: () => { prevented++; } });
    assert.deepEqual([picked, prevented], [[found[0]], 1]);
    // The grid: a hand-built button for each language (D-36), drawn in the kit's look.
    const buttons = nodesIn(tree).filter(node => node.props?.language_data);
    assert.equal(buttons.length, 2);
    const english = buttons[1];
    assert.equal(english.props.label, "English (United States)");
    const button = drawWith(hooks(), english);
    assert.deepEqual([button.type, button.props.type, button.props.className], ["button", "button", "language_button"]);
    button.props.onClick();
    assert.deepEqual(picked, [found[0], found[1]]);
});

test("a language button keeps its own look in the kit's tokens: the accent fill, the kit's corners and focus ring", () => {
    const css = readFileSync(new URL("./LanguageSelector.css.ts", import.meta.url), "utf8");
    const rule = css.slice(css.indexOf("export const language_button"), css.indexOf("export const language_label"));
    assert.match(rule, /borderRadius: vars\.vox_radius,/);
    assert.match(rule, /transition: colourTransition,/);
    assert.match(rule, /"&:hover": \{ backgroundColor: vars\.vox_secondary_hover \}/);
    assert.match(rule, /"&:active": \{ backgroundColor: vars\.dark_925_color \}/);
    assert.match(rule, /"&:focus-visible": focusRing,/);
    assert.match(css, /import \{ colourTransition, focusRing \} from "\.\.\/\.\.\/\.\.\/\.\.\/kit\/shared\.css\.ts";/);
    // The filter's own look is the kit's: the screen keeps only its width.
    assert.match(css, /export const filter = style\(\{ maxWidth: "32rem" \}\);/);
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
