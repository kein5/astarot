import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { hooks, loadModule, nodesIn, stubGlobals } from "../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../logics/test/hookHarness.ts";
import * as languageNames from "../../logics/common/languageNames.ts";
import * as languageJumpGroups from "../../logics/common/languageJumpGroups.ts";

// #614: the language window says a thing once. The count beside the heading is the range, the
// chevron of a row says where a language is changed, "Applying changes…" is the wait, and the
// heading "Saved candidates" names its list. What stays is a state or a reason. The swap says
// which two languages it exchanges by standing between them.

const entry = (language: string, country: string) => ({ language, country });
const ok = <T>(data: T) => ({ state: "ok", data });
const TARGETS = [entry("English", "United States"), entry("Korean", "South Korea"), entry("French", "France")];

// The language settings as the window reads them: one preset, with this many recipient languages.
const settings = (targets: number, inFlight: unknown = null) => ({
    currentSelectedPresetTabNumber: ok("1"),
    currentSelectedYourLanguages: ok({ "1": { "1": entry("Japanese", "Japan") } }),
    currentSelectedTargetLanguages: ok({ "1": Object.fromEntries(TARGETS.map((target, index) => [String(index + 1), { ...target, enable: index < targets }])) }),
    currentSelectedTranslationEngines: ok({ "1": "CTranslate2" }),
    currentTranslationEngines: ok([{ id: "CTranslate2", label: "CTranslate2", is_available: true, is_default: true }]),
    currentSelectableLanguageList: ok([entry("Japanese", "Japan"), ...TARGETS, entry("German", "Germany")]),
    currentLanguageMutation: ok({ inFlight, isResyncing: false, lastVrResult: null }),
    refreshLanguageSettings() {},
    swapSelectedLanguages: () => "swap-1",
});

async function languageWindow(context: TestContext, targets: number) {
    // The window reads the focused element after it draws; nothing has the focus here.
    stubGlobals(context, { document: { activeElement: null } });
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    let current = settings(targets);
    const { VrLanguageWindow } = await loadModule<typeof import("./VrLanguageWindow.tsx")>(new URL("./VrLanguageWindow.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string) => key, i18n: { language: "en" } }) },
        "@logics_main": { useLanguageSettings: () => current },
        "@logics_common": { useIsOpenedConfigPage: () => ({ currentIsOpenedConfigPage: { data: false } }) },
        "../../logics/main/languageMutations": { LANGUAGE_RESPONSE_WAIT_MS: 1000 },
        "../../logics/common/languageNames.ts": languageNames,
        "../../logics/common/languageJumpGroups.ts": languageJumpGroups,
        "./VrWindow": { VrWindow: "window" },
        "./VrPickerList": { VrPickerList: "picker-list", VR_PICKER_WINDOW_THRESHOLD: 100 },
    });
    const draw = () => runtime.render(VrLanguageWindow, { onClose() {} });
    return { draw, change: (inFlight: unknown) => { current = settings(targets, inFlight); } };
}

// The nodes of a class, and the words a node shows (its text, in order).
const ofClass = (tree: TreeNode, name: string) => nodesIn(tree).filter(node => String(node.props.className ?? "").split(" ").includes(name));
const words = (value: unknown): string => Array.isArray(value) ? value.map(words).join("")
    : typeof value === "string" || typeof value === "number" ? String(value)
    : value && typeof value === "object" && "props" in value ? words(Reflect.get(Object(Reflect.get(value, "props")), "children")) : "";

test("the recipients' heading leaves the range to the count beside it", async context => {
    const tree = (await languageWindow(context, 2)).draw();
    const [heading] = ofClass(tree, "target_heading");
    assert.equal(words(heading), "main_page.target_languagevr_panel.language.swap2 / 3", "the heading, the swap and the count: no range");
    assert.equal(ofClass(tree, "limit").length, 0, "below the limit, the button that adds a language is there");
    assert.equal(ofClass(tree, "add").length, 1);
});

test("at the limit, the line in place of the add button says only that every slot is taken", async context => {
    const tree = (await languageWindow(context, 3)).draw();
    assert.equal(ofClass(tree, "add").length, 0);
    assert.deepEqual(ofClass(tree, "limit").map(words), ["vr_panel.language.full"]);
    assert.equal(words(ofClass(tree, "target_heading")[0]), "main_page.target_languagevr_panel.language.swap3 / 3");
});

test("the swap stands between your language and recipient 1, between an up and a down arrow", async context => {
    const view = await languageWindow(context, 3);
    const tree = view.draw();
    // In the order they are drawn and reached: your language, the swap, then the recipients.
    const classes = nodesIn(tree).filter(node => node.type === "button").map(node => String(node.props.className ?? "").split(" "));
    const at = (name: string) => classes.findIndex(names => names.includes(name));
    assert.ok(at("source") >= 0 && at("source") < at("swap") && at("swap") < at("target_change"), "your language, the swap, recipient 1");
    const [swap] = ofClass(tree, "swap");
    assert.equal(ofClass(ofClass(tree, "target_heading")[0], "swap").length, 1, "on the recipients' heading line");
    // Its name still says both languages; on screen it is the word between two arrows, with no second line.
    assert.equal(swap.props["aria-label"], "vr_panel.language.swap_name");
    const parts: TreeNode[] = swap.props.children;
    assert.deepEqual(parts.map(node => typeof node.type === "function" ? String(node.props.className) : words(node)),
        ["swap_arrow swap_arrow_up", "vr_panel.language.swap", "swap_arrow"]);
    assert.ok(parts.filter(node => typeof node.type === "function").every(node => node.props["aria-hidden"] === "true"));
    // Pressing it sends the swap and the window waits for the answer.
    swap.props.onClick();
    assert.equal(ofClass(view.draw(), "swap")[0].props["aria-disabled"], true);
});

test("the list of saved languages has its heading and no note under it, and the wait is said once", async context => {
    const view = await languageWindow(context, 2);
    const source = ofClass(view.draw(), "source")[0];
    source.props.onClick();
    const saved = view.draw();
    assert.deepEqual(nodesIn(saved).filter(node => node.type === "h3").map(words), ["vr_panel.language.saved"]);
    assert.equal(ofClass(saved, "helper").length, 0, "no note under the heading while the list has languages");
    assert.equal(ofClass(saved, "feedback").length, 0, "nothing to report while nothing is sent");
    // A change is on its way: the state alone, with no second sentence asking to wait.
    view.change({ kind: "pending" });
    assert.deepEqual(ofClass(view.draw(), "feedback").map(words), ["vr_panel.settings.changing"]);
});
