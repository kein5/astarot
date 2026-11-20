import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";

// node?.props?.children, for a rendered node of any kind.
const childrenOf = (node: unknown): unknown => {
    if (node === null || node === undefined) return undefined;
    const props: unknown = Reflect.get(Object(node), "props");
    return props === null || props === undefined ? undefined : Reflect.get(Object(props), "children");
};

const text = (node: unknown): string => [childrenOf(node)].flat(Infinity)
    .map((child: unknown) => typeof child === "string" ? child : child && typeof child === "object" ? text(child) : "").join("");

test("the swap button shows the same words at rest as its tooltip and accessible name (#569)", async () => {
    const runtime = hooks(), swaps: string[] = [];
    const { LanguageSwapButton } = await loadModule<typeof import("./LanguageSwapButton.tsx")>(new URL("./LanguageSwapButton.tsx", import.meta.url), runtime, {
        "@logics_main": { useLanguageSettings: () => ({ canChangeLanguageSettings: () => true, isLanguageSettingsBusy: false,
            swapSelectedLanguages: () => swaps.push("swap") }) },
    });
    const button = runtime.render(LanguageSwapButton).props.children;
    assert.equal(button.props.role, "button");
    assert.equal(button.props["aria-label"], "main_page.swap_button_label");
    assert.equal(button.props.title, "main_page.swap_button_label");
    assert.equal(text(button), "main_page.swap_button_label");
    assert.equal(button.props.onMouseEnter, undefined, "the words do not depend on the pointer");
    button.props.onClick();
    assert.deepEqual(swaps, ["swap"]);
});

test("the swap button is drawn as a button at rest, not only on hover", () => {
    const css = readFileSync(new URL("./LanguageSwapButton.module.scss", import.meta.url), "utf8");
    const rest = css.split(".swap_button_wrapper {")[1].split("&:hover")[0];
    assert.match(rest, /border: \.1rem solid var\(--vox_border\)/);
    assert.match(rest, /background-color: var\(--vox_surface\)/);
});
