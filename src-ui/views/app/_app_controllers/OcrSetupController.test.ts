import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import { hooks, loadModule, find, unchecked } from "../../../logics/test/hookHarness.ts";
import type { FocusOcrModelsOptions } from "../../../logics/ocr/useOcrSetup.ts";

type OcrSetupModule = typeof import("../../../logics/ocr/useOcrSetup.ts");

// value?.[key], for a value read from a locale file.
const fieldOf = (value: unknown, key: string): unknown =>
    value === null || value === undefined ? undefined : Reflect.get(Object(value), key);

async function fixture(context: TestContext) {
    const runtime = hooks(), events: unknown[][] = [];
    const setup = await loadModule<OcrSetupModule>(new URL("../../../logics/ocr/useOcrSetup.ts", import.meta.url), runtime);
    const { OcrSetupController } = await loadModule<typeof import("./OcrSetupController.tsx")>(new URL("./OcrSetupController.tsx", import.meta.url), runtime, {
        "@store": {
            useStore_IsOpenedConfigPage: () => ({ updateIsOpenedConfigPage: (value: unknown) => events.push(["config_page", value]) }),
            useStore_SelectedConfigTabId: () => ({ updateSelectedConfigTabId: (value: unknown) => events.push(["tab", value]) }),
        },
        "../../../logics/ocr/useOcrSetup": { ...setup, focusOcrModels: () => events.push(["focus_models"]) },
        "../../../logics/common/useConsentDialog": { useConsentDialog: () => ({ dialog: { current: null }, close: () => events.push(["close"]) }) },
    });
    context.onTestFinished(() => runtime.unmount());
    const render = () => runtime.render(OcrSetupController);
    const click = (key: string) => {
        const button = find(render(), node => node.type === "button" && node.props.children === `ocr_setup.${key}`);
        assert.ok(button);
        return button.props.onClick();
    };
    const show = () => { runtime.render(setup.useOcrSetup).show(); return render(); };
    return { render, click, show, events };
}

test("the guide is hidden until chat reading is turned on without its models", async context => {
    const s = await fixture(context);
    assert.equal(s.render(), null);
    const tree = s.show();
    assert.ok(find(tree, node => node.type === "dialog"));
    const focused = find(tree, node => node.props?.autoFocus);
    assert.ok(focused);
    assert.equal(focused.props.children, "ocr_setup.close", "initial focus is the safe action");
});

test("going to the models opens the OCR settings tab and focuses the models; nothing is downloaded", async context => {
    const s = await fixture(context);
    s.show();
    s.click("review");
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["tab", "ocr"], ["config_page", true], ["focus_models"]]);
});

test("closing, or Escape, leaves everything as it was", async context => {
    const s = await fixture(context);
    s.show();
    s.click("close");
    assert.equal(s.render(), null);
    let prevented = false;
    const dialog = find(s.show(), node => node.type === "dialog");
    assert.ok(dialog);
    dialog.props.onCancel({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(s.render(), null);
    assert.deepEqual(s.events, [["close"], ["close"]]);
});

test("focusing the models waits for the section and lands on its first enabled action", async () => {
    const { focusOcrModels } = await loadModule<OcrSetupModule>(new URL("../../../logics/ocr/useOcrSetup.ts", import.meta.url), hooks());
    const focused: string[] = [], timers: (() => void)[] = [];
    const button = (disabled: boolean, inDialog = false) => ({ disabled, closest: () => inDialog ? {} : null, focus: () => focused.push(disabled ? "disabled" : "review") });
    let section: object | null = null;
    const doc = { querySelector: (selector: string) => selector === '[data-setting-id="ocr_models"]' ? section : null };
    // A page with only the section the code looks for, standing in for the document.
    focusOcrModels({ doc: unchecked<FocusOcrModelsOptions["doc"]>(doc), wait: callback => timers.push(callback) });
    const first = timers.shift();
    assert.ok(first);
    first();
    assert.equal(focused.length, 0);
    section = { querySelectorAll: () => [button(true), button(false, true), button(false)], scrollIntoView: () => focused.push("scrolled"),
        focus: () => focused.push("section") };
    const second = timers.shift();
    assert.ok(second);
    second();
    assert.deepEqual(focused, ["scrolled", "review"]);
});

for (const language of ["en", "ja"]) test(`${language}: the guide says chat reading stayed off and that downloading asks first`, async () => {
    const messages = yaml.load(await readFile(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"));
    const guide = fieldOf(messages, "ocr_setup");
    for (const key of ["title", "body", "next", "close", "review"]) assert.ok(fieldOf(guide, key), key);
    const next = fieldOf(guide, "next");
    assert.ok(typeof next === "string");
    assert.match(next, language === "ja" ? /ライセンス/ : /license/);
});
