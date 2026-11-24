import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { hooks, loadModule, fieldOf, kitStandIns } from "../../../../../../logics/test/hookHarness.ts";

// node?.props?.children, for a rendered node of any kind.
const childrenOf = (node: unknown): unknown => fieldOf(node, "props", "children");

const text = (node: unknown): string => [childrenOf(node)].flat(Infinity)
    .map((child: unknown) => typeof child === "string" ? child : child && typeof child === "object" ? text(child) : "").join("");

test("the swap button shows the same words at rest as its accessible name, and has no tooltip to repeat them (#569, #614)", async () => {
    const runtime = hooks(), swaps: string[] = [];
    const { LanguageSwapButton } = await loadModule<typeof import("./LanguageSwapButton.tsx")>(new URL("./LanguageSwapButton.tsx", import.meta.url), runtime, {
        "@logics_main": { useLanguageSettings: () => ({ canChangeLanguageSettings: () => true, isLanguageSettingsBusy: false,
            swapSelectedLanguages: () => swaps.push("swap") }) },
    });
    const button = runtime.render(LanguageSwapButton).props.children;
    // The kit's plain Button at the compact size.
    assert.equal(button.type, kitStandIns.Button);
    assert.deepEqual([button.props.tone, button.props.size], [undefined, "compact"]);
    assert.equal(button.props["aria-label"], "main_page.swap_button_label");
    // The words are in sight at every width, so no tooltip (and no title attribute) says them again.
    assert.equal(button.props.title, undefined);
    assert.equal(text(button), "main_page.swap_button_label");
    assert.equal(button.props.onMouseEnter, undefined, "the words do not depend on the pointer");
    button.props.onClick();
    assert.deepEqual(swaps, ["swap"]);
});

test("the swap button is drawn as a button at rest, not only on hover", () => {
    // The kit's plain Button: the raised surface and a hairline border without the pointer on it.
    const css = readFileSync(new URL("../../../../../kit/Button.css.ts", import.meta.url), "utf8");
    assert.match(css, /plain: \{\s*background: vars\.vox_surface,\s*borderColor: vars\.vox_border,/);
});

test("Enter and Space swap once on the key going down, also while held, and only when the settings take it", async () => {
    const runtime = hooks(), swaps: string[] = [];
    let allowed = true;
    const { LanguageSwapButton } = await loadModule<typeof import("./LanguageSwapButton.tsx")>(new URL("./LanguageSwapButton.tsx", import.meta.url), runtime, {
        "@logics_main": { useLanguageSettings: () => ({ canChangeLanguageSettings: () => allowed, isLanguageSettingsBusy: !allowed,
            swapSelectedLanguages: () => swaps.push("swap") }) },
    });
    const button = runtime.render(LanguageSwapButton).props.children;
    const held: string[] = [];
    const key = (name: string, repeat = false) => button.props.onKeyDown({ key: name, repeat, preventDefault: () => held.push(name) });
    key("Enter");
    key("Enter", true);
    key(" ");
    key("Tab");
    assert.deepEqual(swaps, ["swap", "swap"]);
    // The button's own press by Enter and Space is held back, so a key does not swap twice.
    assert.deepEqual(held, ["Enter", "Enter", " "]);
    allowed = false;
    const busy = runtime.render(LanguageSwapButton).props.children;
    assert.equal(busy.props["aria-disabled"], true, "it stays focusable while busy");
    busy.props.onKeyDown({ key: "Enter", repeat: false, preventDefault() {} });
    busy.props.onClick();
    assert.deepEqual(swaps, ["swap", "swap"]);
});
